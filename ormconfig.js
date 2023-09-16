const { join } = require("path");

const prefix = process.env.NODE_ENV === "production" ? "build" : "src";

module.exports = {
   "type": "sqlite",
   "database": "/data/database.sqlite",
   "synchronize": false,
   "logging": false,
   entities: [join(__dirname, prefix, "**", "entity", "*.{ts,js}")],
   migrations: [join(__dirname, "build", "**", "migration", "*.{ts,js}")],
   subscribers: [join(__dirname, prefix, "**", "subscriber", "*.{ts,js}")],
   "cli": {
      "entitiesDir": join(prefix, "entity"),
      "migrationsDir": join(prefix, "migration"),
      "subscribersDir": join(prefix, "subscriber")
   }
}
