const Papa = require("papaparse");
const XLSX = require("xlsx");
const { DateTime } = require("luxon");

function createDataManagerModule({ db, slack, home, logger = console }) {
  const COLUMN_MAP = {
    slack_id: ["slack_id", "user_id", "slack user id", "id", "slackid", "userid"],
    email: ["email", "email_address", "mail"],
    name: ["name", "full_name", "employee_name", "fullname", "employee"],
    birth_day: ["birth_day", "birthday_day", "bday"],
    birth_month: ["birth_month", "birthday_month", "bmonth"],
    birthday: ["birthday", "birth_date", "date_of_birth", "dob", "birthdate"],
    anniv_day: ["anniv_day", "anniversary_day", "aday"],
    anniv_month: ["anniv_month", "anniversary_month", "amonth"],
    anniv_year: ["anniv_year", "anniversary_year", "ayear"],
    anniversary: ["anniversary", "anniversary_date", "join_date", "start_date", "hire_date"],
  };

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, "_");
  }

  function findColumnIndex(headers, targetKey) {
    const options = COLUMN_MAP[targetKey] || [targetKey];
    for (let index = 0; index < headers.length; index += 1) {
      const normalized = normalizeHeader(headers[index]);
      if (options.some((option) => normalizeHeader(option) === normalized)) {
        return index;
      }
    }
    return -1;
  }

  function parseFlexibleDate(rawValue) {
    if (!rawValue && rawValue !== 0) {
      return null;
    }

    const value = String(rawValue).trim();
    if (!value) {
      return null;
    }

    const iso = DateTime.fromISO(value);
    if (iso.isValid) {
      return { day: iso.day, month: iso.month, year: iso.year };
    }

    const slash = DateTime.fromFormat(value, "d/M/yyyy");
    if (slash.isValid) {
      return { day: slash.day, month: slash.month, year: slash.year };
    }

    const shortSlash = DateTime.fromFormat(value, "d/M");
    if (shortSlash.isValid) {
      return { day: shortSlash.day, month: shortSlash.month, year: null };
    }

    const dash = DateTime.fromFormat(value, "d-M-yyyy");
    if (dash.isValid) {
      return { day: dash.day, month: dash.month, year: dash.year };
    }

    const shortDash = DateTime.fromFormat(value, "d-M");
    if (shortDash.isValid) {
      return { day: shortDash.day, month: shortDash.month, year: null };
    }

    return null;
  }

  function isValidDateParts(parts) {
    if (!parts) {
      return false;
    }
    if (parts.day < 1 || parts.day > 31) {
      return false;
    }
    if (parts.month < 1 || parts.month > 12) {
      return false;
    }
    if (parts.year !== null && parts.year !== undefined && parts.year < 1900) {
      return false;
    }
    return true;
  }

  function parseCsvText(text) {
    const result = Papa.parse(text, {
      skipEmptyLines: true,
    });

    if (result.errors?.length) {
      throw new Error(result.errors[0].message || "Invalid CSV format");
    }

    const rows = result.data || [];
    if (rows.length < 2) {
      throw new Error("Invalid file format");
    }

    return {
      headers: rows[0].map((value) => String(value || "").trim()),
      rows: rows.slice(1),
    };
  }

  function parseWorkbook(buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: "" });
    if (rows.length < 2) {
      throw new Error("Invalid file format");
    }

    return {
      headers: rows[0].map((value) => String(value || "").trim()),
      rows: rows.slice(1),
    };
  }

  async function readSlackFileContent(client, fileId) {
    const info = await client.files.info({ file: fileId });
    const file = info.file;
    if (!file) {
      throw new Error("Uploaded file could not be read.");
    }

    const url = file.url_private_download || file.url_private;
    if (!url) {
      throw new Error("Slack file download URL missing.");
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Slack file download failed (${response.status})`);
    }

    const filename = file.name || "upload";
    if (filename.toLowerCase().endsWith(".xlsx")) {
      return { filename, parsed: parseWorkbook(Buffer.from(await response.arrayBuffer())) };
    }

    return { filename, parsed: parseCsvText(await response.text()) };
  }

  function extractSelectedFileIds(viewState) {
    const actionValue = viewState.upload_file?.csv_file || {};
    return (
      actionValue.selected_files ||
      actionValue.files ||
      actionValue.value ||
      []
    );
  }

  async function parseImportPayload(client, viewState) {
    const fileIds = extractSelectedFileIds(viewState);
    const pastedCsv = viewState.csv_content?.value?.value || "";
    const fileUrl = (viewState.file_url?.value?.value || "").trim();

    if (fileIds.length) {
      const uploaded = await readSlackFileContent(client, fileIds[0]);
      return uploaded.parsed;
    }

    if (pastedCsv.trim()) {
      return parseCsvText(pastedCsv);
    }

    if (fileUrl) {
      const response = await fetch(fileUrl, {
        headers: fileUrl.includes("slack.com")
          ? {
              Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            }
          : {},
      });

      if (!response.ok) {
        throw new Error("Unable to download the provided file URL.");
      }

      if (fileUrl.toLowerCase().endsWith(".xlsx")) {
        return parseWorkbook(Buffer.from(await response.arrayBuffer()));
      }

      return parseCsvText(await response.text());
    }

    throw new Error("Upload a file, paste CSV, or provide a file URL.");
  }

  async function processImportData(headers, rows) {
    const slackIdIndex = findColumnIndex(headers, "slack_id");
    const emailIndex = findColumnIndex(headers, "email");
    const nameIndex = findColumnIndex(headers, "name");
    const birthdayIndex = findColumnIndex(headers, "birthday");
    const birthDayIndex = findColumnIndex(headers, "birth_day");
    const birthMonthIndex = findColumnIndex(headers, "birth_month");
    const anniversaryIndex = findColumnIndex(headers, "anniversary");
    const annivDayIndex = findColumnIndex(headers, "anniv_day");
    const annivMonthIndex = findColumnIndex(headers, "anniv_month");
    const annivYearIndex = findColumnIndex(headers, "anniv_year");

    if (slackIdIndex === -1 && emailIndex === -1) {
      throw new Error("Required column missing: Must provide either slack_id or email.");
    }

    const existingEmployees = await db.listEmployees();
    const emailToSlackId = new Map();
    for (const emp of existingEmployees) {
      if (emp.email) {
        emailToSlackId.set(emp.email.toLowerCase(), emp.slackId);
      }
    }

    const deduped = new Map();
    let skipped = 0;

    for (const row of rows) {
      let slackId = slackIdIndex !== -1 ? String(row[slackIdIndex] || "")
        .trim()
        .replace(/^<@/, "")
        .replace(/>$/, "") : "";

      const email = emailIndex !== -1 ? String(row[emailIndex] || "").trim() : "";

      if (!slackId && email) {
        slackId = emailToSlackId.get(email.toLowerCase()) || "";
      }

      if (!slackId) {
        skipped += 1;
        continue;
      }

      deduped.set(slackId, row);
    }

    let imported = 0;
    for (const [slackId, row] of deduped.entries()) {
      try {
        let birthday = null;
        if (birthdayIndex !== -1 && row[birthdayIndex]) {
          birthday = parseFlexibleDate(row[birthdayIndex]);
        } else if (birthDayIndex !== -1 && birthMonthIndex !== -1) {
          const day = Number(row[birthDayIndex]);
          const month = Number(row[birthMonthIndex]);
          if (Number.isFinite(day) && Number.isFinite(month)) {
            birthday = { day, month, year: null };
          }
        }

        let anniversary = null;
        if (anniversaryIndex !== -1 && row[anniversaryIndex]) {
          anniversary = parseFlexibleDate(row[anniversaryIndex]);
        } else if (annivDayIndex !== -1 && annivMonthIndex !== -1) {
          const day = Number(row[annivDayIndex]);
          const month = Number(row[annivMonthIndex]);
          const year =
            annivYearIndex !== -1 && row[annivYearIndex] !== ""
              ? Number(row[annivYearIndex])
              : null;
          if (Number.isFinite(day) && Number.isFinite(month)) {
            anniversary = { day, month, year: Number.isFinite(year) ? year : null };
          }
        }

        if (birthday && !isValidDateParts(birthday)) {
          birthday = null;
        }
        if (anniversary && !isValidDateParts(anniversary)) {
          anniversary = null;
        }

        await db.saveEmployee({
          slackId,
          name: nameIndex !== -1 ? String(row[nameIndex] || "").trim() || "Employee" : "Employee",
          email: emailIndex !== -1 ? String(row[emailIndex] || "").trim() || null : null,
          birthday,
          anniversary,
          isActive: true,
        });

        imported += 1;
        if (imported % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        logger.error(`Import failed for ${slackId}`, error);
        skipped += 1;
      }
    }

    return {
      total: rows.length,
      imported,
      skipped: rows.length - imported,
    };
  }

  function buildDataManagerModal() {
    return {
      type: "modal",
      title: { type: "plain_text", text: "📥 Data Manager" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "📥 Data Manager" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Import, export, or reset employee celebration data for Dex.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Import CSV / XLSX*\nUpload a spreadsheet, paste CSV, or provide a file URL.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "📥 Import data" },
            action_id: "open_data_import_modal",
            style: "primary",
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Export CSV*\nGenerate a full employee export with names, birthdays, anniversaries, and email.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "📤 Export CSV" },
            action_id: "export_csv_data",
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Reset data*\nRemove all employee lifecycle data, overrides, and sent-event history.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "🗑️ Reset data" },
            action_id: "open_reset_data_modal",
            style: "danger",
          },
        },
      ],
    };
  }

  function buildImportModal() {
    return {
      type: "modal",
      callback_id: "data_import_submit",
      title: { type: "plain_text", text: "📥 Import data" },
      submit: { type: "plain_text", text: "Import" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "📥 Import employee data" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Supported columns: `slack_id`, `name`, `email`, `birth_day`, `birth_month`, `anniv_day`, `anniv_month`, `anniv_year`, plus flexible aliases like `birthday`, `anniversary_date`, and `full_name`.",
            },
          ],
        },
        {
          type: "input",
          block_id: "upload_file",
          optional: true,
          label: { type: "plain_text", text: "Upload CSV or XLSX" },
          element: {
            type: "file_input",
            action_id: "csv_file",
            filetypes: ["csv", "xlsx"],
            max_files: 1,
          },
        },
        {
          type: "input",
          block_id: "csv_content",
          optional: true,
          label: { type: "plain_text", text: "Paste CSV content" },
          element: {
            type: "plain_text_input",
            multiline: true,
            action_id: "value",
          },
        },
        {
          type: "input",
          block_id: "file_url",
          optional: true,
          label: { type: "plain_text", text: "Or provide a file URL" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "https://..." },
          },
        },
      ],
    };
  }

  function buildResetModal() {
    return {
      type: "modal",
      callback_id: "reset_data_submit",
      title: { type: "plain_text", text: "Reset data" },
      submit: { type: "plain_text", text: "Reset" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🗑️ Reset employee data" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "This removes employee records, user profiles, event overrides, custom messages, and sent-event history. Type `RESET` to continue.",
          },
        },
        {
          type: "input",
          block_id: "confirm_reset",
          label: { type: "plain_text", text: "Confirmation" },
          element: {
            type: "plain_text_input",
            action_id: "value",
          },
        },
      ],
    };
  }

  async function deliverImportSummary(client, userId, summary) {
    const dmChannelId = await slack.openDirectMessage(client, userId);
    await client.chat.postMessage({
      channel: dmChannelId,
      text: "Import complete",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "✅ Import Complete" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `*Total rows:* ${summary.total}`,
              `*Imported:* ${summary.imported}`,
              `*Skipped:* ${summary.skipped}`,
            ].join("\n"),
          },
        },
      ],
    });
  }

  async function deliverExport(client, userId) {
    const employees = await db.listEmployees();
    const rows = [
      "slack_id,name,email,birth_day,birth_month,anniv_day,anniv_month,anniv_year",
      ...employees.map((employee) =>
        [
          employee.slackId || "",
          `"${(employee.name || "").replace(/"/g, '""')}"`,
          employee.email || "",
          employee.birthday?.day || "",
          employee.birthday?.month || "",
          employee.anniversary?.day || "",
          employee.anniversary?.month || "",
          employee.anniversary?.year || "",
        ].join(","),
      ),
    ];

    const csvText = rows.join("\n");
    const dmChannelId = await slack.openDirectMessage(client, userId);

    try {
      await client.files.uploadV2({
        channel_id: dmChannelId,
        filename: `dex-export-${DateTime.now().toFormat("yyyy-LL-dd")}.csv`,
        title: "Dex employee export",
        content: csvText,
      });
      return;
    } catch (error) {
      logger.error("files.uploadV2 failed, falling back to message export", error?.data || error);
    }

    await client.chat.postMessage({
      channel: dmChannelId,
      text: "CSV export",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "📤 CSV Export" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${csvText}\`\`\``,
          },
        },
      ],
    });
  }

  function register(app) {
    app.action("open_data_manager_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildDataManagerModal(),
        });
      } catch (error) {
        logger.error("Failed to open data manager modal", error);
      }
    });

    app.action("open_data_import_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildImportModal(),
        });
      } catch (error) {
        logger.error("Failed to open import modal", error);
      }
    });

    app.action("open_reset_data_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildResetModal(),
        });
      } catch (error) {
        logger.error("Failed to open reset data modal", error);
      }
    });

    app.view("data_import_submit", async ({ ack, view, body, client }) => {
      const hasFile = extractSelectedFileIds(view.state.values).length > 0;
      const hasCsv = Boolean((view.state.values.csv_content?.value?.value || "").trim());
      const hasUrl = Boolean((view.state.values.file_url?.value?.value || "").trim());

      if (!hasFile && !hasCsv && !hasUrl) {
        await ack({
          response_action: "errors",
          errors: {
            upload_file: "Upload a file, paste CSV, or provide a file URL.",
          },
        });
        return;
      }

      await ack({ response_action: "clear" });

      try {
        const parsed = await parseImportPayload(client, view.state.values);
        const summary = await processImportData(parsed.headers, parsed.rows);
        await deliverImportSummary(client, body.user.id, summary);
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to import data", error);
        const dmChannelId = await slack.openDirectMessage(client, body.user.id);
        await client.chat.postMessage({
          channel: dmChannelId,
          text: "Import failed",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "❌ Invalid file format",
              },
            },
          ],
        });
      }
    });

    app.action("export_csv_data", async ({ ack, body, client }) => {
      await ack();

      try {
        await deliverExport(client, body.user.id);
      } catch (error) {
        logger.error("Failed to export CSV data", error);
      }
    });

    app.view("reset_data_submit", async ({ ack, view, body, client }) => {
      const confirmation = (view.state.values.confirm_reset.value.value || "").trim();
      if (confirmation !== "RESET") {
        await ack({
          response_action: "errors",
          errors: {
            confirm_reset: "Type RESET to confirm.",
          },
        });
        return;
      }

      await ack({ response_action: "clear" });

      try {
        await db.resetEmployeeData();
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to reset employee data", error);
      }
    });
  }

  return {
    register,
  };
}

module.exports = {
  createDataManagerModule,
};
