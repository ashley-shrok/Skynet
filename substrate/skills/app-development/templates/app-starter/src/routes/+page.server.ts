import { db } from '$lib/server/db';
import { todos } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
    const items = db.select().from(todos).orderBy(desc(todos.createdAt)).all();
    return { items };
};

export const actions: Actions = {
    add: async ({ request }) => {
        const form = await request.formData();
        const text = String(form.get('text') ?? '').trim();
        if (!text) return fail(400, { error: 'text is required' });
        db.insert(todos).values({ text }).run();
        return { success: true };
    },

    toggle: async ({ request }) => {
        const form = await request.formData();
        const id = Number(form.get('id'));
        if (!Number.isInteger(id)) return fail(400, { error: 'invalid id' });
        const current = db.select().from(todos).where(eq(todos.id, id)).get();
        if (!current) return fail(404, { error: 'not found' });
        db.update(todos).set({ done: !current.done }).where(eq(todos.id, id)).run();
        return { success: true };
    },

    delete: async ({ request }) => {
        const form = await request.formData();
        const id = Number(form.get('id'));
        if (!Number.isInteger(id)) return fail(400, { error: 'invalid id' });
        db.delete(todos).where(eq(todos.id, id)).run();
        return { success: true };
    }
};
