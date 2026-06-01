require("dotenv").config();
const crypto = require("crypto");
const https = require("https");

const signingSecret = process.env.SLACK_SIGNING_SECRET;

function sendEvent(userId) {
  const payload = JSON.stringify({
    token: "fake_token",
    team_id: "T1234567",
    api_app_id: "A1234567",
    event: {
      type: "app_home_opened",
      user: userId,
      channel: "D1234567",
      tab: "home"
    },
    type: "event_callback",
    event_id: "Ev1234567",
    event_time: Math.floor(Date.now() / 1000)
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const sigBasestring = `v0:${timestamp}:${payload}`;
  const signature = "v0=" + crypto.createHmac("sha256", signingSecret).update(sigBasestring, "utf8").digest("hex");

  const req = https.request("https://dex-slack-bot-production.up.railway.app/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature
    }
  }, (res) => {
    console.log(`Sent app_home_opened for ${userId} -> Railway status: ${res.statusCode}`);
  });

  req.on("error", console.error);
  req.write(payload);
  req.end();
}

const userIds = ["U0AT493S7HC", "U0B0KDWA7GU", "U0A9MLLBEHY"];
userIds.forEach(sendEvent);
