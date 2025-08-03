exports.up = function(knex) {
  return knex.schema.createTable('menu_choices', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('menu_id').references('id').inTable('menus').onDelete('CASCADE');
    table.timestamp('chosen_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('menu_choices');
};
