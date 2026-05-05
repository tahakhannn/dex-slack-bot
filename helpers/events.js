const { DateTime } = require("luxon");

const SETTINGS_DEFAULTS = {
  whoToCelebrate: "everyone",
  includeAnniversaries: true,
  language: "en",
  autoCollect: false,
  postTime: "09:00",
  timezone: "UTC",
  frequency: "daily",
  weekendPolicy: "next_business_day",
  includeGif: true,
  mentionChannel: false,
  mentionSettings: "celebrants_only",
  style: "fun",
};

const TIMEZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  { label: "EST — America/New_York", value: "America/New_York" },
  { label: "CST — America/Chicago", value: "America/Chicago" },
  { label: "MST — America/Denver", value: "America/Denver" },
  { label: "PST — America/Los_Angeles", value: "America/Los_Angeles" },
  { label: "AKST — America/Anchorage", value: "America/Anchorage" },
  { label: "HST — Pacific/Honolulu", value: "Pacific/Honolulu" },
  { label: "AST — America/Puerto_Rico", value: "America/Puerto_Rico" },
  { label: "PKT — Asia/Karachi", value: "Asia/Karachi" },
  { label: "IST — Asia/Kolkata", value: "Asia/Kolkata" },
  { label: "GMT — Europe/London", value: "Europe/London" },
  { label: "CET — Europe/Berlin", value: "Europe/Berlin" },
  { label: "EET — Europe/Bucharest", value: "Europe/Bucharest" },
  { label: "JST — Asia/Tokyo", value: "Asia/Tokyo" },
  { label: "AEST — Australia/Sydney", value: "Australia/Sydney" },
  { label: "GST — Asia/Dubai", value: "Asia/Dubai" },
  { label: "SGT — Asia/Singapore", value: "Asia/Singapore" },
  { label: "BRT — America/Sao_Paulo", value: "America/Sao_Paulo" },
];

const REMINDER_SCOPE_DEFAULT = "channel";

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((label, index) => ({
  text: { type: "plain_text", text: label },
  value: String(index + 1),
}));

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({
  text: { type: "plain_text", text: String(index + 1) },
  value: String(index + 1),
}));

function getStateValue(viewState, blockId, actionId) {
  return viewState?.[blockId]?.[actionId];
}

function selectedValue(actionValue) {
  return (
    actionValue?.selected_option?.value ||
    actionValue?.selected_conversation ||
    actionValue?.selected_user ||
    actionValue?.value ||
    null
  );
}

function selectedValues(actionValue) {
  if (actionValue?.selected_options) {
    return actionValue.selected_options.map((option) => option.value);
  }

  return [];
}

function parseIntOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateInput(viewState, keyPrefix) {
  return {
    day: parseIntOrNull(selectedValue(getStateValue(viewState, `${keyPrefix}_day`, "value"))),
    month: parseIntOrNull(selectedValue(getStateValue(viewState, `${keyPrefix}_month`, "value"))),
    year: parseIntOrNull(selectedValue(getStateValue(viewState, `${keyPrefix}_year`, "value"))),
  };
}

function hasDateParts(dateParts) {
  return Boolean(dateParts?.day && dateParts?.month);
}

function normalizeOptionalDate(dateParts) {
  if (!hasDateParts(dateParts)) {
    return null;
  }

  return {
    day: Number(dateParts.day),
    month: Number(dateParts.month),
    year: dateParts.year ? Number(dateParts.year) : null,
  };
}

function buildDateInputBlocks({ prefix, label, initialDate = null, optional = true }) {
  const normalized = normalizeOptionalDate(initialDate);

  return [
    {
      type: "input",
      block_id: `${prefix}_day`,
      label: { type: "plain_text", text: `${label} day` },
      element: {
        type: "static_select",
        action_id: "value",
        placeholder: { type: "plain_text", text: "Select day" },
        options: DAY_OPTIONS,
        ...(normalized?.day
          ? {
              initial_option: {
                text: { type: "plain_text", text: String(normalized.day) },
                value: String(normalized.day),
              },
            }
          : {}),
      },
    },
    {
      type: "input",
      block_id: `${prefix}_month`,
      label: { type: "plain_text", text: `${label} month` },
      element: {
        type: "static_select",
        action_id: "value",
        placeholder: { type: "plain_text", text: "Select month" },
        options: MONTH_OPTIONS,
        ...(normalized?.month
          ? {
              initial_option: MONTH_OPTIONS.find(
                (option) => Number(option.value) === normalized.month,
              ),
            }
          : {}),
      },
    },
    {
      type: "input",
      block_id: `${prefix}_year`,
      optional,
      label: { type: "plain_text", text: `${label} year (optional)` },
      element: {
        type: "plain_text_input",
        action_id: "value",
        placeholder: { type: "plain_text", text: "e.g. 1994" },
        ...(normalized?.year ? { initial_value: String(normalized.year) } : {}),
      },
    },
  ];
}

