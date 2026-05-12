const { getAllowedGifCandidates } = require("../helpers/gifs");

/**
 * Manage Templates handler
 *
 * Provides a bulk-template library for Birthday and Work Anniversary messages.
 * Each template has:
 *  - a display name
 *  - an intro text line
 *  - a cheer message (supports <@USER>, {ANNIV_YEARS})
 *
 * GIFs are managed separately in a centralized pool per type (birthday / anniversary).
 * The scheduler picks a random template AND a random GIF independently, ensuring
 * maximum variety in celebration messages.
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

    // Pick a GIF from the centralized pool (not from the template)
    let gifUrl = null;
    let gifIndex = null;
    const centralGifs = await getCentralGifPool(type);
    if (centralGifs.length > 0) {
      const lastGifIdx = chosen.id === lastId ? (history?.lastGifIndex ?? null) : null;
      const allowedGifCandidates = await getAllowedGifCandidates(
        centralGifs.map((url, i) => ({ url, i })),
        { logger },
      );
      let gifCandidates = allowedGifCandidates
        .filter(({ i }) => i !== lastGifIdx);
      if (!gifCandidates.length) gifCandidates = allowedGifCandidates;

      if (gifCandidates.length) {
        const picked = gifCandidates[Math.floor(Math.random() * gifCandidates.length)];
        gifUrl = picked.url;
        gifIndex = picked.i;
      }
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

  /** Get the centralized GIF pool for a type from the legacy templates table */
  async function getCentralGifPool(type) {
    const template = await db.getTemplate(type);
    return template?.gifUrls || [];
  }

  /** Save the centralized GIF pool for a type */
  async function saveCentralGifPool(type, gifUrls) {
    await db.saveTemplate({
      type,
      gifUrls: Array.isArray(gifUrls) ? gifUrls : [],
    });
  }

  // ─── modal builders ──────────────────────────────────────────────────────

  /** Top-level list modal showing birthday & anniversary templates */
  function buildManageTemplatesModal({ birthdayTemplates, anniversaryTemplates, birthdayGifCount, anniversaryGifCount }) {
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
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${t.name}*\n${t.message.slice(0, 100)}${t.message.length > 100 ? "…" : ""}`,
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

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎬 *Birthday GIFs:* ${birthdayGifCount ? `_${birthdayGifCount} GIF(s) saved_` : "_No GIFs added yet_"}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "🎬 Birthday GIFs" },
        action_id: "open_gif_pool_birthday",
      },
    });

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
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${t.name}*\n${t.message.slice(0, 100)}${t.message.length > 100 ? "…" : ""}`,
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
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎬 *Anniversary GIFs:* ${anniversaryGifCount ? `_${anniversaryGifCount} GIF(s) saved_` : "_No GIFs added yet_"}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "🎬 Anniversary GIFs" },
        action_id: "open_gif_pool_anniversary",
      },
    });

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
              "💡 *Smart randomization:* The bot automatically rotates through your templates *and* GIFs independently — ensuring maximum variety in every celebration.",
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

  /** "Add / Edit" form modal — no GIF fields */
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
      ],
    };
  }

  /** "View" read-only modal — no GIF section */
  function buildViewModal({ template }) {
    const emoji = emojiForType(template.type);
    const label = labelForType(template.type);

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
    ];

    return {
      type: "modal",
      callback_id: "view_bulk_template_modal",
      title: { type: "plain_text", text: "👁️ View Template" },
      close: { type: "plain_text", text: "Close" },
      blocks,
    };
  }

  /** GIF pool management modal */
  function buildGifPoolModal({ type, gifUrls }) {
    const emoji = emojiForType(type);
    const label = labelForType(type);

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} ${label} GIFs` },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Manage the GIF pool for *${label.toLowerCase()}* celebrations. The bot randomly picks a different GIF each time, never repeating consecutively for the same person.`,
          },
        ],
      },
      { type: "divider" },
    ];

    if (gifUrls.length) {
      blocks.push({
        type: "header",
        text: { type: "plain_text", text: `🎬 Current GIFs (${gifUrls.length})` },
      });

      for (let i = 0; i < gifUrls.length; i++) {
        const url = gifUrls[i];
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${i + 1}. <${url}|${url.length > 60 ? url.slice(0, 57) + "…" : url}>`,
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "🗑️ Remove" },
            action_id: "remove_gif_from_pool",
            value: JSON.stringify({ type, index: i }),
            confirm: {
              title: { type: "plain_text", text: "Remove GIF?" },
              text: { type: "plain_text", text: "This GIF will be removed from the pool." },
              confirm: { type: "plain_text", text: "Remove" },
              deny: { type: "plain_text", text: "Cancel" },
            },
          },
        });
      }

      blocks.push({ type: "divider" });
    } else {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "_No GIFs added yet — paste URLs below to get started._" }],
      });
    }

    blocks.push(
      {
        type: "input",
        block_id: "new_gifs",
        optional: true,
        label: { type: "plain_text", text: "➕ Add GIF URLs (one per line)" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "https://media.giphy.com/media/xxx/giphy.gif\nhttps://media.giphy.com/media/yyy/giphy.gif",
          },
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 Paste one GIF URL per line. Click the link on any existing GIF to open it in your browser.",
          },
        ],
      },
    );

    return {
      type: "modal",
      callback_id: "save_gif_pool_modal",
      title: { type: "plain_text", text: `🎬 ${label} GIFs` },
      submit: { type: "plain_text", text: "💾 Save" },
      close: { type: "plain_text", text: "Back" },
      private_metadata: JSON.stringify({ type }),
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

        const [birthdayTemplates, anniversaryTemplates, birthdayGifPool, anniversaryGifPool] = await Promise.all([
          db.listBulkTemplates("birthday"),
          db.listBulkTemplates("anniversary"),
          getCentralGifPool("birthday"),
          getCentralGifPool("anniversary"),
        ]);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildManageTemplatesModal({
            birthdayTemplates,
            anniversaryTemplates,
            birthdayGifCount: birthdayGifPool.length,
            anniversaryGifCount: anniversaryGifPool.length,
          }),
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

    // ── GIF pool buttons ────────────────────────────────────────────────────
    app.action("open_gif_pool_birthday", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        const gifUrls = await getCentralGifPool("birthday");
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildGifPoolModal({ type: "birthday", gifUrls }),
        });
      } catch (error) {
        logger.error("Failed to open birthday GIF pool modal", error);
      }
    });

    app.action("open_gif_pool_anniversary", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        const gifUrls = await getCentralGifPool("anniversary");
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildGifPoolModal({ type: "anniversary", gifUrls }),
        });
      } catch (error) {
        logger.error("Failed to open anniversary GIF pool modal", error);
      }
    });

    // ── Remove a single GIF from pool ───────────────────────────────────────
    app.action("remove_gif_from_pool", async ({ ack, body, action, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) return;

        const payload = JSON.parse(action.value);
        const { type, index } = payload;
        const gifUrls = await getCentralGifPool(type);

        // Remove the GIF at the specified index
        const updated = gifUrls.filter((_, i) => i !== index);
        await saveCentralGifPool(type, updated);

        // Refresh the GIF pool modal
        await client.views.update({
          view_id: body.view.id,
          view: buildGifPoolModal({ type, gifUrls: updated }),
        });
      } catch (error) {
        logger.error("Failed to remove GIF from pool", error);
      }
    });

    // ── Save GIF pool ───────────────────────────────────────────────────────
    app.view("save_gif_pool_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const meta = JSON.parse(view.private_metadata || "{}");
        const { type } = meta;

        // Get existing GIFs
        const existingGifs = await getCentralGifPool(type);

        // Parse new GIFs from the input
        const rawNewGifs = view.state.values.new_gifs?.value?.value || "";
        const newGifs = rawNewGifs
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean);

        // Merge: existing + new (deduplicate)
        const allGifs = [...existingGifs];
        for (const gif of newGifs) {
          if (!allGifs.includes(gif)) {
            allGifs.push(gif);
          }
        }

        await saveCentralGifPool(type, allGifs);

        // Refresh home
        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save GIF pool", error);
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
          const [birthdayTemplates, anniversaryTemplates, birthdayGifPool, anniversaryGifPool] = await Promise.all([
            db.listBulkTemplates("birthday"),
            db.listBulkTemplates("anniversary"),
            getCentralGifPool("birthday"),
            getCentralGifPool("anniversary"),
          ]);

          await client.views.update({
            view_id: body.view.id,
            view: buildManageTemplatesModal({
              birthdayTemplates,
              anniversaryTemplates,
              birthdayGifCount: birthdayGifPool.length,
              anniversaryGifCount: anniversaryGifPool.length,
            }),
          });
          return;
        }
      } catch (error) {
        logger.error("Failed to handle bulk template action", error);
      }
    });

    // ── Save (add or update) — no GIFs saved per template ───────────────────
    app.view("save_bulk_template_modal", async ({ ack, view, body, client }) => {
      await ack({ response_action: "clear" });

      try {
        const meta = JSON.parse(view.private_metadata || "{}");
        const { type, id } = meta;

        const name = (view.state.values.template_name?.value?.value || "").trim() || "Template";
        const introText = (view.state.values.template_intro?.value?.value || "").trim();
        const message = (view.state.values.template_message?.value?.value || "").trim();

        await db.saveBulkTemplate({ id: id || null, type, name, message, introText, gifUrls: [] });

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
    getCentralGifPool,
  };
}

module.exports = { createManageTemplatesModule };
