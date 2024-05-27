import chalk from "chalk";
import winston from "winston";
import { getConfig } from "./config";
import DiscordTransport from "./discordTransport";

chalk.level = 2;

const config = getConfig();
const logger_i = winston.createLogger({
  level: config.system.logLevel ?? "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({format:"YYYY-MM-DD HH:mm:ss"}),
    winston.format.printf(info => chalk`{gray ${info.timestamp}} ${info.level}: ${info.message}`+(info.splat!==undefined?`${info.splat}`:" "))
  ),
  transports: [
    new winston.transports.File({filename: "error.log", level: "error"}),
    new winston.transports.File({filename: "combined.log"}),
    new winston.transports.Console({
      level: "debug",
      handleExceptions: true
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: "exceptions.log" }),
    new winston.transports.File({ filename: "combined.log" })
  ]
});

const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
if (config.system.webhook !== undefined) {
  logger_i.add(new DiscordTransport({
    webhook: config.system.webhook,
    defaultMeta: { service: config.system.name },
    log(info, next) {
      info.message = info.message.replace(ansiRegex, '');
      DiscordTransport.prototype.log.call(this, info, next);
    },
  }));
}

if (config.system.exceptionsWebhook !== undefined) {
  logger_i.exceptions.handle(new DiscordTransport({
    webhook: config.system.exceptionsWebhook,
    defaultMeta: { service: config.system.name },
    log(info, next) {
      info.message = "<@333530784495304705> " + info.message.replace(ansiRegex, '');
      DiscordTransport.prototype.log.call(this, info, next);
    }
  }));
}

if (process.env.NODE_ENV !== "production") {
  logger_i.add(new winston.transports.Console({
    level: "debug",
    handleExceptions: true
  }));
}

export const logger = logger_i;
