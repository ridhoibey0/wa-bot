require("dotenv").config();
module.exports = {
  development: {
    client: "postgresql",
    connection: {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      typeCast: function (field, next) {
        // THIS CODE FOR MYSQL DATABASE
        if (
          (field.type == "TINY" && field.length == 1) ||
          (!field.table && field.length == 1)
        ) {
          let value = field.string();
          return value ? value == "1" : null;
        }
        return next();
      },
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
      directory: "src/database/migrations",
    },
    seeds: {
      directory: "src/database/seeds",
    },
  },
};
