const { DateTime } = require("luxon");

const DEFAULT_GIFS = {
  birthday: [
    "https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.gif",
    "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    "https://media.giphy.com/media/3oEhmNLxk9uiTbL9Be/giphy.gif",
    "https://media.giphy.com/media/26FPpSuhgHvYo9Kyk/giphy.gif",
    "https://media.giphy.com/media/Im6d35ebkCIiGzonjI/giphy.gif",
  ],
  anniversary: [
    "https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif",
    "https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif",
    "https://media.giphy.com/media/fPRwBcYd71Lox1v7p2/giphy.gif",
    "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif",
    "https://media.giphy.com/media/3o6fJ1BM7R2EBRDnxK/giphy.gif",
  ],
};

const DEFAULT_INTROS = [
  "Your daily dose of celebration is here, let's do it 🥳",
  "A fresh round of celebrations is here 🥳",
  "Let the team celebrations begin 🥳",
];

const DEFAULT_CHEERS = [
  "Let's give <@USER> a big cheer for being awesome! 🎊",
  "Big applause for <@USER>! 👏",
  "Cheers to <@USER> today! 🥂",
];

function randomPick(list = []) {
  return list[Math.floor(Math.random() * list.length)] || "";
}

function ordinal(value) {
  const remainder10 = value % 10;
  const remainder100 = value % 100;

  if (remainder10 === 1 && remainder100 !== 11) {
    return `${value}st`;
  }
  if (remainder10 === 2 && remainder100 !== 12) {
    return `${value}nd`;
  }
  if (remainder10 === 3 && remainder100 !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}

function getAnniversaryYears(event, now = DateTime.now()) {
  const startYearValue = event?.employee?.anniversary?.year ?? event?.dateParts?.year;
  if (startYearValue === null || startYearValue === undefined) {
    return 1;
  }
  
  const startYear = Number(startYearValue);
  if (!Number.isFinite(startYear)) {
    return 1;
  }

  const years = now.year - startYear;
  return years > 0 ? years : 1;
}

function getAnniversaryTone(years) {
  if (!years) {
    return "work anniversary";
  }
  if (years >= 10) {
    return "legend status 🏆";
  }
  if (years >= 5) {
    return "huge achievement 💼";
  }
  if (years === 1) {
    return "first milestone 🎉";
  }
  return `${ordinal(years)} milestone`;
}

function formatCelebrationDate(dateLike, includeYear = false) {
  const dt = DateTime.isDateTime(dateLike) ? dateLike : DateTime.fromISO(String(dateLike || ""));
  if (!dt.isValid) {
    return "";
  }
  const day = dt.day;
  return includeYear
    ? `${dt.toFormat("MMMM")} ${day}, ${dt.year}`
    : `${dt.toFormat("MMMM")} ${day}`;
}

function buildEventId({ slackId, type, date }) {
  return `${slackId}_${type}_${date}`;
}

function renderTemplate(template, { slackId, years }) {
  return String(template || "")
    .replace(/<@USER>/g, `<@${slackId}>`)
    .replace(/\{ANNIV_YEARS\}/g, years ? String(years) : "")
    .replace(/\{X\}/g, years ? String(years) : "");
}

function getEventHeadline(event, now) {
  if (event.type === "birthday") {
    return "Birthday 🎂";
  }

  const years = getAnniversaryYears(event, now);
  return years ? `Work anniversary # ${years} 💼` : "Work anniversary 💼";
}

function buildEventDetailText(event, now) {
  return [
    `*<@${event.userId}>*`,
    getEventHeadline(event, now),
    `_${formatCelebrationDate(event.date)}_`,
  ].join("\n");
}

function buildSummaryLine(type, count) {
  if (type === "birthday") {
    return `Today, we are celebrating ${count} birthday${count === 1 ? "" : "s"}:`;
  }
  return `Today, we are celebrating ${count} work anniversar${count === 1 ? "y" : "ies"}:`;
}

function buildCheerLine(events = []) {
  if (!events.length) {
    return "Let's celebrate 🎉";
  }
  if (events.length === 1) {
    return randomPick(DEFAULT_CHEERS).replace("<@USER>", `<@${events[0].userId}>`);
  }
  const mentions = events.map((event) => `<@${event.userId}>`).join(", ");
  return `Let's give ${mentions} a big cheer for being awesome! 🎊`;
}

function buildCelebrationBlocks({
  type,
  events,
  displaysByUser = new Map(),
  gifUrl = "",
  introText = randomPick(DEFAULT_INTROS),
  cheerText = "",
  now = DateTime.now(),
  includeChannelPing = true,
}) {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${includeChannelPing ? "<!channel>\n\n" : ""}*${introText}*`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: buildSummaryLine(type, events.length),
        },
      ],
    },
  ];

  for (const event of events) {
    const display = displaysByUser.get(event.userId) || {};
    const block = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: buildEventDetailText(event, now),
      },
    };

    if (display.avatar) {
      block.accessory = {
        type: "image",
        image_url: display.avatar,
        alt_text: display.name || event.userId,
      };
    }

    blocks.push(block);
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: cheerText || buildCheerLine(events),
      },
    },
  );

  if (gifUrl) {
    blocks.push({
      type: "image",
      image_url: gifUrl,
      alt_text: "celebration gif",
    });
  }

  return blocks;
}

function buildCelebrationTextFallback({ type, events, introText = "", now = DateTime.now() }) {
  const lines = [introText || randomPick(DEFAULT_INTROS), "", buildSummaryLine(type, events.length), ""];
  for (const event of events) {
    lines.push(`<@${event.userId}>`);
    lines.push(getEventHeadline(event, now));
    lines.push(formatCelebrationDate(event.date));
    lines.push("");
  }
  lines.push(buildCheerLine(events));
  return lines.join("\n").trim();
}

function buildPreviewText({
  event,
  customMessage = "",
  fallbackMessage = "",
  gifUrl = "",
  channelName = "",
  now = DateTime.now(),
}) {
  const lines = [
    `📅 ${formatCelebrationDate(event.date, true)}`,
    `📢 ${channelName || "Channel not set"}`,
    `👤 <@${event.userId}>`,
    `🏷️ ${event.type === "birthday" ? "Birthday" : "Anniversary"}`,
  ];

  if (fallbackMessage || customMessage) {
    lines.push("");
    lines.push(customMessage || fallbackMessage);
  }

  if (event.type === "anniversary") {
    const years = getAnniversaryYears(event, now);
    if (years) {
      lines.push("");
      lines.push(`Milestone: ${years} years • ${getAnniversaryTone(years)}`);
    }
  }

  if (gifUrl) {
    lines.push("");
    lines.push(`GIF: ${gifUrl}`);
  }

  return lines.join("\n");
}

module.exports = {
  DEFAULT_GIFS,
  DEFAULT_INTROS,
  DEFAULT_CHEERS,
  randomPick,
  ordinal,
  getAnniversaryYears,
  getAnniversaryTone,
  formatCelebrationDate,
  buildEventId,
  renderTemplate,
  buildEventDetailText,
  buildCelebrationBlocks,
  buildCelebrationTextFallback,
  buildPreviewText,
};
