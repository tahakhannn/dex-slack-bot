const { DateTime } = require("luxon");
const { buildDateInputBlocks, parseDateInput, parseCheckboxValues } = require("../helpers/events");

function createOnboardingModule({ db, slack, home }) {
  function buildProfileModal({ userId, profile, source }) {

    return {
      type: "modal",
      callback_id: "save_user_profile_modal",
      private_metadata: JSON.stringify({ userId, source }),
      title: { type: "plain_text", text: source === "onboarding" ? "Start Setup" : "Your Profile" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🎉 Share your birthday and work anniversary so Dex can celebrate the right moments.",
          },
        },
        ...buildDateInputBlocks({
          prefix: "birthday",
          label: "Birthday",
          initialDate: profile?.birthday,
        }),
        ...buildDateInputBlocks({
          prefix: "anniversary",
          label: "Anniversary",
          initialDate: profile?.anniversary,
        }),
      ],
    };
  }

  async function maybeSendOnboardingPrompt(client, userId) {
    const profile = await db.getUserProfile(userId);
    if (profile.onboarded) {
      return;
    }

    const lastSent = profile.lastOnboardingSent
      ? DateTime.fromISO(profile.lastOnboardingSent)
      : null;

    if (lastSent && DateTime.now().diff(lastSent, "hours").hours < 24) {
      return;
    }

    const dmChannelId = await slack.openDirectMessage(client, userId);
    await client.chat.postMessage({
      channel: dmChannelId,
      text: "🎉 Welcome to Dex setup.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*🎉 Dex onboarding*\nAdd your birthday and anniversary once so celebrations stay accurate.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Start Setup" },
              action_id: "start_onboarding_setup",
            },
          ],
        },
      ],
    });

    await db.markOnboardingSent(userId);
  }

  function register(app) {
    app.event("app_home_opened", async ({ event, client }) => {
      await slack.ensureSlackUserRecord(client, event.user, db);
      await maybeSendOnboardingPrompt(client, event.user);
    });

    app.event("team_join", async ({ event, client }) => {
      if (event.user?.is_bot) {
        return;
      }

      await slack.ensureSlackEventUserRecord(event.user, db);
      await slack.syncUserEmailFromSlack(client, event.user.id, db);
      await maybeSendOnboardingPrompt(client, event.user.id);
    });

    app.action("start_onboarding_setup", async ({ ack, body, client }) => {
      await ack();
      const profile = await db.getUserProfile(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildProfileModal({
          userId: body.user.id,
          profile,
          source: "onboarding",
        }),
      });
    });

    app.action("open_profile_modal", async ({ ack, body, client }) => {
      await ack();
      const profile = await db.getUserProfile(body.user.id);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildProfileModal({
          userId: body.user.id,
          profile,
          source: "home",
        }),
      });
    });

    app.view("save_user_profile_modal", async ({ ack, view, body, client }) => {
      await ack();

      const metadata = JSON.parse(view.private_metadata || "{}");
      const birthday = parseDateInput(view.state.values, "birthday");
      const anniversary = parseDateInput(view.state.values, "anniversary");
      const display = await slack.getUserDisplay(client, metadata.userId);
      const profile = await db.getUserProfile(metadata.userId);

      await db.saveEmployee({
        slackId: metadata.userId,
        name: display.name,
        birthday,
        anniversary,
        onboarded: true,
        birthdayOptOut: profile?.birthdayOptOut || false,
        anniversaryOptOut: profile?.anniversaryOptOut || false,
      });

      await slack.syncUserEmailFromSlack(client, metadata.userId, db);

      await db.markOnboarded(metadata.userId);
      await home.publishHome(client, body.user.id);
    });
  }

  return {
    register,
    maybeSendOnboardingPrompt,
  };
}

module.exports = {
  createOnboardingModule,
};