function dayOrdinal(day) {
  const r10 = day % 10;
  const r100 = day % 100;
  if (r10 === 1 && r100 !== 11) return `${day}st`;
  if (r10 === 2 && r100 !== 12) return `${day}nd`;
  if (r10 === 3 && r100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function formatDateParts(dateParts) {
  const normalized = normalizeOptionalDate(dateParts);
  if (!normalized) return "Not set";
  const monthName = MONTH_OPTIONS[normalized.month - 1]?.text.text || "Unknown";
  const day = dayOrdinal(normalized.day);
  if (normalized.year) {
    return `${monthName} ${day}, ${normalized.year}`;
  }
  return `${monthName} ${day}`;
}

function buildDateSummary(label, dateParts) {
  const icon = label === "Birthday" ? "🎂" : "💼";
  const formatted = formatDateParts(dateParts);
  if (formatted === "Not set") {
    return `${icon} *${label}:* Not set`;
  }
  return `${icon} *${label}:* ${formatted}`;
}

function parseStoredDate(dateString) {
  if (!dateString || String(dateString).startsWith("1900-01-01")) {
    return null;
  }

  const parsed = DateTime.fromISO(String(dateString), { zone: "UTC" });
  if (!parsed.isValid) {
    return null;
  }

  return {
    day: parsed.day,
    month: parsed.month,
    year: parsed.year !== 2000 ? parsed.year : null,
  };
}

function toStoredDate(dateParts) {
  const normalized = normalizeOptionalDate(dateParts);
  if (!normalized) {
    return null;
  }

  const year = normalized.year || 2000;
  return DateTime.fromObject(
    { year, month: normalized.month, day: normalized.day },
    { zone: "UTC" },
  ).toISODate();
}

function getNextOccurrence(dateParts, timezone, now = DateTime.now().setZone(timezone || "UTC")) {
  const normalized = normalizeOptionalDate(dateParts);
  if (!normalized) {
    return null;
  }

  let eventDate = DateTime.fromObject(
    { year: now.year, month: normalized.month, day: normalized.day },
    { zone: timezone || "UTC" },
  ).startOf("day");

  if (!eventDate.isValid) {
    return null;
  }

  if (eventDate < now.startOf("day")) {
    eventDate = eventDate.plus({ years: 1 });
  }

  return eventDate;
}

function applyWeekendPolicy(dateTime, weekendPolicy) {
  if (!dateTime) {
    return null;
  }

  if (dateTime.weekday < 6) {
    return dateTime;
  }

  switch (weekendPolicy) {
    case "previous_business_day":
      return dateTime.weekday === 6 ? dateTime.minus({ days: 1 }) : dateTime.minus({ days: 2 });
    case "skip_weekend":
      return null;
    case "same_day":
      return dateTime;
    case "next_business_day":
    default:
      return dateTime.weekday === 6 ? dateTime.plus({ days: 2 }) : dateTime.plus({ days: 1 });
  }
}

function eventKey(event) {
  return [event.type, event.channelId || "home", event.userId, event.date.toISODate()].join(":");
}

function buildEventRecord({ type, userId, dateParts, timezone, settings, employee }) {
  const nextOccurrence = getNextOccurrence(dateParts, timezone);
  if (!nextOccurrence) {
    return null;
  }

  const adjustedDate = applyWeekendPolicy(nextOccurrence, settings.weekendPolicy);
  if (!adjustedDate) {
    return null;
  }

  return {
    type,
    userId,
    channelId: settings.channelId,
    date: adjustedDate,
    originalDate: nextOccurrence,
    dateParts: normalizeOptionalDate(dateParts),
    settings,
    employee,
  };
}

function sortEvents(events) {
  return [...events].sort((left, right) => left.date.toMillis() - right.date.toMillis());
}

function paginateItems(items, page = 1, pageSize = 5) {
  const safePage = Math.max(page, 1);
  return {
    items: items.slice(0, safePage * pageSize),
    hasMore: items.length > safePage * pageSize,
    page: safePage,
  };
}

function formatCountdown(date, timezone) {
  const now = DateTime.now().setZone(timezone || "UTC").startOf("day");
  const days = Math.round(date.startOf("day").diff(now, "days").days);

  if (days <= 0) {
    return "today";
  }

  if (days === 1) {
    return "in 1 day";
  }

  return `in ${days} days`;
}

function formatEventLabel(event) {
  const icon = event.type === "birthday" ? "🎂" : "💼";
  return `${icon} ${event.type === "birthday" ? "Birthday" : "Anniversary"} ${event.date.toFormat("MMM d")}`;
}

function computeReminderDate(event, daysBefore) {
  return event.date.minus({ days: Number(daysBefore || 0) }).startOf("day");
}

function parseBooleanSelection(viewState, blockId, actionId, expectedValue = "true") {
  const selected = selectedValue(getStateValue(viewState, blockId, actionId));
  return selected === expectedValue;
}

function parseCheckboxValues(viewState, blockId, actionId) {
  const actionValue = getStateValue(viewState, blockId, actionId);
  return selectedValues(actionValue);
}

function safeTime(value) {
  const normalized = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : SETTINGS_DEFAULTS.postTime;
}

module.exports = {
  SETTINGS_DEFAULTS,
  TIMEZONE_OPTIONS,
  REMINDER_SCOPE_DEFAULT,
  DAY_OPTIONS,
  MONTH_OPTIONS,
  buildDateInputBlocks,
  buildDateSummary,
  dayOrdinal,
  formatDateParts,
  parseDateInput,
  parseStoredDate,
  toStoredDate,
  normalizeOptionalDate,
  hasDateParts,
  getNextOccurrence,
  applyWeekendPolicy,
  buildEventRecord,
  sortEvents,
  paginateItems,
  formatCountdown,
  formatEventLabel,
  computeReminderDate,
  parseBooleanSelection,
  parseCheckboxValues,
  selectedValue,
  selectedValues,
  safeTime,
  eventKey,
};
