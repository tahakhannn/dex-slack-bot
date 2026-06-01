require("dotenv").config();
const { WebClient } = require("@slack/web-api");

async function testSlack() {
  try {
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);
    const res = await client.auth.test();
    console.log("✅ Token works!");
    console.log("Bot User:", res.user);
    console.log("Workspace:", res.team);
  } catch (error) {
    console.error("❌ Slack connection failed:", error.data || error.message);
  }
}

testSlack();
