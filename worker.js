const { scheduler, logger } = require("./app");

logger.info(`Cheery Scheduler Worker starting...`);
scheduler.start();
