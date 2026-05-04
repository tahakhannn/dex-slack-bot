const { SETTINGS_DEFAULTS, TIMEZONE_OPTIONS, selectedValue } = require("../helpers/events");

function createSettingsModule({ db, slack, home, logger = console }) {
  function staticSelectInput({ blockId, label, options, initialValue, placeholder }) {
    return {
      type: "input",
      block_id: blockId,
      label: { type: "plain_text", text: label },
      element: {
        type: "static_select",
        action_id: "value",
        placeholder: { type: "plain_text", text: placeholder || label },
        options,
        ...(initialValue
          ? { initial_option: options.find((option) => option.value === String(initialValue)) }
          : {}),
      },
    };
  }

  function checkboxInput({ blockId, label, optionText, initialChecked = false }) {
    return {
      type: "input",
      block_id: blockId,
      optional: true,
      label: { type: "plain_text", text: label },
      element: {
        type: "checkboxes",
        action_id: "value",
        options: [
          {
            text: { type: "plain_text", text: optionText },
            value: "true",
          },
        ],
        ...(initialChecked
          ? {
              initial_options: [
                {
                  text: { type: "plain_text", text: optionText },
                  value: "true",
                },
              ],
            }
          : {}),
      },
    };
  }

  function isChecked(values, blockId) {
    return (values?.[blockId]?.value?.selected_options || []).some((option) => option.value === "true");
  }

  function buildStepOneModal(settings, includeChannelPicker = false) {
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "🎂 Settings (1/2)" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: settings.channelId ? `<#${settings.channelId}>` : "No channel selected yet",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Adjust posting time, timezone, and GIF options on the next page.",
          },
        ],
      },
      { type: "divider" },
    ];

    if (includeChannelPicker) {
      blocks.push({
        type: "input",
        block_id: "channel_id",
        label: { type: "plain_text", text: "Choose a channel" },
        element: {
          type: "conversations_select",
          action_id: "value",
          filter: {
            include: ["public", "private"],
            exclude_bot_users: true,
          },
          ...(settings.channelId ? { initial_conversation: settings.channelId } : {}),
        },
      });
    }

    blocks.push(
      staticSelectInput({
        blockId: "who_to_celebrate",
        label: "Who should be celebrated?",
        options: [
          {
            text: { type: "plain_text", text: "All members" },
            value: "everyone",
          },
          {
            text: { type: "plain_text", text: "No members" },
            value: "none",
          },
        ],
        initialValue: settings.whoToCelebrate,
        placeholder: "Choose who should be celebrated",
      }),
      checkboxInput({
        blockId: "include_birthdays",
        label: "Birthdays",
        optionText: "Celebrate birthdays",
        initialChecked: settings.includeBirthdays,
      }),
      checkboxInput({
        blockId: "include_anniversaries",
        label: "Work anniversaries",
        optionText: "Celebrate work anniversaries",
        initialChecked: settings.includeAnniversaries,
      })
    );

    return {
      type: "modal",
      callback_id: "settings_step_1_submit",
      title: { type: "plain_text", text: "🎂 Settings" },
      submit: { type: "plain_text", text: "Next" },
      close: { type: "plain_text", text: "Cancel" },
      private_metadata: JSON.stringify({
        channelId: settings.channelId || null,
        includeChannelPicker,
      }),
      blocks,
    };
  }

  function buildStepTwoModal(stepOne) {
    return {
      type: "modal",
      callback_id: "settings_step_2_submit",
      title: { type: "plain_text", text: "🎂 Settings" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      private_metadata: JSON.stringify(stepOne),
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🎂 Settings (2/2)" },
        },
        {
          type: "input",
          block_id: "post_time",
          label: { type: "plain_text", text: "Post time" },
          element: {
            type: "timepicker",
            action_id: "value",
            initial_time: stepOne.postTime || SETTINGS_DEFAULTS.postTime,
            placeholder: { type: "plain_text", text: "Select a time" },
          },
        },
        staticSelectInput({
          blockId: "timezone",
          label: "Timezone",
          options: TIMEZONE_OPTIONS.map((tz) => ({
            text: { type: "plain_text", text: tz.label },
            value: tz.value,
          })),
          initialValue: stepOne.timezone || SETTINGS_DEFAULTS.timezone,
          placeholder: "Choose a timezone",
        }),
        checkboxInput({
          blockId: "include_gif",
          label: "GIF",
          optionText: "Include GIF",
          initialChecked: stepOne.includeGif,
        }),
        checkboxInput({
          blockId: "mention_channel",
          label: "Mention",
          optionText: "Include @channel mention",
          initialChecked: stepOne.mentionChannel,
        }),
      ],
    };
  }

  function register(app) {
    app.action("open_settings_modal", async ({ ack, body, action, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const channelId = action?.value || process.env.DEFAULT_CHANNEL_ID || null;
        const settings = await db.getChannelSettings(channelId);
        const includeChannelPicker = !action?.value;

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildStepOneModal(settings, includeChannelPicker),
        });
      } catch (error) {
        logger.error("Failed to open settings modal", error);
      }
    });

    app.view("settings_step_1_submit", async ({ ack, view }) => {
      try {
        const values = view.state.values;
        const metadata = JSON.parse(view.private_metadata || "{}");
        const channelId = metadata.includeChannelPicker
          ? selectedValue(values.channel_id?.value)
          : metadata.channelId;

        if (!channelId) {
          await ack({
            response_action: "errors",
            errors: {
              channel_id: "Choose a channel before continuing.",
            },
          });
          return;
        }

        const existing = await db.getChannelSettings(channelId);
        const nextState = {
          ...existing,
          channelId,
          whoToCelebrate: selectedValue(values.who_to_celebrate.value) || "everyone",
          includeBirthdays: isChecked(values, "include_birthdays"),
          includeAnniversaries: isChecked(values, "include_anniversaries"),
        };

        await ack({
          response_action: "push",
          view: buildStepTwoModal(nextState),
        });
      } catch (error) {
        logger.error("Failed to process settings step 1", error);
        await ack();
      }
    });

    app.view("settings_step_2_submit", async ({ ack, view, body, client }) => {
      const values = view.state.values;
      const stepOne = JSON.parse(view.private_metadata || "{}");

      await ack();

      try {
        const settings = {
          ...stepOne,
          postTime: values.post_time.value.selected_time || SETTINGS_DEFAULTS.postTime,
          timezone: selectedValue(values.timezone.value) || SETTINGS_DEFAULTS.timezone,
          includeGif: isChecked(values, "include_gif"),
          mentionChannel: isChecked(values, "mention_channel"),
          tagChannel: isChecked(values, "mention_channel"),
          // Preserve missing fields using defaults
          frequency: stepOne.frequency || SETTINGS_DEFAULTS.frequency,
          weekendPolicy: stepOne.weekendPolicy || SETTINGS_DEFAULTS.weekendPolicy,
          style: stepOne.style || "fun",
          language: stepOne.language || "en",
          autoCollect: stepOne.autoCollect ?? false,
        };

        settings.channelName = await slack.getConversationName(client, settings.channelId);
        await db.saveChannelSettings(settings);
        home.setState(body.user.id, { selectedChannelId: settings.channelId, page: 1 });
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save settings step 2", error);
      }
    });
  }

  return {
    register,
  };
}

module.exports = {
  createSettingsModule,
};
