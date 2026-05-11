const {
  SETTINGS_DEFAULTS,
  buildDateSummary,
  buildEventRecord,
  sortEvents,
  paginateItems,
  formatCountdown,
} = require("../helpers/events");
const {
  buildEventId,
  buildPreviewText,
  formatCelebrationDate,
  getAnniversaryYears,
  renderTemplate,
} = require("../helpers/messages");
const { DateTime } = require("luxon");

function createHomeModule({ db, slack, logger = console }) {
  const state = new Map();

  function getState(userId) {
    return state.get(userId) || { page: 1, filterUserId: null, selectedChannelId: null };
  }

  function setState(userId, patch) {
    const next = { ...getState(userId), ...patch };
    state.set(userId, next);
    return next;
  }

  async function openOrPushModal({ client, body, view }) {
    if (body.view?.type === "modal") {
      await client.views.push({
        trigger_id: body.trigger_id,
        view,
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view,
    });
  }

  function buildMissingDataBlock(users) {
    const listed = users.slice(0, 10).map((user) => `<@${user.slackId}>`).join(", ");
    const remainder = users.length > 10 ? ` and ${users.length - 10} more` : "";

    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Missing data for:*\n${listed}${remainder}`,
      },
    };
  }

  function buildSettingsSummary(settings, allRecorded) {
    const lines = [
      `📢 *Channel:* ${settings.channelId ? `<#${settings.channelId}>` : "No data yet"}`,
      `⏰ *Post time:* ${settings.postTime || "No data yet"}`,
      `🎉 *GIF:* ${settings.includeGif ? "Enabled" : "Disabled"}`,
      `📣 *Mention settings:* ${settings.mentionChannel ? "@channel" : "celebrants only"}`,
    ];

    if (allRecorded) {
      lines.push("✅ All birthdays/work anniversaries have been recorded");
    }

    return lines.join("\n");
  }

  function fallbackPreviewMessage(event, template) {
    if (template?.message) {
      return renderTemplate(template.message, {
        slackId: event.userId,
        years: getAnniversaryYears(event, DateTime.now()),
      });
    }

    if (event.type === "birthday") {
      return `🎂 Happy Birthday <@${event.userId}>!`;
    }

    const years = getAnniversaryYears(event, DateTime.now());
    return `💼 Congratulations <@${event.userId}> on your ${years || ""} work anniversary!`.trim();
  }

  async function buildCelebrationEvents(client, settings) {
    const employees = await db.listEmployees();
    const events = [];

    for (const employee of employees) {
      if (!employee.slackId) {
        continue;
      }

      const status = await slack.getUserStatus(client, employee.slackId);
      if (status === "deactivated") {
        continue;
      }

      if (employee.birthday && !employee.birthdayOptOut) {
        const birthday = buildEventRecord({
          type: "birthday",
          userId: employee.slackId,
          dateParts: employee.birthday,
          timezone: settings.timezone,
          settings,
          employee,
        });

        if (birthday) {
          events.push(birthday);
        }
      }

      if (settings.includeAnniversaries && employee.anniversary && !employee.anniversaryOptOut) {
        const anniversary = buildEventRecord({
          type: "anniversary",
          userId: employee.slackId,
          dateParts: employee.anniversary,
          timezone: settings.timezone,
          settings,
          employee,
        });

        if (anniversary) {
          events.push(anniversary);
        }
      }
    }

    return sortEvents(events);
  }

  async function buildUpcomingEvents(client, settings, homeState) {
    const allEvents = await buildCelebrationEvents(client, settings);
    const filtered = allEvents.filter((event) =>
      homeState.filterUserId ? event.userId === homeState.filterUserId : true,
    );

    return {
      allItems: filtered,
      ...paginateItems(filtered, homeState.page, 5),
    };
  }

  function buildEventOverrideModal({ event, channelName, existingOverride, previewViewId, template }) {
    const defaultMessage = template?.message || "";
    const templateGifs = template?.gifUrls || [];
    const messageValue = existingOverride?.customMessage || defaultMessage;
    const gifValue = existingOverride?.gifUrl || "";

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${formatCelebrationDate(event.date, true)}*\n<@${event.userId}> • ${event.type} • ${channelName}`,
        },
      },
      {
        type: "input",
        block_id: "message",
        optional: true,
        label: { type: "plain_text", text: "Cheer message" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          ...(messageValue ? { initial_value: messageValue } : {}),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Variables: `<@USER>`, `{ANNIV_YEARS}`\nFormat: `*bold*` `_italic_` `~strike~`",
          },
        ],
      },
      {
        type: "input",
        block_id: "gif",
        optional: true,
        label: { type: "plain_text", text: "GIF URL" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          ...(gifValue ? { initial_value: gifValue } : {}),
        },
      },
    ];

    if (templateGifs.length) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*GIFs from template:*\n${templateGifs.map((url, i) => `${i + 1}. ${url}`).join("\n")}`,
          },
        ],
      });
    }

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Leave both fields blank to reset this event to the default template.",
        },
      ],
    });

    return {
      type: "modal",
      callback_id: "save_event_override_modal",
      title: { type: "plain_text", text: "✏️ Edit event" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      private_metadata: JSON.stringify({
        eventId: buildEventId({
          slackId: event.userId,
          type: event.type,
          date: event.date.toISODate(),
        }),
        slackId: event.userId,
        type: event.type,
        date: event.date.toISODate(),
        previewViewId,
      }),
      blocks,
    };
  }

  async function buildPreviewModal(client, settings, events, previewUserId) {
    const [channelName, overrides, birthdayTemplate, anniversaryTemplate] = await Promise.all([
      slack.getConversationName(client, settings.channelId),
      db.listEventOverrides({
        startDate: events[0]?.date?.toISODate() || DateTime.now().toISODate(),
        endDate: events[Math.min(events.length - 1, 7)]?.date?.toISODate() || DateTime.now().toISODate(),
      }),
      db.getTemplate("birthday"),
      db.getTemplate("anniversary"),
    ]);

    const overrideMap = new Map(overrides.map((item) => [item.id, item]));
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "👁️ Preview Events" },
      },
    ];

    if (!events.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "No data yet" }],
      });
    } else {
      for (const event of events.slice(0, 8)) {
        const eventId = buildEventId({
          slackId: event.userId,
          type: event.type,
          date: event.date.toISODate(),
        });
        const override = overrideMap.get(eventId);
        const template = event.type === "birthday" ? birthdayTemplate : anniversaryTemplate;
        const fallbackMessage = fallbackPreviewMessage(event, template);
        const previewText = buildPreviewText({
          event,
          customMessage: override?.customMessage || "",
          fallbackMessage,
          gifUrl: override?.gifUrl || "",
          channelName,
        });

        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: previewText,
            },
            accessory: {
              type: "overflow",
              action_id: "event_actions",
              options: [
                {
                  text: { type: "plain_text", text: "✏️ Edit event" },
                  value: JSON.stringify({
                    eventId,
                    slackId: event.userId,
                    type: event.type,
                    date: event.date.toISODate(),
                    previewUserId,
                  }),
                },
              ],
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: override ? "✏️ Customized" : "Default template",
              },
            ],
          },
          { type: "divider" },
        );
      }
    }

    return {
      type: "modal",
      title: { type: "plain_text", text: "👁️ Preview" },
      close: { type: "plain_text", text: "Close" },
      private_metadata: JSON.stringify({
        channelId: settings.channelId,
        previewUserId,
      }),
      blocks,
    };
  }

  async function buildHomeView(client, userId) {
    const isAdmin = await db.isAdmin(userId);
    const profile = await db.getUserProfile(userId);
    const channelSettings = await db.listChannelSettings();
    const homeState = getState(userId);
    const selectedChannelId =
      homeState.selectedChannelId ||
      channelSettings[0]?.channelId ||
      process.env.DEFAULT_CHANNEL_ID ||
      null;
    const settings =
      channelSettings.find((entry) => entry.channelId === selectedChannelId) ||
      (await db.getChannelSettings(selectedChannelId));
    const reminders = (await db.listReminders(selectedChannelId)).filter(
      (reminder) => reminder.channelId === selectedChannelId || !reminder.channelId,
    );
    const missingUsers = isAdmin ? await db.listEmployeesMissingCelebrationData() : [];
    const upcoming = await buildUpcomingEvents(client, settings, homeState);

    if (!isAdmin) {
      return {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🚫 Access Denied" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "You do not have access to this application. If you believe this is a mistake, please contact your workspace administrator.",
            },
          },
        ],
      };
    }

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "🤖 Dex" },
      },
    ];

    if (isAdmin && missingUsers.length) {
      blocks.push(buildMissingDataBlock(missingUsers));
    }

    if (isAdmin) {
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: buildSettingsSummary(settings, !missingUsers.length),
          },
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "👥 Admin Actions" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "➕ Add Channel" },
              action_id: "open_settings_modal",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👥 Manage Employees" },
              action_id: "open_view_employees",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👥 Manage Admins" },
              action_id: "open_manage_admins_modal",
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✍️ Templates" },
              action_id: "open_templates_modal",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📋 Manage Templates" },
              action_id: "open_manage_templates_modal",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📥 Data Manager" },
              action_id: "open_data_manager_modal",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📊 Analytics" },
              action_id: "view_analytics",
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "👁️ Preview Events" },
              action_id: "preview_events",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📅 Calendar View" },
              action_id: "open_calendar_modal",
            },
          ],
        },
      );
    }

    const reminderSummary = reminders.length
      ? reminders.map((reminder) => `${reminder.daysBefore} day(s) • ${reminder.scope}`).join(", ")
      : "No data yet";

    blocks.push(
      { type: "divider" },
      {
        type: "header",
        text: { type: "plain_text", text: "Hey buddy 👋" },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Enter your birthdate and work anniversary date so we can celebrate the right moments together.",
          },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: buildDateSummary("Birthday", profile.birthday) },
          { type: "mrkdwn", text: buildDateSummary("Anniversary", profile.anniversary) },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Update Profile" },
            action_id: "open_profile_modal",
          },
        ],
      },
      { type: "divider" },
      {
        type: "header",
        text: { type: "plain_text", text: "⏰ Reminders" },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: reminderSummary }],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "⏰ Create Reminder" },
            action_id: "open_create_reminder_modal",
            value: settings.channelId || "",
          },
        ],
      },
      { type: "divider" },
      {
        type: "header",
        text: { type: "plain_text", text: "📅 Upcoming Events" },
      },
      {
        type: "actions",
        elements: [
          {
            type: "users_select",
            action_id: "upcoming_events_search",
            placeholder: { type: "plain_text", text: "Search teammates" },
            ...(homeState.filterUserId ? { initial_user: homeState.filterUserId } : {}),
          },
          ...(homeState.filterUserId
            ? [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Clear Filter" },
                  action_id: "clear_upcoming_filter",
                },
              ]
            : []),
        ],
      },
    );

    if (!upcoming.items.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "No data yet" }],
      });
    } else {
      for (const event of upcoming.items) {
        const dateStr = formatCelebrationDate(event.date, true);
        const icon = event.type === "birthday" ? "🎂" : "💼";
        const countdown = formatCountdown(event.date, settings.timezone);
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${dateStr} → ${icon} <@${event.userId}> • ${countdown}`,
            },
          ],
        });
      }
    }

    if (upcoming.hasMore) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Load more" },
            action_id: "home_load_more",
          },
        ],
      });
    }

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Using ${settings.timezone || SETTINGS_DEFAULTS.timezone} at ${settings.postTime}`,
          },
        ],
      },
    );

    return {
      type: "home",
      blocks,
    };
  }

  async function publishHome(client, userId, patch = null) {
    if (patch) {
      setState(userId, patch);
    }

    const view = await buildHomeView(client, userId);
    await client.views.publish({
      user_id: userId,
      view,
    });
  }

  function register(app) {
    app.event("app_home_opened", async ({ event, client }) => {
      await slack.ensureSlackUserRecord(client, event.user, db);
      await slack.syncUserEmailFromSlack(client, event.user, db);
      await publishHome(client, event.user);
    });


    app.action("upcoming_events_search", async ({ ack, body, action, client }) => {
      await ack();
      setState(body.user.id, { filterUserId: action.selected_user || null, page: 1 });
      await publishHome(client, body.user.id);
    });

    app.action("clear_upcoming_filter", async ({ ack, body, client }) => {
      await ack();
      setState(body.user.id, { filterUserId: null, page: 1 });
      await publishHome(client, body.user.id);
    });

    app.action("home_load_more", async ({ ack, body, client }) => {
      await ack();
      const homeState = getState(body.user.id);
      setState(body.user.id, { page: homeState.page + 1 });
      await publishHome(client, body.user.id);
    });

    app.action("view_analytics", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const analytics = await db.getAnalytics();
        const timezone = (await db.getChannelSettings(getState(body.user.id).selectedChannelId || process.env.DEFAULT_CHANNEL_ID))
          .timezone;
        const automation = await db.getAutomationMetrics({ timezone });

        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "📊 Analytics" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "📊 Analytics" },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: [
                    `👥 *Total employees:* ${analytics.totalEmployees}`,
                    `🎂 *Birthdays stored:* ${analytics.totalBirthdays}`,
                    `💼 *Anniversaries stored:* ${analytics.totalAnniversaries}`,
                    `⏰ *Reminders count:* ${analytics.remindersCount}`,
                    "",
                    `📊 *This month:*`,
                    `• ${automation.birthdaysSentThisMonth} birthdays celebrated`,
                    `• ${automation.anniversariesSentThisMonth} anniversaries celebrated`,
                    `• ${automation.upcomingEventsCount} events upcoming today`,
                  ].join("\n"),
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Review everyone who has opted out of birthday or anniversary celebrations.",
                },
                accessory: {
                  type: "button",
                  text: { type: "plain_text", text: "🚫 View users" },
                  action_id: "view_opted_out_users",
                },
              },
            ],
          },
        });
      } catch (error) {
        logger.error("Failed to open analytics modal", error);
      }
    });

    app.action("view_opted_out_users", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const optedOutUsers = await db.getOptedOutUsers();
        const blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "🚫 Opted-out users" },
          },
        ];

        if (!optedOutUsers.length) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "✅ No users have opted out" }],
          });
        } else {
          for (const user of optedOutUsers) {
            const labels = [];
            if (user.birthdayOptOut) {
              labels.push("🎂 birthday");
            }
            if (user.anniversaryOptOut) {
              labels.push("💼 anniversary");
            }

            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<@${user.slackId}> • ${labels.join(" • ")}`,
              },
            });
          }
        }

        await openOrPushModal({
          client,
          body,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "🚫 Opt-outs" },
            close: { type: "plain_text", text: "Close" },
            blocks,
          },
        });
      } catch (error) {
        logger.error("Failed to open opted-out users modal", error);
      }
    });

    app.action("preview_events", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const homeState = getState(body.user.id);
        const settings = await db.getChannelSettings(homeState.selectedChannelId || process.env.DEFAULT_CHANNEL_ID);
        const events = await buildCelebrationEvents(client, settings);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: await buildPreviewModal(client, settings, events, body.user.id),
        });
      } catch (error) {
        logger.error("Failed to open preview modal", error);
      }
    });

    app.action("event_actions", async ({ ack, body, action, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const payload = JSON.parse(action.selected_option.value);
        const date = DateTime.fromISO(payload.date);
        const homeState = getState(payload.previewUserId || body.user.id);
        const settings = await db.getChannelSettings(homeState.selectedChannelId || process.env.DEFAULT_CHANNEL_ID);
        const [existingOverride, template] = await Promise.all([
          db.getEventOverride(payload.eventId),
          db.getTemplate(payload.type),
        ]);

        await openOrPushModal({
          client,
          body,
          view: buildEventOverrideModal({
            event: {
              userId: payload.slackId,
              type: payload.type,
              date,
            },
            channelName: await slack.getConversationName(client, settings.channelId),
            existingOverride,
            previewViewId: body.view?.id || null,
            template,
          }),
        });
      } catch (error) {
        logger.error("Failed to open event override modal", error);
      }
    });

    app.view("save_event_override_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const metadata = JSON.parse(view.private_metadata || "{}");
        const customMessage = (view.state.values.message.value.value || "").trim();
        const gifUrl = (view.state.values.gif.value.value || "").trim();

        if (!customMessage && !gifUrl) {
          await db.deleteEventOverride(metadata.eventId);
        } else {
          await db.saveEventOverride({
            id: metadata.eventId,
            slackId: metadata.slackId,
            type: metadata.type,
            date: metadata.date,
            customMessage,
            gifUrl,
          });
        }

        if (metadata.previewViewId) {
          const homeState = getState(body.user.id);
          const settings = await db.getChannelSettings(homeState.selectedChannelId || process.env.DEFAULT_CHANNEL_ID);
          const events = await buildCelebrationEvents(client, settings);
          await client.views.update({
            view_id: metadata.previewViewId,
            view: await buildPreviewModal(client, settings, events, body.user.id),
          });
        }

        await publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save event override", error);
      }
    });
  }

  return {
    register,
    publishHome,
    setState,
    getState,
    buildCelebrationEvents,
  };
}

module.exports = {
  createHomeModule,
};
