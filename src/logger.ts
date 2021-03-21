import chalk from "chalk";
import winston from "winston";
import { getConfig } from "./config";

chalk.level = 2;

const logger_i = winston.createLogger({
  level: getConfig().system.logLevel ?? "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({format:'YYYY-MM-DD HH:mm:ss'}),
    winston.format.printf(info => chalk`{gray ${info.timestamp}} ${info.level}: ${info.message}`+(info.splat!==undefined?`${info.splat}`:" "))
  ),
  transports: [
    new winston.transports.Console()
  ],
});

if (process.env.NODE_ENV === "production") {
  logger_i.add(new winston.transports.File({ filename: "error.log", level: "error" }));
  logger_i.add(new winston.transports.File({ filename: "combined.log" }));
}

export const logger = logger_i;
