const { DateTime } = require("luxon");
const { formatCelebrationDate, ordinal } = require("../helpers/messages");

function createCalendarModule({ db, home, logger = console }) {
  async function buildCalendarView({ year, month, channelId }) {
    const currentMonth = DateTime.fromObject({ year, month, day: 1 });
    const startDate = currentMonth.startOf("month").toISODate();
    const endDate = currentMonth.endOf("month").toISODate();
    const today = DateTime.now();

    const [employees, sentEvents] = await Promise.all([
      db.listEmployees(),
      db.listSentEventsForRange({ startDate, endDate, channelId }),
    ]);

    const sentMap = new Set(
      sentEvents.map((event) => `${event.slack_id}_${event.type}_${event.date}_${event.channel_id || ""}`),
    );

    const dayMap = new Map();
    for (let day = 1; day <= currentMonth.daysInMonth; day += 1) {
      dayMap.set(day, []);
    }

    for (const employee of employees) {
      if (!employee.slackId) {
        continue;
      }

      if (employee.birthday?.day && employee.birthday?.month === month) {
        const date = DateTime.fromObject({ year, month, day: employee.birthday.day }).toISODate();
        dayMap.get(employee.birthday.day)?.push({
          type: "birthday",
          slackId: employee.slackId,
          date,
          isSent: sentMap.has(`${employee.slackId}_birthday_${date}_${channelId || ""}`),
        });
      }

      if (employee.anniversary?.day && employee.anniversary?.month === month) {
        const date = DateTime.fromObject({ year, month, day: employee.anniversary.day }).toISODate();
        const years = employee.anniversary.year ? year - employee.anniversary.year : null;
        dayMap.get(employee.anniversary.day)?.push({
          type: "anniversary",
          slackId: employee.slackId,
          date,
          years: years && years > 0 ? years : null,
          isSent: sentMap.has(`${employee.slackId}_anniversary_${date}_${channelId || ""}`),
        });
      }
    }

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `📅 ${currentMonth.toFormat("LLLL yyyy")}` },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Browse upcoming celebrations for ${channelId ? `<#${channelId}>` : "the default channel"}. Navigate months with the arrows below.`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "⬅️ Previous" },
            action_id: "calendar_prev",
            value: JSON.stringify({ year, month, channelId }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "➡️ Next" },
            action_id: "calendar_next",
            value: JSON.stringify({ year, month, channelId }),
          },
        ],
      },
      { type: "divider" },
    ];

    let hasEvents = false;
    for (let day = 1; day <= currentMonth.daysInMonth; day += 1) {
      const events = dayMap.get(day) || [];
      if (!events.length) {
        continue;
      }

      hasEvents = true;
      const dayDate = DateTime.fromObject({ year, month, day });
      const prefix = dayDate.hasSame(today, "day") ? "👉 " : "";
      const lines = events.map((event) => {
        const sentPrefix = event.isSent ? "✅ " : "⏳ ";
        if (event.type === "birthday") {
          return `${sentPrefix}🎂 <@${event.slackId}>`;
        }
        return `${sentPrefix}💼 <@${event.slackId}>${event.years ? ` — ${ordinal(event.years)}` : ""}`;
      });

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${prefix}*${formatCelebrationDate(dayDate, true)}*\n${lines.join("\n")}`,
        },
      });
    }

    if (!hasEvents) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "🏖️ _No celebrations this month — enjoy the quiet!_" }],
      });
    }

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "✅ Sent · ⏳ Pending · 🎂 Birthday · 💼 Anniversary · 👉 Today",
          },
        ],
      },
    );

    return {
      type: "modal",
      title: { type: "plain_text", text: "📅 Calendar" },
      close: { type: "plain_text", text: "Close" },
      private_metadata: JSON.stringify({ year, month, channelId }),
      blocks,
    };
  }

  function register(app) {
    app.action("open_calendar_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const homeState = home.getState(body.user.id);
        const channelId = homeState.selectedChannelId || process.env.DEFAULT_CHANNEL_ID || null;
        const now = DateTime.now();
        await client.views.open({
          trigger_id: body.trigger_id,
          view: await buildCalendarView({ year: now.year, month: now.month, channelId }),
        });
      } catch (error) {
        logger.error("Failed to open calendar modal", error);
      }
    });

    app.action("calendar_prev", async ({ ack, body, action, client }) => {
      await ack();

      try {
        const metadata = JSON.parse(action.value);
        const previous = DateTime.fromObject({ year: metadata.year, month: metadata.month, day: 1 }).minus({
          months: 1,
        });

        await client.views.update({
          view_id: body.view.id,
          view: await buildCalendarView({
            year: previous.year,
            month: previous.month,
            channelId: metadata.channelId || null,
          }),
        });
      } catch (error) {
        logger.error("Failed to navigate calendar backwards", error);
      }
    });

    app.action("calendar_next", async ({ ack, body, action, client }) => {
      await ack();

      try {
        const metadata = JSON.parse(action.value);
        const next = DateTime.fromObject({ year: metadata.year, month: metadata.month, day: 1 }).plus({
          months: 1,
        });

        await client.views.update({
          view_id: body.view.id,
          view: await buildCalendarView({
            year: next.year,
            month: next.month,
            channelId: metadata.channelId || null,
          }),
        });
      } catch (error) {
        logger.error("Failed to navigate calendar forwards", error);
      }
    });
  }

  return {
    register,
    buildCalendarView,
  };
}

module.exports = {
  createCalendarModule,
};
