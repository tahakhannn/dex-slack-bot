const { scheduler, logger } = require("./app");

logger.info(`Dex Scheduler Worker starting...`);
scheduler.start();
