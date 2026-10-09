import { eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";

/** Caller's admin flag, read from the DB (not the JWT) so revocation is immediate. */
export async function callerIsAdmin(userId: string): Promise<boolean> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return !!rows[0]?.isAdmin;
}
