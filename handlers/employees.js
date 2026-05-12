const { DateTime } = require("luxon");
const { buildDateInputBlocks, parseDateInput, parseCheckboxValues, formatDateParts } = require("../helpers/events");

function createEmployeesModule({ db, slack, home, logger = console }) {
  async function openOrPushModal({ client, body, view }) {
    if (body.view?.type === "modal") {
      await client.views.push({
        trigger_id: body.trigger_id,
        view,
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view,
    });
  }

  function summarizeDate(prefix, dateParts) {
    if (!dateParts?.day || !dateParts?.month) {
      return `${prefix} _Not set_`;
    }
    return `${prefix} ${formatDateParts(dateParts)}`;
  }

  function buildEmployeeSelectionModal({ employeesViewId = null } = {}) {
    return {
      type: "modal",
      callback_id: "add_employee_select_submit",
      private_metadata: JSON.stringify({ employeesViewId }),
      title: { type: "plain_text", text: "➕ Add Employee" },
      submit: { type: "plain_text", text: "Next →" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "➕ Add Employee" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Pick a Slack teammate to add to Dex. You'll set their birthday and work anniversary on the next screen.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "input",
          block_id: "employee_user",
          label: { type: "plain_text", text: "👤 Employee" },
          element: {
            type: "users_select",
            action_id: "value",
            placeholder: { type: "plain_text", text: "Search for a teammate…" },
          },
        },
      ],
    };
  }

  function buildEmployeeEditorModal({ userId, employee, callbackId, title, employeesViewId = null }) {
    const isEdit = title === "Edit Employee";
    const initialOptions = [];
    if (employee?.birthdayOptOut) {
      initialOptions.push({
        text: { type: "plain_text", text: "🎂 Opt out of birthday celebrations" },
        value: "birthday",
      });
    }
    if (employee?.anniversaryOptOut) {
      initialOptions.push({
        text: { type: "plain_text", text: "💼 Opt out of anniversary celebrations" },
        value: "anniversary",
      });
    }

    return {
      type: "modal",
      callback_id: callbackId,
      private_metadata: JSON.stringify({ userId, employeesViewId }),
      title: { type: "plain_text", text: isEdit ? "✏️ Edit Employee" : "➕ Add Employee" },
      submit: { type: "plain_text", text: "💾 Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: isEdit ? "✏️ Edit Employee" : "➕ Add Employee" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Set celebration details for <@${userId}>.`,
          },
        },
        { type: "divider" },
        ...buildDateInputBlocks({
          prefix: "birthday",
          label: "🎂 Birthday",
          initialDate: employee?.birthday,
        }),
        ...buildDateInputBlocks({
          prefix: "anniversary",
          label: "💼 Work Anniversary",
          initialDate: employee?.anniversary,
        }),
        { type: "divider" },
        {
          type: "input",
          block_id: "opt_out",
          optional: true,
          label: { type: "plain_text", text: "🚫 Opt-out Preferences" },
          element: {
            type: "checkboxes",
            action_id: "value",
            options: [
              {
                text: { type: "plain_text", text: "🎂 Opt out of birthday celebrations" },
                value: "birthday",
              },
              {
                text: { type: "plain_text", text: "💼 Opt out of anniversary celebrations" },
                value: "anniversary",
              },
            ],
            ...(initialOptions.length ? { initial_options: initialOptions } : {}),
          },
        },
      ],
    };
  }

  async function buildEmployeesModal(filterSlackId = null) {
    const employees = await db.listEmployees();
    const filtered = filterSlackId
      ? employees.filter((e) => e.slackId === filterSlackId)
      : employees;

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "👥 Manage Employees" },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `View, edit, or clear celebration data for your team. *${employees.length}* employee(s) tracked.`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "users_select",
            action_id: "employee_search",
            placeholder: { type: "plain_text", text: "🔍 Search employees…" },
            ...(filterSlackId ? { initial_user: filterSlackId } : {}),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "➕ Add Employee" },
            action_id: "open_add_employee_modal",
            style: "primary",
          },
          ...(filterSlackId
            ? [
                {
                  type: "button",
                  text: { type: "plain_text", text: "✖️ Clear Filter" },
                  action_id: "employee_search_clear",
                },
              ]
            : []),
        ],
      },
      { type: "divider" },
    ];

    if (!filtered.length) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: filterSlackId
              ? "🔍 _No matching employees found for this filter._"
              : "📭 _No employees added yet — use the button above to get started._",
          },
        ],
      });
    } else {
      for (const employee of filtered) {
        const optOuts = [];
        if (employee.birthdayOptOut) optOuts.push("🎂 opted out");
        if (employee.anniversaryOptOut) optOuts.push("💼 opted out");
        const optOutLine = optOuts.length ? `\n🚫 ${optOuts.join(" · ")}` : "";

        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*<@${employee.slackId}>*\n${summarizeDate("🎂", employee.birthday)}  ·  ${summarizeDate(
                "💼",
                employee.anniversary,
              )}${optOutLine}`,
            },
            accessory: {
              type: "overflow",
              action_id: "employee_row_actions",
              options: [
                {
                  text: { type: "plain_text", text: "✏️ Edit" },
                  value: JSON.stringify({ action: "edit", slackId: employee.slackId }),
                },
                {
                  text: { type: "plain_text", text: "🗑️ Clear Data" },
                  value: JSON.stringify({ action: "clear", slackId: employee.slackId }),
                },
              ],
            },
          },
          { type: "divider" },
        );
      }
    }

    return {
      type: "modal",
      callback_id: "employees_modal",
      title: { type: "plain_text", text: "👥 Employees" },
      close: { type: "plain_text", text: "Close" },
      blocks,
    };
  }

  function buildManageAdminsModal(adminIds = []) {
    return {
      type: "modal",
      callback_id: "manage_admins_submit",
      title: { type: "plain_text", text: "🔒 Manage Admins" },
      submit: { type: "plain_text", text: "💾 Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🔒 Manage Admins" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Grant or revoke admin access to Dex. Admins can manage settings, employees, templates, and more.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "input",
          block_id: "admins",
          optional: true,
          label: { type: "plain_text", text: "👥 Admins" },
          element: {
            type: "multi_users_select",
            action_id: "admins_select",
            placeholder: { type: "plain_text", text: "Select admins…" },
            ...(adminIds.length ? { initial_users: adminIds } : {}),
          },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 Slack workspace owners and admins automatically have admin access. Users added here get access even if they aren't workspace admins.",
            },
          ],
        },
      ],
    };
  }

  function buildImportModal() {
    return {
      type: "modal",
      callback_id: "import_dates_submit",
      title: { type: "plain_text", text: "📋 Import Dates" },
      submit: { type: "plain_text", text: "📥 Import" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "📋 Quick Import" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Paste one teammate per line using the format below. Birthday is column 2, anniversary is column 3.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Format:* `<@U123456>, DD-MM-YYYY, DD-MM-YYYY`",
          },
        },
        {
          type: "input",
          block_id: "import_blob",
          label: { type: "plain_text", text: "📝 Rows" },
          element: {
            type: "plain_text_input",
            multiline: true,
            action_id: "value",
            placeholder: { type: "plain_text", text: "<@U123456>, 12-08-1994, 01-03-2020" },
          },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 For bulk imports with more columns (email, name, etc.), use the *📥 Data Manager* instead.",
            },
          ],
        },
      ],
    };
  }

  function parseLooseDate(input) {
    if (!input) {
      return null;
    }

    const cleaned = input.trim();
    const iso = DateTime.fromISO(cleaned);
    if (iso.isValid) {
      return { day: iso.day, month: iso.month, year: iso.year };
    }

    const parts = cleaned.split(/[/-]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    if (parts[0].length === 4) {
      const parsed = {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2]),
      };
      return Number.isFinite(parsed.year) && Number.isFinite(parsed.month) && Number.isFinite(parsed.day)
        ? parsed
        : null;
    }

    const parsed = {
      day: Number(parts[0]),
      month: Number(parts[1]),
      year: parts[2] ? Number(parts[2]) : null,
    };
    return Number.isFinite(parsed.day) && Number.isFinite(parsed.month) ? parsed : null;
  }

  async function saveEmployeeFromView(client, userId, viewState) {
    const employee = await db.getEmployee(userId);
    const display = await slack.getUserDisplay(client, userId);
    const birthday = parseDateInput(viewState, "birthday");
    const anniversary = parseDateInput(viewState, "anniversary");
    const optOuts = parseCheckboxValues(viewState, "opt_out", "value");
    const email = await slack.getUserEmail(client, userId);

    await db.saveEmployee({
      slackId: userId,
      name: display.name || employee?.name || "Employee",
      email: email || employee?.email || null,
      birthday,
      anniversary,
      birthdayOptOut: optOuts.includes("birthday"),
      anniversaryOptOut: optOuts.includes("anniversary"),
      onboarded: employee?.onboarded || false,
      isActive: true,
    });
  }

  async function refreshEmployeeModal(client, body) {
    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: await buildEmployeesModal(),
    });
  }

  async function refreshEmployeesRootModal(client, employeesViewId) {
    if (!employeesViewId) {
      return;
    }

    await client.views.update({
      view_id: employeesViewId,
      view: await buildEmployeesModal(),
    });
  }

  async function openEditEmployee({ body, client, slackId }) {
    const employee = await db.getEmployee(slackId);
    await openOrPushModal({
      client,
      body,
      view: buildEmployeeEditorModal({
        userId: slackId,
        employee,
        callbackId: "save_edited_employee_modal",
        title: "Edit Employee",
        employeesViewId: body.view?.id || null,
      }),
    });
  }

  function register(app) {
    app.action("open_view_employees", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: await buildEmployeesModal(),
        });
      } catch (error) {
        logger.error("Failed to open employees modal", error);
      }
    });

    app.action("employee_search", async ({ ack, body, action, client }) => {
      await ack();

      try {
        const slackId = action.selected_user || null;
        logger.info('employee_search triggered. action: ' + JSON.stringify(action));
        
        await client.views.update({
          view_id: body.view.id,
          hash: body.view.hash,
          view: await buildEmployeesModal(slackId),
        });
        logger.info('employee_search view updated successfully.');
      } catch (error) {
        logger.error('employee_search error: ' + error.message, error);
      }
    });

    app.action("employee_search_clear", async ({ ack, body, client }) => {
      await ack();

      try {
        await client.views.update({
          view_id: body.view.id,
          hash: body.view.hash,
          view: await buildEmployeesModal(),
        });
      } catch (error) {
        logger.error("Failed to clear employee filter", error);
      }
    });

    app.action("open_manage_admins_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const admins = await db.listAdmins();
        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildManageAdminsModal(admins.map((admin) => admin.slack_id)),
        });
      } catch (error) {
        logger.error("Failed to open manage admins modal", error);
      }
    });

    app.action("open_import_dates_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildImportModal(),
        });
      } catch (error) {
        logger.error("Failed to open import modal", error);
      }
    });

    app.action("open_billing_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            title: { type: "plain_text", text: "💳 Billing" },
            close: { type: "plain_text", text: "Close" },
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "💳 Billing" },
              },
              {
                type: "context",
                elements: [{ type: "mrkdwn", text: "🏗️ _Billing management is coming soon. Stay tuned!_" }],
              },
            ],
          },
        });
      } catch (error) {
        logger.error("Failed to open billing modal", error);
      }
    });

    app.action("open_add_employee_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        await openOrPushModal({
          client,
          body,
          view: buildEmployeeSelectionModal({
            employeesViewId: body.view?.id || null,
          }),
        });
      } catch (error) {
        logger.error("Failed to open add employee modal", error);
      }
    });

    app.view("add_employee_select_submit", async ({ ack, view }) => {
      try {
        const userId = view.state.values.employee_user.value.selected_user;
        const existing = await db.getEmployee(userId);
        const metadata = JSON.parse(view.private_metadata || "{}");

        await ack({
          response_action: "update",
          view: buildEmployeeEditorModal({
            userId,
            employee: existing,
            callbackId: "save_added_employee_modal",
            title: "Add Employee",
            employeesViewId: metadata.employeesViewId || null,
          }),
        });
      } catch (error) {
        logger.error("Failed to prepare add employee editor", error);
        await ack();
      }
    });

    app.view("save_added_employee_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const metadata = JSON.parse(view.private_metadata || "{}");
        await saveEmployeeFromView(client, metadata.userId, view.state.values);
        await refreshEmployeesRootModal(client, metadata.employeesViewId);
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save added employee", error);
      }
    });

    app.action("employee_row_actions", async ({ ack, body, action, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const payload = JSON.parse(action.selected_option.value);
        if (payload.action === "clear") {
          await db.clearEmployeeCelebrationData(payload.slackId);
          await refreshEmployeeModal(client, body);
          await home.publishHome(client, body.user.id);
          return;
        }

        await openEditEmployee({
          body,
          client,
          slackId: payload.slackId,
        });
      } catch (error) {
        logger.error("Failed to handle employee row action", error);
      }
    });

    app.view("save_edited_employee_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const metadata = JSON.parse(view.private_metadata || "{}");
        await saveEmployeeFromView(client, metadata.userId, view.state.values);
        await refreshEmployeesRootModal(client, metadata.employeesViewId);
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save edited employee", error);
      }
    });

    app.view("manage_admins_submit", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const selectedUsers = view.state.values.admins.admins_select.selected_users || [];
        const existingAdmins = await db.listAdmins();
        const existingAdminIds = existingAdmins.map((admin) => admin.slack_id);

        const addedAdmins = selectedUsers.filter((id) => !existingAdminIds.includes(id));
        const removedAdmins = existingAdminIds.filter((id) => !selectedUsers.includes(id));

        await db.replaceAdmins(selectedUsers);

        for (const addedId of addedAdmins) {
          await slack.sendAdminAddedNotification(client, addedId);
          await home.publishHome(client, addedId);
        }

        for (const removedId of removedAdmins) {
          await slack.sendAdminRemovedNotification(client, removedId);
          await home.publishHome(client, removedId);
        }

        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save admins", error);
      }
    });

    app.view("import_dates_submit", async ({ ack, view, body, client }) => {
      const raw = view.state.values.import_blob.value.value || "";
      const rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (!rows.length) {
        await ack({
          response_action: "errors",
          errors: {
            import_blob: "Paste at least one row to import.",
          },
        });
        return;
      }

      await ack({ response_action: "clear" });

      try {
        for (const row of rows) {
          const [rawUser, rawBirthday, rawAnniversary] = row.split(",").map((part) => part.trim());
          const mentionMatch = rawUser.match(/<@([A-Z0-9]+)>/);
          const userId = mentionMatch ? mentionMatch[1] : rawUser;
          const birthday = parseLooseDate(rawBirthday);
          const anniversary = parseLooseDate(rawAnniversary);
          const display = await slack.getUserDisplay(client, userId);
          const email = await slack.getUserEmail(client, userId);

          await db.saveEmployee({
            slackId: userId,
            name: display.name,
            email,
            birthday,
            anniversary,
            isActive: true,
          });
        }

        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to import dates", error);
      }
    });
  }

  return {
    register,
  };
}

module.exports = {
  createEmployeesModule,
};
