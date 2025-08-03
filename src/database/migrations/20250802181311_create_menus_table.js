exports.up = function(knex) {
  return knex.schema.createTable('menus', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.integer('price').notNullable(); // in rupiah
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('menus');
};
