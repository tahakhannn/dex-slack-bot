const cron = require("node-cron");
const { DateTime } = require("luxon");
const { buildEventRecord, computeReminderDate, eventKey } = require("../helpers/events");
const {
  DEFAULT_GIFS,
  buildCelebrationBlocks,
  buildCelebrationTextFallback,
  buildEventId,
  getAnniversaryTone,
  getAnniversaryYears,
  ordinal,
  renderTemplate,
} = require("../helpers/messages");

const STYLE_ALIASES = {
  playful: "fun",
  formatted: "fun",
  formal: "professional",
};

const DEFAULT_MESSAGES = {
  fun: {
    birthday: [
      "Let's give <@USER> a big cheer for being awesome! 🎊",
      "Big applause for <@USER> today! 👏",
      "Cheers to <@USER> and an amazing birthday! 🥂",
    ],
    anniversary: [
      "Let's celebrate <@USER> and this {ANNIV_YEARS} milestone — {TONE}! 🎊",
      "Big applause for <@USER> on this {ANNIV_YEARS} work anniversary — {TONE}! 👏",
      "Cheers to <@USER> for reaching {ANNIV_YEARS} years — {TONE}! 🥂",
    ],
  },
  professional: {
    birthday: [
      "Please join us in celebrating <@USER> today. 🎊",
      "Wishing <@USER> a wonderful birthday and year ahead. 👏",
      "A warm celebration for <@USER> today. 🥂",
    ],
    anniversary: [
      "Please join us in celebrating <@USER> and this {ANNIV_YEARS} milestone — {TONE}.",
      "Recognizing <@USER> on a {ANNIV_YEARS} work anniversary — {TONE}.",
      "Thank you, <@USER>, for this {ANNIV_YEARS} milestone — {TONE}.",
    ],
  },
  minimal: {
    birthday: [
      "Cheers to <@USER> today! 🎊",
      "Happy birthday, <@USER>! 👏",
      "Celebrating <@USER> today. 🥂",
    ],
    anniversary: [
      "Celebrating <@USER> and {ANNIV_YEARS} years — {TONE}.",
      "Congrats to <@USER> on {ANNIV_YEARS} years — {TONE}.",
      "A milestone for <@USER>: {ANNIV_YEARS} years — {TONE}.",
    ],
  },
};

