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
        text: `⚠️ *Missing celebration data for:*\n${listed}${remainder}\n_Add their birthdays and anniversaries to start celebrating!_`,
      },
    };
  }

  function buildSettingsSummary(settings, allRecorded, isBotInChannel = true) {
    let formattedTime = "_Not set_";
    if (settings.postTime) {
      const [h, m] = settings.postTime.split(":");
      const hour = parseInt(h, 10);
      const isPm = hour >= 12;
      const hour12 = hour % 12 || 12;
      formattedTime = `${hour12}:${m} ${isPm ? "PM" : "AM"}`;
    }

    const lines = [
      `📢 *Channel:* ${settings.channelId ? `<#${settings.channelId}>` : "_Not configured_"}`,
      `⏰ *Post time:* ${formattedTime}`,
      `🌍 *Timezone:* ${(settings.timezone || "_Not set_").replace(/_/g, " ")}`,
      `🎬 *GIF:* ${settings.includeGif ? "✅ Enabled" : "❌ Disabled"}`,
      `📣 *Mentions:* ${settings.mentionChannel ? "@channel (everyone)" : "Celebrants only"}`,
    ];

    if (!isBotInChannel && settings.channelId) {
      lines.push("\n⚠️ *Cheery is not in this channel! Please add Cheery to the channel so celebrations can be posted.*");
    }

    if (allRecorded) {
      lines.push("\n✅ All birthdays and work anniversaries have been recorded!");
    }

    return lines.join("\n");
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

  async function buildPreviewModal(client, settings, events, previewUserId) {
    const [channelName, birthdayTemplates, anniversaryTemplates] = await Promise.all([
      slack.getConversationName(client, settings.channelId),
      db.listBulkTemplates("birthday"),
      db.listBulkTemplates("anniversary"),
    ]);

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "✨ Upcoming Celebrations" },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Preview upcoming celebrations for ${channelName ? `*#${channelName}*` : "your channel"}.`,
          },
        ],
      },
      { type: "divider" },
    ];

    if (!events.length) {
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🏖️ *No upcoming events to preview*\n_All quiet for now — check back when celebrations are near!_",
          },
        },
      );
    } else {
      for (const event of events.slice(0, 8)) {
        const isBirthday = event.type === "birthday";
        const typeEmoji = isBirthday ? "🎂" : "💼";
        const typeLabel = isBirthday ? "Birthday" : "Work Anniversary";
        const dateStr = formatCelebrationDate(event.date, true);

        const templates = isBirthday ? birthdayTemplates : anniversaryTemplates;
        let templateName = "Default Template";
        
        if (templates.length > 0) {
          const history = await db.getBulkTemplateHistory(event.userId, event.type);
          const lastId = history?.lastTemplateId ?? null;
          let candidates = templates.filter((t) => t.id !== lastId);
          if (!candidates.length) candidates = templates;
          
          const chosen = candidates[Math.floor(Math.random() * candidates.length)];
          templateName = chosen.name;
        }

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${typeEmoji} *${typeLabel}* for <@${event.userId}> · 📅 ${dateStr}\n📝 *Template:* ${templateName}`,
          },
        });
      }
    }

    return {
      type: "modal",
      title: { type: "plain_text", text: "✨ Preview" },
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
      process.env.DEFAULT_CHANNEL_ID ||
      channelSettings[0]?.channelId ||
      null;
    const settings =
      channelSettings.find((entry) => entry.channelId === selectedChannelId) ||
      (await db.getChannelSettings(selectedChannelId));
    const reminders = (await db.listReminders(selectedChannelId)).filter(
      (reminder) => reminder.channelId === selectedChannelId || !reminder.channelId,
    );
    const missingUsers = isAdmin ? await db.listEmployeesMissingCelebrationData() : [];
    const upcoming = await buildUpcomingEvents(client, settings, homeState);

    let isBotInChannel = true;
    if (settings.channelId) {
      try {
        const info = await client.conversations.info({ channel: settings.channelId });
        isBotInChannel = info.channel?.is_member || false;
      } catch (error) {
        isBotInChannel = false;
      }
    }

    if (!isAdmin) {
      return {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "👋 Your Profile" },
          },
          {
            type: "context",
            elements: [
              {
                type: "plain_text",
                text: "Enter your birthdate and work anniversary so we can celebrate the right moments together. 🥳",
              },
            ],
          },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: buildDateSummary("🎂 Birthday", profile.birthday) },
              { type: "mrkdwn", text: buildDateSummary("💼 Anniversary", profile.anniversary) },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "👤 Update Profile" },
                action_id: "open_profile_modal",
              },
            ],
          },
        ],
      };
    }

    const blocks = [];

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
            text: buildSettingsSummary(settings, !missingUsers.length, isBotInChannel),
          },
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "⚡ Admin Actions" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "⚙️ General Settings" },
              action_id: "open_settings_modal",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👥 Manage Employees" },
              action_id: "open_view_employees",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "🔒 Manage Admins" },
              action_id: "open_manage_admins_modal",
            },
          ],
        },
        {
          type: "actions",
          elements: [

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
      ? reminders.map((reminder) => `⏰ ${reminder.daysBefore} day(s) · ${reminder.scope}`).join("\n")
      : "_No reminders configured yet_";

    blocks.push(
      { type: "divider" },
      {
        type: "header",
        text: { type: "plain_text", text: "👋 Your Profile" },
      },
      {
        type: "context",
        elements: [
          {
            type: "plain_text",
            text: "Enter your birthdate and work anniversary so we can celebrate the right moments together. 🥳",
          },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: buildDateSummary("🎂 Birthday", profile.birthday) },
          { type: "mrkdwn", text: buildDateSummary("💼 Anniversary", profile.anniversary) },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "👤 Update Profile" },
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
            placeholder: { type: "plain_text", text: "🔍 Search teammates…" },
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
        elements: [{ type: "plain_text", text: "🏖️ No upcoming events to show — check back later!" }],
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
                text: { type: "plain_text", text: "📊 Cheery Analytics" },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "plain_text",
                    text: "A snapshot of your team's celebration data and this month's activity.",
                  },
                ],
              },
              { type: "divider" },
              {
                type: "header",
                text: { type: "plain_text", text: "👥 Team Overview" },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: [
                    `👥 *Total employees:* ${analytics.totalEmployees}`,
                    `🎂 *Birthdays stored:* ${analytics.totalBirthdays}`,
                    `💼 *Anniversaries stored:* ${analytics.totalAnniversaries}`,
                    `⏰ *Active reminders:* ${analytics.remindersCount}`,
                  ].join("\n"),
                },
              },
              { type: "divider" },
              {
                type: "header",
                text: { type: "plain_text", text: "📅 This Month" },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: [
                    `🎂 *Birthdays celebrated:* ${automation.birthdaysSentThisMonth}`,
                    `💼 *Anniversaries celebrated:* ${automation.anniversariesSentThisMonth}`,
                    `⏳ *Events pending today:* ${automation.upcomingEventsCount}`,
                  ].join("\n"),
                },
              },
              { type: "divider" },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "🚫 *Opted-out Users*\nReview employees who have opted out of birthday or anniversary celebrations.",
                },
                accessory: {
                  type: "button",
                  text: { type: "plain_text", text: "🚫 View Opt-outs" },
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
            text: { type: "plain_text", text: "🚫 Opted-out Users" },
          },
          {
            type: "context",
            elements: [
              {
                type: "plain_text",
                text: "Employees who have chosen to skip birthday or anniversary celebrations.",
              },
            ],
          },
          { type: "divider" },
        ];

        if (!optedOutUsers.length) {
          blocks.push({
            type: "context",
            elements: [{ type: "plain_text", text: "✅ No users have opted out — everyone's celebrating!" }],
          });
        } else {
          for (const user of optedOutUsers) {
            const labels = [];
            if (user.birthdayOptOut) {
              labels.push("🎂 Birthday");
            }
            if (user.anniversaryOptOut) {
              labels.push("💼 Anniversary");
            }

            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<@${user.slackId}> · ${labels.join(" · ")}`,
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
