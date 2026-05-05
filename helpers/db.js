const supabase = require("../supabase");
const {
  SETTINGS_DEFAULTS,
  REMINDER_SCOPE_DEFAULT,
  normalizeOptionalDate,
  parseStoredDate,
  toStoredDate,
} = require("./events");
const { DateTime } = require("luxon");

const TABLE_COLUMNS = {
  employees: [
    "id",
    "name",
    "slack_id",
    "workspace_id",
    "email",
    "birthday",
    "join_date",
    "is_active",
    "created_at",
    "updated_at",
  ],
  user_profiles: [
    "slack_id",
    "workspace_id",
    "birth_day",
    "birth_month",
    "birth_year",
    "anniv_day",
    "anniv_month",
    "anniv_year",
    "birthday_opt_out",
    "anniversary_opt_out",
    "email",
    "onboarded",
    "last_onboarding_sent",
    "updated_at",
    "created_at",
  ],
  channel_settings: [
    "id",
    "channel_id",
    "workspace_id",
    "channel_name",
    "post_time",
    "timezone",
    "weekend_policy",
    "include_gif",
    "mention_channel",
    "tag_channel",
    "mention_settings",
    "who_to_celebrate",
    "include_anniversaries",
    "include_birthdays",
    "language",
    "auto_collect",
    "frequency",
    "style",
    "created_at",
    "updated_at",
  ],
  reminders: [
    "id",
    "channel_id",
    "workspace_id",
    "days_before",
    "scope",
    "who_to_notify",
    "created_by",
    "created_at",
    "updated_at",
  ],
  admins: ["id", "slack_id", "workspace_id", "channel_id", "created_at"],
  sent_events: [
    "id",
    "slack_id",
    "workspace_id",
    "type",
    "date",
    "channel_id",
    "created_at",
  ],
  message_history: [
    "id",
    "slack_id",
    "workspace_id",
    "type",
    "last_message_index",
    "last_gif_index",
    "updated_at",
    "created_at",
  ],
  custom_messages: [
    "id",
    "slack_id",
    "workspace_id",
    "date",
    "type",
    "message",
    "gif_url",
    "created_at",
    "updated_at",
  ],
  templates: [
    "id",
    "workspace_id",
    "type",
    "message",
    "intro_text",
    "gif_urls",
    "created_at",
    "updated_at",
  ],
  event_overrides: [
    "id",
    "workspace_id",
    "slack_id",
    "type",
    "date",
    "custom_message",
    "gif_url",
    "created_at",
    "updated_at",
  ],
};

