
const tableName = 'users';

exports.up = function(knex) {
  return knex.schema.createTable(tableName, (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('phone').notNullable();
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable(tableName);
};
