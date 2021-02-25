import winston from "winston";
 
const logger_i = winston.createLogger({
  level: "debug",
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
