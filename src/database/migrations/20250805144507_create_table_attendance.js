/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const tableName = "attendances";
exports.up = function (knex) {
  return knex.schema.createTable(tableName, (table) => {
    table.increments("id").primary();
    table.string("user_id").unique().notNullable();
    table.datetime("checkin");
    table.foreign("user_id").references("id").inTable("users");
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable(tableName);
};
