require("dotenv").config();
const { WebClient } = require("@slack/web-api");

async function testPublish() {
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  const userIds = ["U0AT493S7HC", "U0B0KDWA7GU", "U0A9MLLBEHY"];

  for (const userId of userIds) {
    try {
      console.log(`Attempting to publish home view to ${userId}...`);
      await client.views.publish({
        user_id: userId,
        view: {
          type: "home",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "✅ *Success!* If you are seeing this, the bot token works!"
              }
            }
          ]
        }
      });
      console.log(`✅ Successfully published to ${userId}`);
    } catch (error) {
      console.error(`❌ Failed for ${userId}:`, error.data || error.message);
    }
  }
}

testPublish();
