const { app, receiver, db, slack, logger, REQUIRED_SCOPES } = require("./app");

const port = Number(process.env.PORT || 3000);

receiver.app.listen(port, async () => {
  logger.info(`Dex API Web Service listening on port ${port}`);
  logger.info(`Required Slack scopes: ${REQUIRED_SCOPES.join(", ")}`);

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
