/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('menu_choices', function(table) {
    table.enu('status', ['pending', 'paid', 'failed', 'cancelled']).defaultTo('pending');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('menu_choices', function(table) {
    table.dropColumn('status');
  });
};
