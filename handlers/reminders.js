const { REMINDER_SCOPE_DEFAULT, selectedValue } = require("../helpers/events");

function createRemindersModule({ db, home }) {
  function buildReminderModal(channelId, existingReminders = []) {
    const selectedDays = existingReminders.map((reminder) => String(reminder.daysBefore));
    const initialOptions = selectedDays
      .map((day) =>
        [
          { text: { type: "plain_text", text: "⏰ 1 day before" }, value: "1" },
          { text: { type: "plain_text", text: "📅 7 days before" }, value: "7" },
          { text: { type: "plain_text", text: "📆 14 days before" }, value: "14" },
        ].find((option) => option.value === day),
      )
      .filter(Boolean);
    const scope = existingReminders[0]?.scope || REMINDER_SCOPE_DEFAULT;

    return {
      type: "modal",
      callback_id: "save_reminders_modal",
      private_metadata: JSON.stringify({ channelId }),
      title: { type: "plain_text", text: "⏰ Reminders" },
      submit: { type: "plain_text", text: "💾 Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "⏰ Create Reminder" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Get notified before upcoming birthdays and work anniversaries so you never miss a celebration. Reminders go to admins and/or the channel.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "input",
          block_id: "days_before",
          optional: true,
          label: { type: "plain_text", text: "🔔 When should reminders fire?" },
          element: {
            type: "multi_static_select",
            action_id: "value",
            placeholder: { type: "plain_text", text: "Select reminder offsets" },
            options: [
              { text: { type: "plain_text", text: "⏰ 1 day before" }, value: "1" },
              { text: { type: "plain_text", text: "📅 7 days before" }, value: "7" },
              { text: { type: "plain_text", text: "📆 14 days before" }, value: "14" },
            ],
            ...(initialOptions.length ? { initial_options: initialOptions } : {}),
          },
        },
        {
          type: "input",
          block_id: "scope",
          label: { type: "plain_text", text: "📣 Who should be notified?" },
          element: {
            type: "static_select",
            action_id: "value",
            options: [
              { text: { type: "plain_text", text: "📢 Channel" }, value: "channel" },
              { text: { type: "plain_text", text: "🔒 Admins only" }, value: "admins" },
              { text: { type: "plain_text", text: "📢 Channel + 🔒 Admins" }, value: "channel_and_admins" },
            ],
            initial_option: {
              text: {
                type: "plain_text",
                text:
                  scope === "admins"
                    ? "🔒 Admins only"
                    : scope === "channel_and_admins"
                      ? "📢 Channel + 🔒 Admins"
                      : "📢 Channel",
              },
              value: scope,
            },
          },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 *Channel* → posts a reminder in the celebration channel. *Admins only* → sends a DM to each admin. *Both* → does both. Reminders run once daily, independent of your post time.",
            },
          ],
        },
      ],
    };
  }

  function register(app) {
    app.action("open_create_reminder_modal", async ({ ack, body, action, client }) => {
      await ack();

      if (!(await db.isAdmin(body.user.id))) {
        return;
      }

      const channelId = action.value || process.env.DEFAULT_CHANNEL_ID || null;
      const reminders = await db.listReminders(channelId);

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildReminderModal(channelId, reminders.filter((row) => row.channelId === channelId || !row.channelId)),
      });
    });

    app.view("save_reminders_modal", async ({ ack, view, body, client }) => {
      const selectedDays = view.state.values.days_before.value.selected_options.map((option) => option.value);

      await ack({ response_action: "clear" });

      const metadata = JSON.parse(view.private_metadata || "{}");
      const channelId = metadata.channelId || process.env.DEFAULT_CHANNEL_ID || null;
      const scope = selectedValue(view.state.values.scope.value) || REMINDER_SCOPE_DEFAULT;

      await db.replaceReminders({
        channelId,
        daysBefore: selectedDays,
        scope,
        createdBy: body.user.id,
      });

      home.setState(body.user.id, { selectedChannelId: channelId, page: 1 });
      await home.publishHome(client, body.user.id);
    });
  }

  return {
    register,
  };
}

module.exports = {
  createRemindersModule,
};
