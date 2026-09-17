import type { Config } from 'drizzle-kit';

export default {
    schema: './src/lib/server/db/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        url: './db.sqlite'
    }
} satisfies Config;