function createDbHelpers({ logger = console } = {}) {
  const columnCache = new Map();
  const employeeCacheStore = { data: null, fetchedAt: null, ttlMs: 5 * 60 * 1000 };

  function defaultWorkspaceId() {
    return process.env.SLACK_TEAM_ID || null;
  }

  function invalidateEmployeeCache() {
    employeeCacheStore.data = null;
    employeeCacheStore.fetchedAt = null;
  }

  async function detectColumns(table) {
    if (columnCache.has(table)) {
      return columnCache.get(table);
    }

    const candidates = TABLE_COLUMNS[table] || [];
    const supported = [];

    for (const column of candidates) {
      const { error } = await supabase.from(table).select(column).limit(1);
      if (!error) {
        supported.push(column);
      }
    }

    columnCache.set(table, supported);
    return supported;
  }

  async function supportsColumn(table, column) {
    const columns = await detectColumns(table);
    return columns.includes(column);
  }

  async function filterPayload(table, payload) {
    const columns = await detectColumns(table);
    return Object.fromEntries(
      Object.entries(payload).filter(([key, value]) => columns.includes(key) && value !== undefined),
    );
  }

  async function selectAll(table, queryMutator = null) {
    let query = supabase.from(table).select("*");
    if (queryMutator) {
      query = queryMutator(query);
    }

    const { data, error } = await query;
    if (error) {
      logger.error(`Supabase select failed for ${table}`, error);
      throw error;
    }

    return data || [];
  }

  async function selectSingle(table, column, value) {
    const { data, error } = await supabase.from(table).select("*").eq(column, value).limit(1);
    if (error) {
      logger.error(`Supabase selectSingle failed for ${table}`, error);
      throw error;
    }

    return data?.[0] || null;
  }

  async function insertRow(table, payload) {
    const filtered = await filterPayload(table, payload);
    const { data, error } = await supabase.from(table).insert(filtered).select().single();
    if (error) {
      logger.error(`Supabase insert failed for ${table}`, error);
      throw error;
    }

    return data;
  }

  async function updateRows(table, matchColumn, matchValue, payload) {
    const filtered = await filterPayload(table, payload);
    const { data, error } = await supabase
      .from(table)
      .update(filtered)
      .eq(matchColumn, matchValue)
      .select();

    if (error) {
      logger.error(`Supabase update failed for ${table}`, error);
      throw error;
    }

    return data || [];
  }

  async function upsertBy(table, matchColumn, payload) {
    const existing = await selectSingle(table, matchColumn, payload[matchColumn]);
    if (existing) {
      const updated = await updateRows(table, matchColumn, payload[matchColumn], payload);
      return updated[0] || existing;
    }

    return insertRow(table, payload);
  }

  function normalizeEmployee(employeeRow = {}, profileRow = {}) {
    const birthdayFromEmployee = parseStoredDate(employeeRow.birthday);
    const anniversaryFromEmployee = parseStoredDate(employeeRow.join_date);

    const birthday = normalizeOptionalDate(
      birthdayFromEmployee || {
        day: profileRow.birth_day,
        month: profileRow.birth_month,
        year: profileRow.birth_year,
      },
    );

    const anniversary = normalizeOptionalDate(
      anniversaryFromEmployee || {
        day: profileRow.anniv_day,
        month: profileRow.anniv_month,
        year: profileRow.anniv_year,
      },
    );

    return {
      id: employeeRow.id || null,
      slackId: employeeRow.slack_id || profileRow.slack_id,
      name: employeeRow.name || null,
      email: employeeRow.email || profileRow.email || null,
      birthday,
      anniversary,
      birthdayOptOut: Boolean(profileRow.birthday_opt_out),
      anniversaryOptOut: Boolean(profileRow.anniversary_opt_out),
      onboarded: Boolean(profileRow.onboarded),
      lastOnboardingSent: profileRow.last_onboarding_sent || null,
      isActive: employeeRow.is_active !== false,
    };
  }

  async function listEmployees() {
    if (employeeCacheStore.data && Date.now() - employeeCacheStore.fetchedAt < employeeCacheStore.ttlMs) {
      return employeeCacheStore.data;
    }

    const [employees, profiles] = await Promise.all([
      selectAll("employees", (query) => query.order("name", { ascending: true })),
      selectAll("user_profiles", (query) => query.order("slack_id", { ascending: true })),
    ]);

    const profileMap = new Map(profiles.map((profile) => [profile.slack_id, profile]));
    const rows = [];

    for (const employee of employees) {
      rows.push(normalizeEmployee(employee, profileMap.get(employee.slack_id)));
      profileMap.delete(employee.slack_id);
    }

    for (const profile of profileMap.values()) {
      rows.push(normalizeEmployee({}, profile));
    }

    const result = rows.filter((row) => row.slackId);
    employeeCacheStore.data = result;
    employeeCacheStore.fetchedAt = Date.now();
    return result;
  }

  async function getEmployee(slackId) {
    const [employee, profile] = await Promise.all([
      selectSingle("employees", "slack_id", slackId),
      selectSingle("user_profiles", "slack_id", slackId),
    ]);

    if (!employee && !profile) {
      return null;
    }

    return normalizeEmployee(employee || {}, profile || {});
  }

  async function saveEmployee({
    slackId,
    workspaceId = defaultWorkspaceId(),
    name,
    email,
    birthday,
    anniversary,
    onboarded,
    birthdayOptOut,
    anniversaryOptOut,
    isActive = true,
  }) {
    const normalizedBirthday = normalizeOptionalDate(birthday);
    const normalizedAnniversary = normalizeOptionalDate(anniversary);

    const employeePayload = {
      slack_id: slackId,
      workspace_id: workspaceId,
      name: name || "Employee",
      email,
      birthday: toStoredDate(normalizedBirthday),
      join_date: toStoredDate(normalizedAnniversary),
      is_active: isActive,
    };

    const profilePayload = {
      slack_id: slackId,
      workspace_id: workspaceId,
      birth_day: normalizedBirthday?.day || null,
      birth_month: normalizedBirthday?.month || null,
      birth_year: normalizedBirthday?.year || null,
      anniv_day: normalizedAnniversary?.day || null,
      anniv_month: normalizedAnniversary?.month || null,
      anniv_year: normalizedAnniversary?.year || null,
      birthday_opt_out: birthdayOptOut,
      anniversary_opt_out: anniversaryOptOut,
      email,
      onboarded,
      updated_at: new Date().toISOString(),
    };

    const [employeeRow] = await Promise.all([
      upsertBy("employees", "slack_id", employeePayload),
      upsertBy("user_profiles", "slack_id", profilePayload),
    ]);

    invalidateEmployeeCache();
    return employeeRow;
  }

  async function deleteEmployee(slackId) {
    const [employeeDelete, profileDelete] = await Promise.all([
      supabase.from("employees").delete().eq("slack_id", slackId),
      supabase.from("user_profiles").delete().eq("slack_id", slackId),
    ]);

    if (employeeDelete.error) {
      logger.error("Failed to delete employee row", employeeDelete.error);
      throw employeeDelete.error;
    }

    if (profileDelete.error) {
      logger.error("Failed to delete profile row", profileDelete.error);
      throw profileDelete.error;
    }

    invalidateEmployeeCache();
  }

  async function isAdmin(slackId) {
    const admin = await selectSingle("admins", "slack_id", slackId);
    return Boolean(admin);
  }

  async function listAdmins() {
    return selectAll("admins", (query) => query.order("slack_id", { ascending: true }));
  }

  async function saveAdmin(slackId) {
    return upsertBy("admins", "slack_id", {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
    });
  }

  async function deleteAdmin(slackId) {
    const { error } = await supabase.from("admins").delete().eq("slack_id", slackId);
    if (error) {
      logger.error("Failed to delete admin", error);
      throw error;
    }
  }

  async function replaceAdmins(slackIds) {
    const existingAdmins = await listAdmins();
    const existingIds = new Set(existingAdmins.map((admin) => admin.slack_id));
    const nextIds = new Set((slackIds || []).filter(Boolean));

    await Promise.all(
      [...existingIds]
        .filter((slackId) => !nextIds.has(slackId))
        .map((slackId) => deleteAdmin(slackId)),
    );

    await Promise.all(
      [...nextIds]
        .filter((slackId) => !existingIds.has(slackId))
        .map((slackId) => saveAdmin(slackId)),
    );

    return listAdmins();
  }

  function normalizeChannelSettings(row = {}, fallbackChannelId = null) {
    return {
      id: row.id || null,
      channelId: row.channel_id || fallbackChannelId || process.env.DEFAULT_CHANNEL_ID || null,
      channelName: row.channel_name || null,
      whoToCelebrate: row.who_to_celebrate || SETTINGS_DEFAULTS.whoToCelebrate,
      includeBirthdays:
        row.include_birthdays === null || row.include_birthdays === undefined
          ? true
          : Boolean(row.include_birthdays),
      includeAnniversaries:
        row.include_anniversaries === null || row.include_anniversaries === undefined
          ? SETTINGS_DEFAULTS.includeAnniversaries
          : Boolean(row.include_anniversaries),
      language: row.language || SETTINGS_DEFAULTS.language,
      autoCollect:
        row.auto_collect === null || row.auto_collect === undefined
          ? SETTINGS_DEFAULTS.autoCollect
          : Boolean(row.auto_collect),
      postTime: row.post_time || SETTINGS_DEFAULTS.postTime,
      timezone: row.timezone || SETTINGS_DEFAULTS.timezone,
      frequency: row.frequency || SETTINGS_DEFAULTS.frequency,
      weekendPolicy: row.weekend_policy || SETTINGS_DEFAULTS.weekendPolicy,
      includeGif:
        row.include_gif === null || row.include_gif === undefined
          ? SETTINGS_DEFAULTS.includeGif
          : Boolean(row.include_gif),
      mentionChannel:
        row.mention_channel === null || row.mention_channel === undefined
          ? row.tag_channel === null || row.tag_channel === undefined
            ? SETTINGS_DEFAULTS.mentionChannel
            : Boolean(row.tag_channel)
          : Boolean(row.mention_channel),
      tagChannel:
        row.tag_channel === null || row.tag_channel === undefined
          ? SETTINGS_DEFAULTS.mentionChannel
          : Boolean(row.tag_channel),
      mentionSettings: row.mention_settings || SETTINGS_DEFAULTS.mentionSettings,
      style: row.style || SETTINGS_DEFAULTS.style,
    };
  }

  async function listChannelSettings() {
    const rows = await selectAll("channel_settings", (query) =>
      query.order("channel_id", { ascending: true }),
    );

    if (!rows.length && process.env.DEFAULT_CHANNEL_ID) {
      return [
        normalizeChannelSettings(
          {
            channel_id: process.env.DEFAULT_CHANNEL_ID,
            post_time: SETTINGS_DEFAULTS.postTime,
            timezone: SETTINGS_DEFAULTS.timezone,
          },
          process.env.DEFAULT_CHANNEL_ID,
        ),
      ];
    }

    return rows.map((row) => normalizeChannelSettings(row));
  }

  async function getChannelSettings(channelId) {
    const row = channelId ? await selectSingle("channel_settings", "channel_id", channelId) : null;
    return normalizeChannelSettings(row || {}, channelId);
  }

  async function saveChannelSettings(settings) {
    const payload = {
      channel_id: settings.channelId,
      workspace_id: settings.workspaceId || defaultWorkspaceId(),
      channel_name: settings.channelName || null,
      who_to_celebrate: settings.whoToCelebrate,
      include_birthdays: settings.includeBirthdays,
      include_anniversaries: settings.includeAnniversaries,
      language: settings.language,
      auto_collect: settings.autoCollect,
      post_time: settings.postTime,
      timezone: settings.timezone,
      frequency: settings.frequency,
      weekend_policy: settings.weekendPolicy,
      include_gif: settings.includeGif,
      mention_channel: settings.mentionChannel,
      tag_channel: settings.tagChannel ?? settings.mentionChannel,
      mention_settings: settings.mentionSettings,
      style: settings.style,
      updated_at: new Date().toISOString(),
    };

    return upsertBy("channel_settings", "channel_id", payload);
  }

  function normalizeReminder(row = {}, defaultChannelId = null) {
    return {
      id: row.id || null,
      channelId: row.channel_id || defaultChannelId || process.env.DEFAULT_CHANNEL_ID || null,
      daysBefore: Number(row.days_before),
      scope: row.scope || row.who_to_notify || REMINDER_SCOPE_DEFAULT,
      whoToNotify: row.who_to_notify || row.scope || REMINDER_SCOPE_DEFAULT,
      createdBy: row.created_by || null,
    };
  }

  async function listReminders(defaultChannelId = null) {
    const rows = await selectAll("reminders", (query) =>
      query.order("days_before", { ascending: true }),
    );
    return rows.map((row) => normalizeReminder(row, defaultChannelId));
  }

  async function replaceReminders({ channelId, daysBefore, scope, createdBy }) {
    const hasChannelColumn = await supportsColumn("reminders", "channel_id");

    if (hasChannelColumn && channelId) {
      const removeExisting = await supabase.from("reminders").delete().eq("channel_id", channelId);
      if (removeExisting.error) {
        logger.error("Failed to clear reminders", removeExisting.error);
        throw removeExisting.error;
      }
    } else {
      const removeExisting = await supabase.from("reminders").delete().neq("id", 0);
      if (removeExisting.error) {
        logger.error("Failed to clear global reminders", removeExisting.error);
        throw removeExisting.error;
      }
    }

    const rows = [];
    for (const day of daysBefore) {
      const row = await insertRow("reminders", {
        channel_id: channelId,
        workspace_id: defaultWorkspaceId(),
        days_before: Number(day),
        scope,
        who_to_notify: scope,
        created_by: createdBy,
        updated_at: new Date().toISOString(),
      });
      rows.push(row);
    }

    return rows;
  }

  async function getAnalytics() {
    const [employees, profiles, reminders] = await Promise.all([
      listEmployees(),
      selectAll("user_profiles"),
      listReminders(),
    ]);

    return {
      totalEmployees: employees.length,
      totalBirthdays: profiles.filter((profile) => profile.birth_day && profile.birth_month).length,
      totalAnniversaries: profiles.filter((profile) => profile.anniv_day && profile.anniv_month).length,
      remindersCount: reminders.length,
    };
  }

  async function getAutomationMetrics({
    timezone = SETTINGS_DEFAULTS.timezone,
    workspaceId = defaultWorkspaceId(),
  } = {}) {
    const sentColumns = await detectColumns("sent_events");
    const monthStart = DateTime.now().setZone(timezone).startOf("month").toISODate();
    const monthEnd = DateTime.now().setZone(timezone).endOf("month").toISODate();

    let birthdaysSentThisMonth = 0;
    let anniversariesSentThisMonth = 0;

    if (sentColumns.length) {
      let birthdayQuery = supabase
        .from("sent_events")
        .select("*", { count: "exact", head: true })
        .eq("type", "birthday")
        .gte("date", monthStart)
        .lte("date", monthEnd);

      let anniversaryQuery = supabase
        .from("sent_events")
        .select("*", { count: "exact", head: true })
        .eq("type", "anniversary")
        .gte("date", monthStart)
        .lte("date", monthEnd);

      if (workspaceId && sentColumns.includes("workspace_id")) {
        birthdayQuery = birthdayQuery.eq("workspace_id", workspaceId);
        anniversaryQuery = anniversaryQuery.eq("workspace_id", workspaceId);
      }

      const [birthdayCount, anniversaryCount] = await Promise.all([birthdayQuery, anniversaryQuery]);

      if (birthdayCount.error) {
        logger.error("Failed to count birthday sent events", birthdayCount.error);
      } else {
        birthdaysSentThisMonth = birthdayCount.count || 0;
      }

      if (anniversaryCount.error) {
        logger.error("Failed to count anniversary sent events", anniversaryCount.error);
      } else {
        anniversariesSentThisMonth = anniversaryCount.count || 0;
      }
    }

    const employees = await listEmployees();
    const now = DateTime.now().setZone(timezone);
    const upcomingEventsCount = employees.filter((employee) => {
      const birthdayMatches =
        employee.birthday &&
        employee.birthday.day === now.day &&
        employee.birthday.month === now.month &&
        !employee.birthdayOptOut;

      const anniversaryMatches =
        employee.anniversary &&
        employee.anniversary.day === now.day &&
        employee.anniversary.month === now.month &&
        !employee.anniversaryOptOut;

      return birthdayMatches || anniversaryMatches;
    }).length;

    return {
      birthdaysSentThisMonth,
      anniversariesSentThisMonth,
      remindersTriggeredThisMonth: 0,
      upcomingEventsCount,
    };
  }

  async function syncSlackUsers(users, workspaceId = defaultWorkspaceId()) {
    const existingEmployees = await listEmployees();
    const existingMap = new Map(existingEmployees.map((employee) => [employee.slackId, employee]));
    const seen = new Set();

    for (const user of users || []) {
      if (!user?.id || user.is_bot) {
        continue;
      }

      seen.add(user.id);

      if (user.deleted) {
        if (existingMap.has(user.id)) {
          await deleteEmployee(user.id);
        }
        continue;
      }

      const existing = existingMap.get(user.id);
      await saveEmployee({
        slackId: user.id,
        workspaceId,
        name:
          user.profile?.display_name ||
          user.profile?.real_name ||
          user.real_name ||
          user.name ||
          existing?.name ||
          "Employee",
        email: user.profile?.email || existing?.email || null,
        birthday: existing?.birthday || null,
        anniversary: existing?.anniversary || null,
        birthdayOptOut: existing?.birthdayOptOut || false,
        anniversaryOptOut: existing?.anniversaryOptOut || false,
        onboarded: existing?.onboarded || false,
        isActive: true,
      });
    }

    for (const employee of existingEmployees) {
      if (!seen.has(employee.slackId)) {
        logger.info(`Slack sync leaving ${employee.slackId} unchanged because it was not present in users.list payload`);
      }
    }
  }

  async function ensureSlackUser({
    slackId,
    name = "Employee",
    email = null,
    workspaceId = defaultWorkspaceId(),
  }) {
    if (!slackId) {
      return null;
    }

    const existing = await getEmployee(slackId);
    return saveEmployee({
      slackId,
      workspaceId,
      name: name || existing?.name || "Employee",
      email: email || existing?.email || null,
      birthday: existing?.birthday || null,
      anniversary: existing?.anniversary || null,
      birthdayOptOut: existing?.birthdayOptOut || false,
      anniversaryOptOut: existing?.anniversaryOptOut || false,
      onboarded: existing?.onboarded || false,
      isActive: existing?.isActive !== false,
    });
  }

  async function markOnboardingSent(slackId) {
    return upsertBy("user_profiles", "slack_id", {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
      last_onboarding_sent: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async function markOnboarded(slackId) {
    return upsertBy("user_profiles", "slack_id", {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
      onboarded: true,
      updated_at: new Date().toISOString(),
    });
  }

  async function getUserProfile(slackId) {
    const profile = await selectSingle("user_profiles", "slack_id", slackId);
    const employee = await selectSingle("employees", "slack_id", slackId);
    return normalizeEmployee(employee || {}, profile || {});
  }

  function normalizeCustomMessage(row = {}) {
    return {
      id: row.id || null,
      slackId: row.slack_id || null,
      date: row.date || null,
      type: row.type || null,
      message: row.message || "",
      gifUrl: row.gif_url || "",
    };
  }

  async function listCustomMessages() {
    const columns = await detectColumns("custom_messages");
    if (!columns.length) {
      return [];
    }

    const rows = await selectAll("custom_messages", (query) => query.order("date", { ascending: true }));
    return rows.map((row) => normalizeCustomMessage(row));
  }

  async function getCustomMessage(slackId, date, type = null) {
    const columns = await detectColumns("custom_messages");
    if (!columns.length) {
      return null;
    }

    let query = supabase
      .from("custom_messages")
      .select("*")
      .eq("slack_id", slackId)
      .eq("date", date);

    if (type && columns.includes("type")) {
      query = query.eq("type", type);
    }

    const { data, error } = await query.limit(1);

    if (error) {
      logger.error("Supabase getCustomMessage failed", error);
      throw error;
    }

    return data?.[0] ? normalizeCustomMessage(data[0]) : null;
  }

  async function saveCustomMessage({ slackId, date, type = null, message, gifUrl }) {
    const columns = await detectColumns("custom_messages");
    if (!columns.length) {
      throw new Error("custom_messages table is missing. Apply the required Supabase migration first.");
    }

    const existing = await getCustomMessage(slackId, date, type);
    const payload = {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
      date,
      type,
      message,
      gif_url: gifUrl,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      let query = supabase
        .from("custom_messages")
        .update(await filterPayload("custom_messages", payload))
        .eq("slack_id", slackId)
        .eq("date", date);

      if (type && columns.includes("type")) {
        query = query.eq("type", type);
      }

      const rows = await query.select();

      if (rows.error) {
        logger.error("Supabase saveCustomMessage update failed", rows.error);
        throw rows.error;
      }

      return normalizeCustomMessage(rows.data?.[0] || existing);
    }

    return normalizeCustomMessage(await insertRow("custom_messages", payload));
  }

  async function hasSentEvent({ slackId, type, date, channelId }) {
    const columns = await detectColumns("sent_events");
    if (!columns.length) {
      throw new Error("sent_events table is missing. Apply the required Supabase migration first.");
    }

    const { data, error } = await supabase
      .from("sent_events")
      .select("*")
      .eq("slack_id", slackId)
      .eq("type", type)
      .eq("date", date)
      .eq("channel_id", channelId)
      .limit(1);

    if (error) {
      logger.error("Supabase hasSentEvent failed", error);
      throw error;
    }

    return Boolean(data?.[0]);
  }

  async function recordSentEvent({ slackId, type, date, channelId }) {
    const columns = await detectColumns("sent_events");
    if (!columns.length) {
      throw new Error("sent_events table is missing. Apply the required Supabase migration first.");
    }

    const alreadyExists = await hasSentEvent({ slackId, type, date, channelId });
    if (alreadyExists) {
      return null;
    }

    return insertRow("sent_events", {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
      type,
      date,
      channel_id: channelId,
      created_at: new Date().toISOString(),
    });
  }

  function normalizeMessageHistory(row = {}) {
    return {
      id: row.id || null,
      slackId: row.slack_id || null,
      type: row.type || null,
      lastMessageIndex:
        row.last_message_index === null || row.last_message_index === undefined
          ? null
          : Number(row.last_message_index),
      lastGifIndex:
        row.last_gif_index === null || row.last_gif_index === undefined
          ? null
          : Number(row.last_gif_index),
    };
  }

  async function getMessageHistory(slackId, type) {
    const columns = await detectColumns("message_history");
    if (!columns.length) {
      return null;
    }

    const { data, error } = await supabase
      .from("message_history")
      .select("*")
      .eq("slack_id", slackId)
      .eq("type", type)
      .limit(1);

    if (error) {
      logger.error("Supabase getMessageHistory failed", error);
      throw error;
    }

    return data?.[0] ? normalizeMessageHistory(data[0]) : null;
  }

  async function saveMessageHistory({ slackId, type, lastMessageIndex, lastGifIndex }) {
    const columns = await detectColumns("message_history");
    if (!columns.length) {
      throw new Error("message_history table is missing. Apply the required Supabase migration first.");
    }

    const existing = await getMessageHistory(slackId, type);
    const payload = {
      slack_id: slackId,
      workspace_id: defaultWorkspaceId(),
      type,
      last_message_index: lastMessageIndex,
      last_gif_index: lastGifIndex,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const rows = await supabase
        .from("message_history")
        .update(await filterPayload("message_history", payload))
        .eq("slack_id", slackId)
        .eq("type", type)
        .select();

      if (rows.error) {
        logger.error("Supabase saveMessageHistory update failed", rows.error);
        throw rows.error;
      }

      return normalizeMessageHistory(rows.data?.[0] || existing);
    }

    return normalizeMessageHistory(await insertRow("message_history", payload));
  }

  async function syncUserEmail(slackId, email) {
    if (!email || !slackId) {
      return;
    }

    try {
      // Update user_profiles table
      const hasProfileEmail = await supportsColumn("user_profiles", "email");
      if (hasProfileEmail) {
        await upsertBy("user_profiles", "slack_id", {
          slack_id: slackId,
          workspace_id: defaultWorkspaceId(),
          email,
          updated_at: new Date().toISOString(),
        });
      }

      // Update employees table (only if currently null)
      const hasEmployeeEmail = await supportsColumn("employees", "email");
      if (hasEmployeeEmail) {
        const employee = await selectSingle("employees", "slack_id", slackId);
        if (employee && !employee.email) {
          await updateRows("employees", "slack_id", slackId, {
            email,
            updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      // Unique constraint violation — another user has this email, skip
      if (error?.code === "23505") {
        logger.info(`Email ${email} already exists for another user, skipping sync for ${slackId}`);
        return;
      }
      logger.error(`Failed to sync email for ${slackId}`, error);
    }
  }

  async function backfillEmails(slackClient, slackHelpers) {
    const employees = await listEmployees();
    const missing = employees.filter((e) => !e.email);

    if (!missing.length) {
      return 0;
    }

    logger.info(`Email backfill: found ${missing.length} employee(s) without email`);
    let updated = 0;

    for (const employee of missing) {
      try {
        const email = await slackHelpers.getUserEmail(slackClient, employee.slackId);
        if (email) {
          await syncUserEmail(employee.slackId, email);
          updated += 1;
        } else {
          logger.warn(`Email backfill: no email found for ${employee.slackId}`);
        }
      } catch (error) {
        logger.error(`Email backfill failed for ${employee.slackId}`, error);
      }

      // Rate limit: small delay between API calls
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    invalidateEmployeeCache();
    return updated;
  }

  async function getOptedOutUsers() {
    const profiles = await selectAll("user_profiles");
    return profiles.filter(
      (profile) => Boolean(profile.birthday_opt_out) || Boolean(profile.anniversary_opt_out),
    ).map((profile) => ({
      slackId: profile.slack_id,
      birthdayOptOut: Boolean(profile.birthday_opt_out),
      anniversaryOptOut: Boolean(profile.anniversary_opt_out),
    }));
  }

  async function listTemplates() {
    const columns = await detectColumns("templates");
    if (!columns.length) {
      return [];
    }

    return selectAll("templates", (query) => query.order("type", { ascending: true }));
  }

  async function getTemplate(type) {
    const columns = await detectColumns("templates");
    if (!columns.length) {
      return null;
    }

    const row = await selectSingle("templates", "type", type);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      type: row.type,
      message: row.message || "",
      introText: row.intro_text || "",
      gifUrls: Array.isArray(row.gif_urls) ? row.gif_urls : [],
    };
  }

  async function saveTemplate({ type, message, introText, gifUrls }) {
    const columns = await detectColumns("templates");
    if (!columns.length) {
      throw new Error("templates table is missing. Apply the required Supabase migration first.");
    }

    const payload = {
      type,
      workspace_id: defaultWorkspaceId(),
      message: message || "",
      intro_text: introText || "",
      gif_urls: Array.isArray(gifUrls) ? gifUrls : [],
      updated_at: new Date().toISOString(),
    };

    return upsertBy("templates", "type", payload);
  }

  async function resetEmployeeData() {
    const tables = [
      "event_overrides",
      "custom_messages",
      "message_history",
      "sent_events",
      "user_profiles",
      "employees",
    ];

    for (const table of tables) {
      const columns = await detectColumns(table);
      if (!columns.length) {
        continue;
      }

      const { error } = await supabase.from(table).delete().not("id", "is", null);
      if (error && !String(error.message || "").includes("column")) {
        if (table === "user_profiles") {
          const fallback = await supabase.from(table).delete().not("slack_id", "is", null);
          if (!fallback.error) {
            continue;
          }
          logger.error(`Failed to reset ${table}`, fallback.error);
          throw fallback.error;
        }

        logger.error(`Failed to reset ${table}`, error);
        throw error;
      }
    }
  }

  async function clearEmployeeCelebrationData(slackId) {
    const [employeeUpdate, profileUpdate] = await Promise.all([
      supabase
        .from("employees")
        .update({ birthday: null, join_date: null, updated_at: new Date().toISOString() })
        .eq("slack_id", slackId),
      supabase
        .from("user_profiles")
        .update({
          birth_day: null,
          birth_month: null,
          birth_year: null,
          anniv_day: null,
          anniv_month: null,
          anniv_year: null,
          birthday_opt_out: false,
          anniversary_opt_out: false,
          updated_at: new Date().toISOString(),
        })
        .eq("slack_id", slackId),
    ]);

    if (employeeUpdate.error) {
      logger.error("Failed to clear employee celebration data", employeeUpdate.error);
      throw employeeUpdate.error;
    }

    if (profileUpdate.error) {
      logger.error("Failed to clear profile celebration data", profileUpdate.error);
      throw profileUpdate.error;
    }

    invalidateEmployeeCache();
  }

  async function listEmployeesMissingCelebrationData() {
    const employees = await listEmployees();
    return employees.filter(
      (employee) =>
        !employee.birthday?.day ||
        !employee.birthday?.month ||
        !employee.anniversary?.day ||
        !employee.anniversary?.month,
    );
  }

  async function listSentEventsForRange({
    startDate,
    endDate,
    channelId = null,
    workspaceId = defaultWorkspaceId(),
  }) {
    const columns = await detectColumns("sent_events");
    if (!columns.length) {
      return [];
    }

    let query = supabase
      .from("sent_events")
      .select("*")
      .gte("date", startDate)
      .lte("date", endDate);

    if (channelId && columns.includes("channel_id")) {
      query = query.eq("channel_id", channelId);
    }

    if (workspaceId && columns.includes("workspace_id")) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;
    if (error) {
      logger.error("Failed to list sent events for range", error);
      throw error;
    }

    return data || [];
  }

  function normalizeEventOverride(row = {}) {
    return {
      id: row.id || null,
      slackId: row.slack_id || null,
      type: row.type || null,
      date: row.date || null,
      customMessage: row.custom_message || "",
      gifUrl: row.gif_url || "",
    };
  }

  async function getEventOverride(id) {
    const columns = await detectColumns("event_overrides");
    if (!columns.length || !id) {
      return null;
    }

    const row = await selectSingle("event_overrides", "id", id);
    return row ? normalizeEventOverride(row) : null;
  }

  async function listEventOverrides({ startDate = null, endDate = null } = {}) {
    const columns = await detectColumns("event_overrides");
    if (!columns.length) {
      return [];
    }

    let query = supabase.from("event_overrides").select("*").order("date", { ascending: true });
    if (startDate) {
      query = query.gte("date", startDate);
    }
    if (endDate) {
      query = query.lte("date", endDate);
    }

    const { data, error } = await query;
    if (error) {
      logger.error("Failed to list event overrides", error);
      throw error;
    }

    return (data || []).map((row) => normalizeEventOverride(row));
  }

  async function saveEventOverride({ id, slackId, type, date, customMessage, gifUrl }) {
    const columns = await detectColumns("event_overrides");
    if (!columns.length) {
      throw new Error("event_overrides table is missing. Apply the required Supabase migration first.");
    }

    const payload = {
      id,
      workspace_id: defaultWorkspaceId(),
      slack_id: slackId,
      type,
      date,
      custom_message: customMessage || "",
      gif_url: gifUrl || "",
      updated_at: new Date().toISOString(),
    };

    return normalizeEventOverride(await upsertBy("event_overrides", "id", payload));
  }

  async function deleteEventOverride(id) {
    if (!id) {
      return;
    }

    const columns = await detectColumns("event_overrides");
    if (!columns.length) {
      return;
    }

    const { error } = await supabase.from("event_overrides").delete().eq("id", id);
    if (error) {
      logger.error("Failed to delete event override", error);
      throw error;
    }
  }

  return {
    detectColumns,
    supportsColumn,
    listEmployees,
    getEmployee,
    saveEmployee,
    deleteEmployee,
    clearEmployeeCelebrationData,
    invalidateEmployeeCache,
    isAdmin,
    listAdmins,
    saveAdmin,
    deleteAdmin,
    replaceAdmins,
    listChannelSettings,
    getChannelSettings,
    saveChannelSettings,
    listReminders,
    replaceReminders,
    getAnalytics,
    getAutomationMetrics,
    syncSlackUsers,
    ensureSlackUser,
    syncUserEmail,
    backfillEmails,
    getOptedOutUsers,
    listEmployeesMissingCelebrationData,
    markOnboardingSent,
    markOnboarded,
    getUserProfile,
    hasSentEvent,
    recordSentEvent,
    getMessageHistory,
    saveMessageHistory,
    listCustomMessages,
    getCustomMessage,
    saveCustomMessage,
    listTemplates,
    getTemplate,
    saveTemplate,
    resetEmployeeData,
    listSentEventsForRange,
    getEventOverride,
    listEventOverrides,
    saveEventOverride,
    deleteEventOverride,
  };
}

module.exports = {
  createDbHelpers,
};
