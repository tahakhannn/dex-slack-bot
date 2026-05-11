/**
 * Manage Templates handler
 *
 * Provides a bulk-template library for Birthday and Work Anniversary messages.
 * Each template has:
 *  - a display name
 *  - a cheer message (supports <@USER>, {ANNIV_YEARS})
 *  - multiple GIF URLs (randomly picked, non-repeating per user)
 *
 * The scheduler calls `chooseBulkTemplateForEvent` instead of the single
 * db template, giving true randomized rotation across the library.
 */

function createManageTemplatesModule({ db, home, logger = console }) {
  // ─── helpers ─────────────────────────────────────────────────────────────

  function emojiForType(type) {
    return type === "birthday" ? "🎂" : "💼";
  }

  function labelForType(type) {
    return type === "birthday" ? "Birthday" : "Work Anniversary";
  }

  /** Pick a bulk template that wasn't used last time for this user/type. */
  async function chooseBulkTemplateForEvent({ slackId, type }) {
    const templates = await db.listBulkTemplates(type);
    if (!templates.length) return null;

    const history = await db.getBulkTemplateHistory(slackId, type);
    const lastId = history?.lastTemplateId ?? null;

    // Try to avoid repeating the same template
    let candidates = templates.filter((t) => t.id !== lastId);
    if (!candidates.length) candidates = templates; // only 1 template → allow repeat

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    // Pick a GIF inside the template (avoid last gif index only if same template)
    let gifUrl = null;
    let gifIndex = null;
    if (chosen.gifUrls && chosen.gifUrls.length > 0) {
      const lastGifIdx = chosen.id === lastId ? (history?.lastGifIndex ?? null) : null;
      let gifCandidates = chosen.gifUrls
        .map((url, i) => ({ url, i }))
        .filter(({ i }) => i !== lastGifIdx);
      if (!gifCandidates.length) gifCandidates = chosen.gifUrls.map((url, i) => ({ url, i }));
      const picked = gifCandidates[Math.floor(Math.random() * gifCandidates.length)];
      gifUrl = picked.url;
      gifIndex = picked.i;
    }

    // Save history for next time
    await db.saveBulkTemplateHistory({
      slackId,
      type,
      lastTemplateId: chosen.id,
      lastGifIndex: gifIndex,
    });

    return {
      templateId: chosen.id,
      messageTemplate: chosen.message,
      introText: chosen.introText || "",
      gifUrl,
      gifIndex,
    };
  }

  // ─── modal builders ──────────────────────────────────────────────────────

  /** Top-level list modal showing birthday & anniversary templates */
  function buildManageTemplatesModal({ birthdayTemplates, anniversaryTemplates }) {
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "📋 Manage Templates" },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Build a library of celebration messages. The bot picks a different template each time, never repeating consecutively.\nVariables: `<@USER>`, `{ANNIV_YEARS}` · Format: `*bold*` `_italic_` `~strike~`",
          },
        ],
      },
      { type: "divider" },
    ];

    // ── Birthday section ──────────────────────────────────────────────────
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "🎂 Birthday Templates" },
    });

    if (!birthdayTemplates.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "_No birthday templates yet — add one below._" }],
      });
    } else {
      for (const t of birthdayTemplates) {
        const gifCount = t.gifUrls?.length || 0;
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${t.name}*\n${t.message.slice(0, 100)}${t.message.length > 100 ? "…" : ""}${gifCount ? `\n_${gifCount} GIF(s) attached_` : ""}`,
          },
          accessory: {
            type: "overflow",
            action_id: "bulk_template_action",
            options: [
              {
                text: { type: "plain_text", text: "👁️ View" },
                value: JSON.stringify({ action: "view", id: t.id, type: "birthday" }),
              },
              {
                text: { type: "plain_text", text: "✏️ Edit" },
                value: JSON.stringify({ action: "edit", id: t.id, type: "birthday" }),
              },
              {
                text: { type: "plain_text", text: "🗑️ Delete" },
                value: JSON.stringify({ action: "delete", id: t.id, type: "birthday" }),
              },
            ],
          },
        });
      }
    }

    blocks.push(
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "➕ Add Birthday Template" },
            action_id: "add_bulk_template_birthday",
            style: "primary",
          },
        ],
      },
      { type: "divider" },
    );

    // ── Anniversary section ───────────────────────────────────────────────
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "💼 Work Anniversary Templates" },
    });

    if (!anniversaryTemplates.length) {
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_No anniversary templates yet — add one below._" },
        ],
      });
    } else {
      for (const t of anniversaryTemplates) {
        const gifCount = t.gifUrls?.length || 0;
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${t.name}*\n${t.message.slice(0, 100)}${t.message.length > 100 ? "…" : ""}${gifCount ? `\n_${gifCount} GIF(s) attached_` : ""}`,
          },
          accessory: {
            type: "overflow",
            action_id: "bulk_template_action",
            options: [
              {
                text: { type: "plain_text", text: "👁️ View" },
                value: JSON.stringify({ action: "view", id: t.id, type: "anniversary" }),
              },
              {
                text: { type: "plain_text", text: "✏️ Edit" },
                value: JSON.stringify({ action: "edit", id: t.id, type: "anniversary" }),
              },
              {
                text: { type: "plain_text", text: "🗑️ Delete" },
                value: JSON.stringify({ action: "delete", id: t.id, type: "anniversary" }),
              },
            ],
          },
        });
      }
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "➕ Add Anniversary Template" },
          action_id: "add_bulk_template_anniversary",
          style: "primary",
        },
      ],
    });

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "💡 *Smart randomization:* The bot automatically rotates through your templates and never picks the same one twice in a row for the same person.",
          },
        ],
      },
    );

    return {
      type: "modal",
      callback_id: "manage_templates_modal",
      title: { type: "plain_text", text: "📋 Manage Templates" },
      close: { type: "plain_text", text: "Close" },
      blocks,
    };
  }

  /** "Add / Edit" form modal */
  function buildAddEditModal({ type, existing = null }) {
    const isEdit = Boolean(existing);
    const emoji = emojiForType(type);
    const label = labelForType(type);

    return {
      type: "modal",
      callback_id: "save_bulk_template_modal",
      title: {
        type: "plain_text",
        text: isEdit ? `✏️ Edit Template` : `➕ Add Template`,
      },
      submit: { type: "plain_text", text: isEdit ? "Save Changes" : "Add Template" },
      close: { type: "plain_text", text: "Back" },
      private_metadata: JSON.stringify({
        type,
        id: existing?.id || null,
      }),
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} ${label} Template` },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Variables: \`<@USER>\`${type === "anniversary" ? ", `{ANNIV_YEARS}`" : ""} · Format: \`*bold*\` \`_italic_\` \`~strike~\``,
            },
          ],
        },
        {
          type: "input",
          block_id: "template_name",
          label: { type: "plain_text", text: "Template Name" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. Warm & Casual" },
            ...(existing?.name ? { initial_value: existing.name } : {}),
          },
        },
        {
          type: "input",
          block_id: "template_intro",
          optional: true,
          label: { type: "plain_text", text: "📣 Intro Line" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. Today is a celebration day, everybody gather around 🥳" },
            ...(existing?.introText ? { initial_value: existing.introText } : {}),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "The opening line shown at the top of every celebration message posted.",
            },
          ],
        },
        {
          type: "input",
          block_id: "template_message",
          label: { type: "plain_text", text: "Cheer Message" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text:
                type === "birthday"
                  ? "e.g. 🎉 Happy Birthday <@USER>! Hope your day is amazing!"
                  : "e.g. 🎊 Congrats <@USER> on {ANNIV_YEARS} incredible years!",
            },
            ...(existing?.message ? { initial_value: existing.message } : {}),
          },
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "🎬 GIFs for this template" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text:
                "Add multiple GIF URLs (one per line). The bot will rotate through them so the *same message* shows a *different GIF* each time it is triggered.",
            },
          ],
        },
        {
          type: "input",
          block_id: "template_gifs",
          optional: true,
          label: { type: "plain_text", text: "GIF URLs (one per line)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "https://media.giphy.com/media/xxx/giphy.gif\nhttps://media.giphy.com/media/yyy/giphy.gif",
            },
            ...(existing?.gifUrls?.length
              ? { initial_value: existing.gifUrls.join("\n") }
              : {}),
          },
        },
      ],
    };
  }

  /** "View" read-only modal */
  function buildViewModal({ template }) {
    const emoji = emojiForType(template.type);
    const label = labelForType(template.type);
    const gifCount = template.gifUrls?.length || 0;

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} ${label} Template` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Name:* ${template.name}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📣 Intro Line:* ${template.introText || "_Default intro_"}`
        }
      },
      { type: "divider" },
      {
        type: "header",
        text: { type: "plain_text", text: "💬 Message preview" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            template.message
              .replace(/<@USER>/g, "@SampleUser")
              .replace(/\{ANNIV_YEARS\}/g, "5") || "_No message set_",
        },
      },
    ];

    if (gifCount) {
      blocks.push(
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: `🎬 GIFs (${gifCount})` },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: template.gifUrls.map((url, i) => `${i + 1}. ${url}`).join("\n"),
            },
          ],
        },
      );
    } else {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "_No GIFs attached to this template._" }],
      });
    }

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Template ID: ${template.id} · Type: ${label}`,
          },
        ],
      },
    );

    return {
      type: "modal",
      callback_id: "view_bulk_template_modal",
      title: { type: "plain_text", text: "👁️ View Template" },
      close: { type: "plain_text", text: "Close" },
      blocks,
    };
  }

  // ─── register ─────────────────────────────────────────────────────────────

  function register(app) {
    // Open the main Manage Templates list
    app.action("open_manage_templates_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        const [birthdayTemplates, anniversaryTemplates] = await Promise.all([
          db.listBulkTemplates("birthday"),
          db.listBulkTemplates("anniversary"),
        ]);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildManageTemplatesModal({ birthdayTemplates, anniversaryTemplates }),
        });
      } catch (error) {
        logger.error("Failed to open manage templates modal", error);
      }
    });

    // ── Add buttons ─────────────────────────────────────────────────────────
    app.action("add_bulk_template_birthday", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildAddEditModal({ type: "birthday" }),
        });
      } catch (error) {
        logger.error("Failed to open add birthday template modal", error);
      }
    });

    app.action("add_bulk_template_anniversary", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildAddEditModal({ type: "anniversary" }),
        });
      } catch (error) {
        logger.error("Failed to open add anniversary template modal", error);
      }
    });

    // ── Overflow (view / edit / delete) ─────────────────────────────────────
    app.action("bulk_template_action", async ({ ack, body, action, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        const payload = JSON.parse(action.selected_option.value);
        const { action: templateAction, id, type } = payload;

        if (templateAction === "view") {
          const template = await db.getBulkTemplate(id);
          if (!template) return;

          await client.views.push({
            trigger_id: body.trigger_id,
            view: buildViewModal({ template }),
          });
          return;
        }

        if (templateAction === "edit") {
          const template = await db.getBulkTemplate(id);
          if (!template) return;

          await client.views.push({
            trigger_id: body.trigger_id,
            view: buildAddEditModal({ type, existing: template }),
          });
          return;
        }

        if (templateAction === "delete") {
          await db.deleteBulkTemplate(id);

          // Refresh the list modal by updating the current view
          const [birthdayTemplates, anniversaryTemplates] = await Promise.all([
            db.listBulkTemplates("birthday"),
            db.listBulkTemplates("anniversary"),
          ]);

          await client.views.update({
            view_id: body.view.id,
            view: buildManageTemplatesModal({ birthdayTemplates, anniversaryTemplates }),
          });
          return;
        }
      } catch (error) {
        logger.error("Failed to handle bulk template action", error);
      }
    });

    // ── Save (add or update) ────────────────────────────────────────────────
    app.view("save_bulk_template_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const meta = JSON.parse(view.private_metadata || "{}");
        const { type, id } = meta;

        const name = (view.state.values.template_name?.value?.value || "").trim() || "Template";
        const introText = (view.state.values.template_intro?.value?.value || "").trim();
        const message = (view.state.values.template_message?.value?.value || "").trim();
        const rawGifs = view.state.values.template_gifs?.value?.value || "";
        const gifUrls = rawGifs
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean);

        await db.saveBulkTemplate({ id: id || null, type, name, message, introText, gifUrls });

        // Refresh home
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save bulk template", error);
      }
    });
  }

  return {
    register,
    chooseBulkTemplateForEvent,
  };
}

module.exports = { createManageTemplatesModule };
