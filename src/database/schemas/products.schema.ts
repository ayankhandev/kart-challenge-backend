import {
  pgTable,
  serial,
  varchar,
  timestamp,
  real,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    price: real('price').notNull(),
    image: jsonb('image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_products_category').on(table.category),
    index('idx_products_name').on(table.name),
  ],
);
