require("dotenv").config();
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const signingSecret = process.env.SLACK_SIGNING_SECRET;

const payload = JSON.stringify({
  token: "fake_token",
  challenge: "test_challenge_123",
  type: "url_verification"
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
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${body}`);
  });
});

req.on("error", (e) => {
  console.error(e);
});

req.write(payload);
req.end();