function createScheduler({ app, db, slack, logger = console }) {
  const sentCache = new Map();
  const circuitBreaker = {
    consecutiveFailures: 0,
    pausedUntil: null,
  };
  const syncState = {
    lastUserSyncAt: null,
  };
  let isRunning = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeStyle(style) {
    return STYLE_ALIASES[style] || style || "fun";
  }

  function parseScheduledTime(now, postTime) {
    const match = String(postTime || "").trim().match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    return now.set({
      hour: Number(match[1]),
      minute: Number(match[2]),
      second: 0,
      millisecond: 0,
    });
  }

  function canRunNow(settings, now) {
    if (!settings.channelId || !settings.postTime || settings.whoToCelebrate === "none") {
      return false;
    }

    const scheduledTime = parseScheduledTime(now, settings.postTime);
    if (!scheduledTime || !scheduledTime.isValid) {
      return false;
    }

    const diffMinutes = now.diff(scheduledTime, "minutes").minutes;
    if (diffMinutes < 0 || diffMinutes > 15) {
      return false;
    }

    switch (settings.frequency) {
      case "weekdays":
        return now.weekday <= 5;
      case "weekly":
        return now.weekday === 1;
      case "daily":
      default:
        return true;
    }
  }

  function recordFailure(now) {
    circuitBreaker.consecutiveFailures += 1;
    if (circuitBreaker.consecutiveFailures >= 5) {
      circuitBreaker.pausedUntil = now.plus({ minutes: 15 });
      logger.error(
        `Circuit breaker activated until ${circuitBreaker.pausedUntil.toISO()} after ${circuitBreaker.consecutiveFailures} failures.`,
      );
    }
  }

  function recordSuccess() {
    circuitBreaker.consecutiveFailures = 0;
    circuitBreaker.pausedUntil = null;
  }

  function alreadySentReminder(key) {
    const lastSent = sentCache.get(key);
    return Boolean(lastSent && Date.now() - lastSent < 24 * 60 * 60 * 1000);
  }

  function markReminderSent(key) {
    sentCache.set(key, Date.now());
  }

  function chooseSmartIndex(length, lastIndex) {
    if (!Number.isFinite(length) || length <= 0) {
      return null;
    }
    if (length === 1) {
      return 0;
    }

    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * length);
    } while (nextIndex === lastIndex);

    return nextIndex;
  }

  async function chooseMessageAndGif({ slackId, type, style }) {
    const dbTemplate = await db.getTemplate(type);
    if (dbTemplate?.message) {
      const gifUrls = dbTemplate.gifUrls || [];
      const gifIndex = gifUrls.length ? Math.floor(Math.random() * gifUrls.length) : null;
      return {
        messageIndex: 0,
        gifIndex,
        messageTemplate: dbTemplate.message,
        introText: dbTemplate.introText || "",
        gifUrl: gifIndex !== null ? gifUrls[gifIndex] : null,
        isDbTemplate: true,
      };
    }

    const normalizedStyle = normalizeStyle(style);
    const messagePool = DEFAULT_MESSAGES[normalizedStyle]?.[type] || DEFAULT_MESSAGES.fun[type];
    const gifPool = DEFAULT_GIFS[type] || [];
    const history = await db.getMessageHistory(slackId, type);
    const messageIndex = chooseSmartIndex(messagePool.length, history?.lastMessageIndex ?? null);
    const gifIndex = chooseSmartIndex(gifPool.length, history?.lastGifIndex ?? null);

    return {
      messageIndex,
      gifIndex,
      messageTemplate: messagePool[messageIndex] || "",
      introText: "",
      gifUrl: gifIndex !== null ? gifPool[gifIndex] : "",
      isDbTemplate: false,
    };
  }

  async function callWithRetry(label, fn, retries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        logger.error(`${label} failed on attempt ${attempt}`, error?.data || error);
        if (attempt < retries) {
          await sleep(300 * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError;
  }

  function fillMessageTemplate(template, event, now) {
    const years = getAnniversaryYears(event, now);
    return renderTemplate(template, {
      slackId: event.userId,
      years,
    }).replace(/\{TONE\}/g, getAnniversaryTone(years));
  }

  async function resolveEventOverride(event, now) {
    const eventId = buildEventId({
      slackId: event.userId,
      type: event.type,
      date: now.toISODate(),
    });

    const [override, legacy] = await Promise.all([
      db.getEventOverride(eventId),
      db.getCustomMessage(event.userId, now.toISODate(), event.type),
    ]);

    return {
      customMessage: override?.customMessage || legacy?.message || "",
      gifUrl: override?.gifUrl || legacy?.gifUrl || "",
    };
  }

  async function buildDisplays(events) {
    const displayPairs = await Promise.all(
      events.map(async (event) => [event.userId, await slack.getUserDisplay(app.client, event.userId)]),
    );
    return new Map(displayPairs);
  }

  function buildBatchCheer(type, events, messageTemplate, now) {
    if (!messageTemplate) {
      if (events.length === 1) {
        return type === "birthday"
          ? `Let's give <@${events[0].userId}> a big cheer for being awesome! 🎊`
          : `Let's give <@${events[0].userId}> a big cheer for ${getAnniversaryTone(
              getAnniversaryYears(events[0], now),
            )}! 🎊`;
      }

      return `Let's give ${events.map((event) => `<@${event.userId}>`).join(", ")} a big cheer for being awesome! 🎊`;
    }

    return fillMessageTemplate(messageTemplate, events[0], now);
  }

  async function buildMessagePayload({ type, events, settings, selectedCopy, overrideMap = new Map(), now }) {
    const displaysByUser = await buildDisplays(events);
    const primaryOverride = overrideMap.get(events[0].userId);
    const cheerText =
      events.length === 1 && primaryOverride?.customMessage
        ? primaryOverride.customMessage
        : buildBatchCheer(type, events, selectedCopy.messageTemplate, now);
    const gifUrl =
      events.length === 1 && primaryOverride?.gifUrl
        ? primaryOverride.gifUrl
        : settings.includeGif
          ? selectedCopy.gifUrl
          : "";

    const introText = selectedCopy.introText || "Your daily dose of celebration is here, let's do it 🥳";

    const blocks = buildCelebrationBlocks({
      type,
      events,
      displaysByUser,
      gifUrl,
      cheerText,
      now,
      introText,
      includeChannelPing: true,
    });

    return {
      text: buildCelebrationTextFallback({
        type,
        events,
        now,
        introText,
      }),
      blocks,
    };
  }

  async function resolveSchedulableUser(userId) {
    try {
      const user = await slack.getUserInfo(app.client, userId);
      if (!user || user.deleted || user.is_bot) {
        return { shouldSend: false };
      }
      return { shouldSend: true };
    } catch (error) {
      logger.error(`Failed to resolve Slack user ${userId}`, error);
      return { shouldSend: false };
    }
  }

  async function fetchAllSlackUsers() {
    const users = [];
    let cursor;

    do {
      const response = await callWithRetry("Slack users.list", async () =>
        app.client.users.list({
          limit: 200,
          cursor,
        }),
      );

      users.push(...(response.members || []));
      cursor = response.response_metadata?.next_cursor || "";
    } while (cursor);

    return users;
  }

  async function maybeSyncSlackUsers(now) {
    if (syncState.lastUserSyncAt && now.diff(syncState.lastUserSyncAt, "hours").hours < 1) {
      return;
    }

    try {
      const users = await fetchAllSlackUsers();
      await db.syncSlackUsers(users);
      syncState.lastUserSyncAt = now;
      logger.info(`Slack user sync completed for ${users.length} users.`);
    } catch (error) {
      logger.error("Slack user sync failed", error);
    }
  }

  async function sendChannelMessage(channelId, payload, logLabel) {
    if (!payload?.text?.trim()) {
      logger.info(`Skipped ${logLabel}: empty message`);
      return false;
    }

    const now = DateTime.now();

    try {
      await callWithRetry(logLabel, async () =>
        app.client.chat.postMessage({
          channel: channelId,
          text: payload.text,
          blocks: payload.blocks,
        }),
      );
      recordSuccess();
      await sleep(300);
      return true;
    } catch (error) {
      if (payload.blocks?.some((block) => block.type === "image")) {
        try {
          await callWithRetry(`${logLabel} (without gif)`, async () =>
            app.client.chat.postMessage({
              channel: channelId,
              text: payload.text,
              blocks: payload.blocks.filter((block) => block.type !== "image"),
            }),
          );
          recordSuccess();
          await sleep(300);
          return true;
        } catch (fallbackError) {
          recordFailure(now);
          logger.error(`Slack send failed permanently: ${logLabel}`, fallbackError?.data || fallbackError);
          return false;
        }
      }

      recordFailure(now);
      logger.error(`Slack send failed permanently: ${logLabel}`, error?.data || error);
      return false;
    }
  }

  async function recordSentBatch(events, channelId, now) {
    for (const event of events) {
      await db.recordSentEvent({
        slackId: event.userId,
        type: event.type,
        date: now.toISODate(),
        channelId,
      });
    }
  }

  async function sendCustomOrSingleEvents({ events, settings, now }) {
    for (const event of events) {
      const alreadySent = await db.hasSentEvent({
        slackId: event.userId,
        type: event.type,
        date: now.toISODate(),
        channelId: settings.channelId,
      });

      if (alreadySent) {
        continue;
      }

      const override = await resolveEventOverride(event, now);
      const selectedCopy = await chooseMessageAndGif({
        slackId: event.userId,
        type: event.type,
        style: settings.style,
      });
      const payload = await buildMessagePayload({
        type: event.type,
        events: [event],
        settings,
        selectedCopy,
        overrideMap: new Map([[event.userId, override]]),
        now,
      });

      const sent = await sendChannelMessage(
        settings.channelId,
        payload,
        `Slack celebration post (${event.type}:${event.userId}:${settings.channelId})`,
      );

      if (sent) {
        await db.recordSentEvent({
          slackId: event.userId,
          type: event.type,
          date: now.toISODate(),
          channelId: settings.channelId,
        });
        await db.saveMessageHistory({
          slackId: event.userId,
          type: event.type,
          lastMessageIndex: selectedCopy.messageIndex,
          lastGifIndex: selectedCopy.gifIndex,
        });
      }
    }
  }

  async function sendBatchedEvents({ type, events, settings, now }) {
    if (!events.length) {
      return;
    }

    for (const event of events) {
      const alreadySent = await db.hasSentEvent({
        slackId: event.userId,
        type: event.type,
        date: now.toISODate(),
        channelId: settings.channelId,
      });

      if (alreadySent) {
        continue;
      }

      const selectedCopy = await chooseMessageAndGif({
        slackId: event.userId,
        type,
        style: settings.style,
      });

      const payload = await buildMessagePayload({
        type,
        events: [event],
        settings,
        selectedCopy,
        now,
      });

      const sent = await sendChannelMessage(
        settings.channelId,
        payload,
        `Slack celebration post (${type}:${event.userId}:${settings.channelId})`,
      );

      if (sent) {
        await db.recordSentEvent({
          slackId: event.userId,
          type,
          date: now.toISODate(),
          channelId: settings.channelId,
        });
        await db.saveMessageHistory({
          slackId: event.userId,
          type,
          lastMessageIndex: selectedCopy.messageIndex,
          lastGifIndex: selectedCopy.gifIndex,
        });
      }
    }
  }

  async function dispatchReminder(reminder, event, admins) {
    const reminderKey = `reminder:${reminder.daysBefore}:${eventKey(event)}`;
    if (alreadySentReminder(reminderKey)) {
      return;
    }

    const whenText = reminder.daysBefore === 1 ? "is tomorrow" : `is in ${reminder.daysBefore} day(s)`;
    const reminderText = `🔔 Heads up — <@${event.userId}>'s ${event.type} ${whenText} ${
      event.type === "birthday" ? "🎂" : "💼"
    }`;

    const userDmSent = await sendChannelMessage(
      event.userId,
      { text: reminderText },
      `Slack user reminder (${event.type}:${event.userId})`,
    );

    if (reminder.scope === "admins" || reminder.scope === "channel_and_admins") {
      for (const admin of admins) {
        await sendChannelMessage(
          admin.slack_id,
          { text: reminderText },
          `Slack admin reminder (${event.type}:${event.userId}:${admin.slack_id})`,
        );
      }
    }

    if (reminder.scope === "channel" || reminder.scope === "channel_and_admins") {
      try {
        await callWithRetry(`Slack channel reminder (${event.type}:${event.userId}:${event.channelId})`, async () =>
          slack.postReminderMessage(app.client, {
            channelId: event.channelId,
            event,
            daysBefore: reminder.daysBefore,
          }),
        );
        recordSuccess();
        await sleep(300);
      } catch (error) {
        recordFailure(DateTime.now());
        logger.error("Slack error while posting channel reminder", error?.data || error);
      }
    }

    if (userDmSent) {
      markReminderSent(reminderKey);
    }
  }

  function buildChannelEvents({ employee, settings }) {
    const events = [];

    if (settings.includeBirthdays && employee.birthday && !employee.birthdayOptOut) {
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

    return events;
  }

  function prioritizeSameDayEvents(events, now) {
    const todaysEvents = events.filter((event) => event.date.hasSame(now, "day"));
    const birthdayUsers = new Set(
      todaysEvents.filter((event) => event.type === "birthday").map((event) => event.userId),
    );

    return events.filter((event) => {
      if (event.type !== "anniversary" || !event.date.hasSame(now, "day")) {
        return true;
      }
      return !birthdayUsers.has(event.userId);
    });
  }

  async function processCelebrations(settings, context) {
    const now = DateTime.now().setZone(settings.timezone || "UTC");
    if (!canRunNow(settings, now)) {
      return;
    }

    const channelEvents = [];
    const channelReminders = context.reminders.filter(
      (reminder) => reminder.channelId === settings.channelId || !reminder.channelId,
    );

    for (const employee of context.employees) {
      if (!employee.slackId) {
        continue;
      }

      const eligibility = await resolveSchedulableUser(employee.slackId);
      if (!eligibility.shouldSend) {
        continue;
      }

      channelEvents.push(...buildChannelEvents({ employee, settings }));
    }

    for (const event of channelEvents) {
      for (const reminder of channelReminders) {
        const reminderDate = computeReminderDate(event, reminder.daysBefore);
        if (reminderDate?.hasSame(now, "day")) {
          await dispatchReminder(reminder, event, context.admins);
        }
      }
    }

    const todaysBirthdays = channelEvents.filter(
      (event) => event.type === "birthday" && event.date.hasSame(now, "day"),
    );
    const todaysAnniversaries = channelEvents.filter(
      (event) => event.type === "anniversary" && event.date.hasSame(now, "day"),
    );

    if (!todaysBirthdays.length && !todaysAnniversaries.length) {
      return;
    }

    const birthdayCustom = [];
    const birthdayBatch = [];
    for (const event of todaysBirthdays) {
      const override = await resolveEventOverride(event, now);
      if (override.customMessage || override.gifUrl) {
        birthdayCustom.push(event);
      } else {
        birthdayBatch.push(event);
      }
    }

    const anniversaryCustom = [];
    const anniversaryBatch = [];
    for (const event of todaysAnniversaries) {
      const override = await resolveEventOverride(event, now);
      if (override.customMessage || override.gifUrl) {
        anniversaryCustom.push(event);
      } else {
        anniversaryBatch.push(event);
      }
    }

    await sendCustomOrSingleEvents({ events: birthdayCustom, settings, now });
    await sendBatchedEvents({ type: "birthday", events: birthdayBatch, settings, now });
    await sendCustomOrSingleEvents({ events: anniversaryCustom, settings, now });
    await sendBatchedEvents({ type: "anniversary", events: anniversaryBatch, settings, now });
  }

  async function runOnce() {
    const now = DateTime.now().setZone("UTC");
    if (isRunning) {
      logger.warn("Scheduler run skipped because a previous run is still in progress.");
      return;
    }

    if (circuitBreaker.pausedUntil && now < circuitBreaker.pausedUntil) {
      logger.warn(`Scheduler paused by circuit breaker until ${circuitBreaker.pausedUntil.toISO()}`);
      return;
    }

    isRunning = true;

    try {
      await maybeSyncSlackUsers(now);

      const [settingsList, employees, reminders, admins] = await Promise.all([
        db.listChannelSettings(),
        db.listEmployees(),
        db.listReminders(),
        db.listAdmins(),
      ]);

      for (const settings of settingsList) {
        await processCelebrations(settings, {
          employees,
          reminders,
          admins,
        });
      }
    } catch (error) {
      recordFailure(now);
      logger.error("Scheduler run failed", error);
    } finally {
      isRunning = false;
    }
  }

  function start() {
    cron.schedule("* * * * *", runOnce, { timezone: "UTC" });
    logger.info("Celebration scheduler started.");
  }

  return {
    start,
    runOnce,
  };
}

module.exports = {
  createScheduler,
};
