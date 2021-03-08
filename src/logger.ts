import winston from "winston";
import { getConfig } from "./config";

const logger_i = winston.createLogger({
  level: getConfig().system.logLevel ?? "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    })
  ],
});

if (process.env.NODE_ENV === "production") {
  logger_i.add(new winston.transports.File({ filename: "error.log", level: "error" }));
  logger_i.add(new winston.transports.File({ filename: "combined.log" }));
}

export const logger = logger_i;
