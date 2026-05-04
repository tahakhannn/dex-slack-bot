function createTemplatesModule({ db, home, logger = console }) {
  const DEFAULT_INTRO = "Your daily dose of celebration is here, let's do it 🥳";

  const DEFAULT_TEMPLATES = {
    birthday: {
      message: "Let's give <@USER> a big cheer for being awesome! 🎊",
      gifUrls: [
        "https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.gif",
        "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
        "https://media.giphy.com/media/3oEhmNLxk9uiTbL9Be/giphy.gif",
        "https://media.giphy.com/media/26FPpSuhgHvYo9Kyk/giphy.gif",
        "https://media.giphy.com/media/Im6d35ebkCIiGzonjI/giphy.gif",
      ],
    },
    anniversary: {
      message:
        "Let's celebrate <@USER> and this {ANNIV_YEARS} milestone — {TONE}! 🎊",
      gifUrls: [
        "https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif",
        "https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif",
        "https://media.giphy.com/media/fPRwBcYd71Lox1v7p2/giphy.gif",
        "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif",
      ],
    },
  };

  function buildTemplatesModal(birthdayTemplate, anniversaryTemplate) {
    const birthday = birthdayTemplate || DEFAULT_TEMPLATES.birthday;
    const anniversary = anniversaryTemplate || DEFAULT_TEMPLATES.anniversary;
    const introText =
      birthdayTemplate?.introText || anniversaryTemplate?.introText || DEFAULT_INTRO;

    return {
      type: "modal",
      callback_id: "save_templates_modal",
      title: { type: "plain_text", text: "✍️ Templates" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "✍️ Message templates" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Adjust the celebration intro, cheer messages, and GIF pools.\nSupported variables: `<@USER>`, `{ANNIV_YEARS}`, `{TONE}`.",
            },
          ],
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "📣 Intro line" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "The opening line shown at the top of every celebration message.",
            },
          ],
        },
        {
          type: "input",
          block_id: "intro_text",
          label: { type: "plain_text", text: "Intro text" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            initial_value: introText,
          },
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "🎂 Birthday template" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "The cheer line shown below the birthday details.\nUse `<@USER>` to mention. Format: `*bold*` `_italic_` `~strike~`.",
            },
          ],
        },
        {
          type: "input",
          block_id: "birthday_message",
          label: { type: "plain_text", text: "Cheer message" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            initial_value: birthday.message || "",
          },
        },
        {
          type: "input",
          block_id: "birthday_gifs",
          optional: true,
          label: { type: "plain_text", text: "GIF URLs (one per line)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            initial_value: (birthday.gifUrls || []).join("\n"),
          },
        },
        { type: "divider" },
        {
          type: "header",
          text: { type: "plain_text", text: "💼 Anniversary template" },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "The cheer line shown below the anniversary details.\nUse `<@USER>`, `{ANNIV_YEARS}`, `{TONE}`. Format: `*bold*` `_italic_` `~strike~`.",
            },
          ],
        },
        {
          type: "input",
          block_id: "anniversary_message",
          label: { type: "plain_text", text: "Cheer message" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            initial_value: anniversary.message || "",
          },
        },
        {
          type: "input",
          block_id: "anniversary_gifs",
          optional: true,
          label: { type: "plain_text", text: "GIF URLs (one per line)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            initial_value: (anniversary.gifUrls || []).join("\n"),
          },
        },
      ],
    };
  }

  function register(app) {
    app.action("open_templates_modal", async ({ ack, body, client }) => {
      await ack();

      try {
        if (!(await db.isAdmin(body.user.id))) {
          return;
        }

        const [birthdayTemplate, anniversaryTemplate] = await Promise.all([
          db.getTemplate("birthday"),
          db.getTemplate("anniversary"),
        ]);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildTemplatesModal(birthdayTemplate, anniversaryTemplate),
        });
      } catch (error) {
        logger.error("Failed to open templates modal", error);
      }
    });

    app.view("save_templates_modal", async ({ ack, view, body, client }) => {
      await ack();

      try {
        const introText = (view.state.values.intro_text.value.value || "").trim();

        const birthdayGifs = (view.state.values.birthday_gifs.value.value || "")
          .split("\n")
          .map((url) => url.trim())
          .filter(Boolean);

        const anniversaryGifs = (view.state.values.anniversary_gifs.value.value || "")
          .split("\n")
          .map((url) => url.trim())
          .filter(Boolean);

        await Promise.all([
          db.saveTemplate({
            type: "birthday",
            message: view.state.values.birthday_message.value.value,
            introText,
            gifUrls: birthdayGifs,
          }),
          db.saveTemplate({
            type: "anniversary",
            message: view.state.values.anniversary_message.value.value,
            introText,
            gifUrls: anniversaryGifs,
          }),
        ]);

        await home.publishHome(client, body.user.id);
      } catch (error) {
        logger.error("Failed to save templates", error);
      }
    });
  }

  return {
    register,
    DEFAULT_INTRO,
  };
}

module.exports = {
  createTemplatesModule,
};
