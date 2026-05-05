require("dotenv").config();

const { App, ExpressReceiver } = require("@slack/bolt");
const { createDbHelpers } = require("./helpers/db");
const { createSlackHelpers } = require("./helpers/slack");
const { createHomeModule } = require("./handlers/home");
const { createEmployeesModule } = require("./handlers/employees");
const { createSettingsModule } = require("./handlers/settings");
const { createRemindersModule } = require("./handlers/reminders");
const { createOnboardingModule } = require("./handlers/onboarding");
const { createCalendarModule } = require("./handlers/calendar");
const { createTestCenterModule } = require("./handlers/testcenter");
const { createDataManagerModule } = require("./handlers/datamanager");
const { createTemplatesModule } = require("./handlers/templates");
const { createScheduler } = require("./cron/scheduler");

const REQUIRED_SCOPES = [
  "chat:write",
  "users:read",
  "users:read.email",
  "users.profile:read",
  "im:write",
  "channels:read",
  "groups:read",
  "files:read",
];

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: "/slack/events",
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const logger = console;
const db = createDbHelpers({ logger });
const slack = createSlackHelpers({ logger });

const home = createHomeModule({ db, slack, logger });
const employees = createEmployeesModule({ db, slack, home });
const settings = createSettingsModule({ db, slack, home });
const reminders = createRemindersModule({ db, home });
const onboarding = createOnboardingModule({ db, slack, home, logger });
const calendar = createCalendarModule({ db, slack, home, logger });
const testCenter = createTestCenterModule({ db, slack, home, logger });
const dataManager = createDataManagerModule({ db, slack, home, logger });
const templates = createTemplatesModule({ db, slack, home, logger });
const scheduler = createScheduler({ app, db, slack, logger });

home.register(app);
employees.register(app);
settings.register(app);
reminders.register(app);
onboarding.register(app);
calendar.register(app);
testCenter.register(app);
dataManager.register(app);
templates.register(app);

receiver.app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    scopes_required: REQUIRED_SCOPES,
  });
});

app.error(async (error) => {
  logger.error("Bolt runtime error", error);
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection", error);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
});

const port = Number(process.env.PORT || 3000);

receiver.app.listen(port, async () => {
  logger.info(`Dex celebration bot listening on port ${port}`);
  logger.info(`Required Slack scopes: ${REQUIRED_SCOPES.join(", ")}`);
  scheduler.start();

  // Backfill emails for employees missing them
  try {
    const backfilled = await db.backfillEmails(app.client, slack);
    if (backfilled > 0) {
      logger.info(`Email backfill completed: ${backfilled} employee(s) updated`);
    }
  } catch (error) {
    logger.error("Email backfill failed", error);
  }
});
