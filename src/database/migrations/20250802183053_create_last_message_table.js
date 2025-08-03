
const tableName = 'last_messages';

exports.up = function(knex) {
  return knex.schema.createTable(tableName, (table) => {
    table.increments('id').primary();
    table.string('phone').unique().notNullable();
    table.text('messages').notNullable();
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable(tableName);
};
