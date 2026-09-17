import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// Starter schema — a to-do list. Replace this with your app's actual tables.
// After changing this file, run: bun run db:generate
export const todos = sqliteTable('todos', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    text: text('text').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date())
});

export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
