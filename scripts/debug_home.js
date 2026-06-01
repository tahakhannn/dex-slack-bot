require("dotenv").config();
const { App } = require("@slack/bolt");
const { createSlackHelpers } = require("./helpers/slack");
const { createDbHelpers } = require("./helpers/db");
const { createHomeModule } = require("./handlers/home");

async function debugHome() {
  const app = new App({ token: process.env.SLACK_BOT_TOKEN, signingSecret: process.env.SLACK_SIGNING_SECRET });
  const db = createDbHelpers({ logger: console });
  const slack = createSlackHelpers({ logger: console });
  const home = createHomeModule({ db, slack, logger: console });

  const userId = "U0A9MLLBEHY"; // The user's ID we successfully published to before
  try {
    console.log("Calling ensureSlackUserRecord...");
    await slack.ensureSlackUserRecord(app.client, userId, db);
    
    console.log("Calling publishHome...");
    await home.publishHome(app.client, userId);
    console.log("✅ Successfully published real home view!");
  } catch (error) {
    console.error("❌ Crashed:", error);
  }
}

debugHome();
