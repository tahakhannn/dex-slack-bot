const { WebClient } = require("@slack/web-api");

function createSlackHelpers({ logger = console } = {}) {
  const userCache = new Map();
  const channelCache = new Map();
  const ttlMs = 15 * 60 * 1000;

  function isFresh(entry) {
    return entry && Date.now() - entry.fetchedAt < ttlMs;
  }

  async function getUserInfo(client, userId) {
    const cached = userCache.get(userId);
    if (isFresh(cached)) {
      return cached.value;
    }

    try {
      const response = await client.users.info({ user: userId });
      const user = response.user || null;
      userCache.set(userId, { fetchedAt: Date.now(), value: user });
      return user;
    } catch (error) {
      logger.error(`users.info failed for ${userId}`, error?.data || error);
      return null;
    }
  }

  async function getUserStatus(client, userId) {
    const user = await getUserInfo(client, userId);

    if (!user || user.deleted) {
      return "deactivated";
    }

    if (user.presence === "away") {
      return "inactive";
    }

    return "active";
  }

  async function getUserDisplay(client, userId) {
    const user = await getUserInfo(client, userId);
    const profile = user?.profile || {};

    return {
      id: userId,
      name:
        profile.display_name ||
        profile.real_name ||
        user?.real_name ||
        user?.name ||
        userId,
      avatar:
        profile.image_192 ||
        profile.image_72 ||
        profile.image_48 ||
        "https://api.slack.com/img/blocks/bkb_template_images/notifications.png",
      thumbnail:
        profile.image_72 ||
        profile.image_48 ||
        profile.image_192 ||
        "https://api.slack.com/img/blocks/bkb_template_images/notifications.png",
      deleted: Boolean(user?.deleted),
    };
  }

  async function getConversationName(client, channelId) {
    if (!channelId) {
      return "Not configured";
    }

    const cached = channelCache.get(channelId);
    if (isFresh(cached)) {
      return cached.value;
    }

    try {
      const response = await client.conversations.info({ channel: channelId });
      const channel = response.channel;
      const name = channel?.is_im ? "Direct messages" : `#${channel?.name || channelId}`;
      channelCache.set(channelId, { fetchedAt: Date.now(), value: name });
      return name;
    } catch (error) {
      logger.error(`conversations.info failed for ${channelId}`, error?.data || error);
      return channelId;
    }
  }

  async function openDirectMessage(client, userId) {
    const response = await client.conversations.open({ users: userId });
    return response.channel?.id || null;
  }

  function buildCelebrationBlocks({ event, display, settings }) {
    const icon = event.type === "birthday" ? "🎂" : "💼";
    const title = event.type === "birthday" ? "Birthday" : "Work Anniversary";
    // Always prepend <!channel> for celebration announcements.
    const gifLine = settings.includeGif ? "\n🎉 Let's celebrate together." : "";

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<!channel>\n${icon} *${title} alert*\nToday we're celebrating <@${event.userId}>.${gifLine}`,
        },
        accessory: {
          type: "image",
          image_url: display.avatar,
          alt_text: display.name,
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `🎉 ${display.name}` },
          {
            type: "mrkdwn",
            text: settings.style === "formal" ? "Celebrate with appreciation." : "Celebrate with heart.",
          },
        ],
      },
    ];
  }

  async function postCelebrationMessage(client, { channelId, event, settings }) {
    const display = await getUserDisplay(client, event.userId);

    await client.chat.postMessage({
      channel: channelId,
      text: `${event.type === "birthday" ? "🎂" : "💼"} Celebration for ${display.name}`,
      blocks: buildCelebrationBlocks({ event, display, settings }),
    });
  }

  async function postReminderMessage(client, { channelId, event, daysBefore }) {
    const display = await getUserDisplay(client, event.userId);
    const icon = event.type === "birthday" ? "🎂" : "💼";
    const typeLabel = event.type === "birthday" ? "Birthday" : "Work Anniversary";
    const whenText = daysBefore === 1 ? "tomorrow" : `in ${daysBefore} day(s)`;

    await client.chat.postMessage({
      channel: channelId,
      text: `${icon} Reminder: ${display.name}'s ${typeLabel.toLowerCase()} is ${whenText}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔔 *Upcoming ${typeLabel}*\n<@${event.userId}>'s ${typeLabel.toLowerCase()} is *${whenText}*!`,
          },
          accessory: {
            type: "image",
            image_url: display.avatar,
            alt_text: display.name,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${icon} ${typeLabel} · ⏰ ${whenText} · 📢 Reminder`,
            },
          ],
        },
      ],
    });
  }

  async function getUserEmail(client, userId) {
    const user = await getUserInfo(client, userId);
    return user?.profile?.email || null;
  }

  async function syncUserEmailFromSlack(client, userId, db) {
    try {
      const email = await getUserEmail(client, userId);
      if (email) {
        await db.syncUserEmail(userId, email);
      }
    } catch (error) {
      logger.error(`Email sync failed for ${userId}`, error);
    }
  }

  async function ensureSlackUserRecord(client, userId, db) {
    try {
      const user = await getUserInfo(client, userId);
      if (!user?.id || user.is_bot) {
        return null;
      }

      return db.ensureSlackUser({
        slackId: user.id,
        name:
          user.profile?.display_name ||
          user.profile?.real_name ||
          user.real_name ||
          user.name ||
          "Employee",
        email: user.profile?.email || null,
      });
    } catch (error) {
      logger.error(`Failed to ensure Slack user record for ${userId}`, error);
      return null;
    }
  }

  async function ensureSlackEventUserRecord(user, db) {
    try {
      if (!user?.id || user.is_bot) {
        return null;
      }

      return db.ensureSlackUser({
        slackId: user.id,
        name:
          user.profile?.display_name ||
          user.profile?.real_name ||
          user.real_name ||
          user.name ||
          "Employee",
        email: user.profile?.email || null,
      });
    } catch (error) {
      logger.error(`Failed to ensure Slack event user record for ${user?.id}`, error);
      return null;
    }
  }

  async function sendAdminAddedNotification(client, userId) {
    try {
      const dmChannel = await openDirectMessage(client, userId);
      if (!dmChannel) {
        return;
      }

      await client.chat.postMessage({
        channel: dmChannel,
        text: "Admin access granted",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                "*Admin access granted*",
                "",
                "You can now:",
                "• Manage employees 👥",
                "• Configure celebration settings ⚙️",
                "• Control automation rules 🤖",
              ].join("\n"),
            },
          },
        ],
      });
    } catch (error) {
      logger.error(`Failed to send admin added notification to ${userId}`, error);
    }
  }

  async function sendAdminRemovedNotification(client, userId) {
    try {
      const dmChannel = await openDirectMessage(client, userId);
      if (!dmChannel) {
        return;
      }

      await client.chat.postMessage({
        channel: dmChannel,
        text: "⚠️ Your admin access has been removed.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                "⚠️ *Your admin access has been removed.*",
                "",
                "If this seems incorrect, please contact your workspace admin.",
              ].join("\n"),
            },
          },
        ],
      });
    } catch (error) {
      logger.error(`Failed to send admin removed notification to ${userId}`, error);
    }
  }

  return {
    WebClient,
    getUserInfo,
    getUserStatus,
    getUserDisplay,
    getUserEmail,
    syncUserEmailFromSlack,
    getConversationName,
    openDirectMessage,
    postCelebrationMessage,
    postReminderMessage,
    sendAdminAddedNotification,
    sendAdminRemovedNotification,
    ensureSlackUserRecord,
    ensureSlackEventUserRecord,
  };
}

module.exports = {
  createSlackHelpers,
};
