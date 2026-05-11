const { DateTime } = require("luxon");

const BIRTHDAY_GIFS = [
  "https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
  "https://media.giphy.com/media/3oEhmNLxk9uiTbL9Be/giphy.gif",
  "https://media.giphy.com/media/26FPpSuhgHvYo9Kyk/giphy.gif",
  "https://media.giphy.com/media/Im6d35ebkCIiGzonjI/giphy.gif",
];

const ANNIVERSARY_GIFS = [
  "https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif",
  "https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif",
  "https://media.giphy.com/media/fPRwBcYd71Lox1v7p2/giphy.gif",
  "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif",
];

const CELEBRATION_INTROS = [
  "Your daily dose of celebration is here, let's do it 🎉",
  "Time to celebrate our amazing team! 🥳",
  "Another reason to smile at work today 🎊",
  "Let the celebrations begin! 🎉",
  "Hey team, it's party time! 🥂",
];

const CHEERS = [
  "Let's give <@USER> a big cheer for being awesome! 🎉",
  "Everyone show some love for <@USER>! 💛",
  "Drop a 🎉 in the chat for <@USER>!",
  "Three cheers for <@USER>! Hip hip hooray! 🥳",
  "Give it up for <@USER>! 👏🎉",
];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ordinal(value) {
  const r10 = value % 10;
  const r100 = value % 100;
  if (r10 === 1 && r100 !== 11) return `${value}st`;
  if (r10 === 2 && r100 !== 12) return `${value}nd`;
  if (r10 === 3 && r100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function createTestCenterModule({ db, slack, home, logger = console }) {
  function buildDexStyleMessage({ type, slackId, years }) {
    const intro = randomPick(CELEBRATION_INTROS);
    const cheer = randomPick(CHEERS).replace("<@USER>", `<@${slackId}>`);
    const gif =
      type === "birthday"
        ? randomPick(BIRTHDAY_GIFS)
        : randomPick(ANNIVERSARY_GIFS);
    const now = DateTime.now();

    const parts = ["<!channel>", "", intro, ""];

    if (type === "birthday") {
      parts.push(`Today, we are celebrating 1 event:`, "");
      parts.push(`<@${slackId}>`);
      parts.push(`🎂 Happy Birthday!`);
      parts.push(now.toFormat("LLLL d"));
    } else {
      const yearLabel = years ? `#${years}` : "";
      parts.push(`Today, we are celebrating 1 event:`, "");
      parts.push(`<@${slackId}>`);
      parts.push(`💼 Work anniversary ${yearLabel}`);
      parts.push(now.toFormat("LLLL d"));
    }

    parts.push("", "───────────────────────", "");
    parts.push(cheer, "");
    parts.push(gif);

    return parts.join("\n");
  }

  function buildTestCenterModal() {
    return {
      type: "modal",
      callback_id: "test_center_modal",
      title: { type: "plain_text", text: "🧪 Test Center" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🧪 Test Center" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Send test messages to preview how Dex celebrations look. *No data is stored.*",
            },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🎂 *Test Birthday Message*\nSend a mock birthday celebration to yourself.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "🎂 Send Test" },
            action_id: "test_send_birthday",
            style: "primary",
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "💼 *Test Anniversary Message*\nSend a mock work anniversary celebration to yourself.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "💼 Send Test" },
            action_id: "test_send_anniversary",
            style: "primary",
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "📦 *Preview Batch Run*\nSimulate what a full daily batch would look like.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "📦 Preview" },
            action_id: "test_preview_batch",
          },
        },
      ],
    };
  }

  function register(app) {
    app.action("open_test_center_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildTestCenterModal(),
        });
      } catch (error) {
        logger.error("Failed to open test center modal", error);
      }
    });

    app.action("test_send_birthday", async ({ ack, body, client }) => {
      await ack();

      try {
        const userId = body.user.id;
        const message = buildDexStyleMessage({
          type: "birthday",
          slackId: userId,
        });

        const dmChannelId = await slack.openDirectMessage(client, userId);
        await client.chat.postMessage({
          channel: dmChannelId,
          text: "🧪 Test Birthday Message",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🧪 *Test Birthday Preview*\n\n${message}`,
              },
            },
          ],
        });
      } catch (error) {
        logger.error("Failed to send test birthday", error);
      }
    });

    app.action("test_send_anniversary", async ({ ack, body, client }) => {
      await ack();

      try {
        const userId = body.user.id;
        const message = buildDexStyleMessage({
          type: "anniversary",
          slackId: userId,
          years: 3,
        });

        const dmChannelId = await slack.openDirectMessage(client, userId);
        await client.chat.postMessage({
          channel: dmChannelId,
          text: "🧪 Test Anniversary Message",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🧪 *Test Anniversary Preview*\n\n${message}`,
              },
            },
          ],
        });
      } catch (error) {
        logger.error("Failed to send test anniversary", error);
      }
    });

    app.action("test_preview_batch", async ({ ack, body, client }) => {
      await ack();

      try {
        const employees = await db.listEmployees();
        const now = DateTime.now();
        const todaysBirthdays = employees.filter(
          (e) =>
            e.birthday &&
            e.birthday.day === now.day &&
            e.birthday.month === now.month &&
            !e.birthdayOptOut
        );
        const todaysAnniversaries = employees.filter(
          (e) =>
            e.anniversary &&
            e.anniversary.day === now.day &&
            e.anniversary.month === now.month &&
            !e.anniversaryOptOut
        );

        const totalEvents =
          todaysBirthdays.length + todaysAnniversaries.length;
        const lines = [
          `📊 *Summary*`,
          "",
          `🌟 Total events today: *${totalEvents}*`,
          `🎂 Birthdays: *${todaysBirthdays.length}*`,
          `💼 Anniversaries: *${todaysAnniversaries.length}*`,
          "",
        ];

        for (const emp of todaysBirthdays) {
          lines.push(`🎂 <@${emp.slackId}>`);
        }
        for (const emp of todaysAnniversaries) {
          const years = emp.anniversary?.year
            ? now.year - emp.anniversary.year
            : null;
          const yearLabel = years && years > 0 ? ` — ${ordinal(years)}` : "";
          lines.push(`💼 <@${emp.slackId}>${yearLabel}`);
        }

        if (!totalEvents) {
          lines.push("🏖️ _No events scheduled for today — enjoy the quiet!_");
        }

        await client.views.push({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "📦 Batch Preview" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: `📦 Batch Preview — ${now.toFormat("LLLL d, yyyy")}` },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: "This is a simulation of what a full daily batch run would look like. No messages are sent.",
                  },
                ],
              },
              { type: "divider" },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: lines.join("\n"),
                },
              },
            ],
          },
        });
      } catch (error) {
        logger.error("Failed to preview batch", error);
      }
    });
  }

  return {
    register,
  };
}

module.exports = {
  createTestCenterModule,
};
