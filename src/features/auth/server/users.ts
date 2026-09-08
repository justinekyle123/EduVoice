import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type SyncUserInput = {
  clerkId: string;
  email: string;
  name?: string | null;
};

/** Insert or update a user row keyed by the Clerk user id. */
export async function upsertUser(input: SyncUserInput) {
  const [user] = await db
    .insert(users)
    .values({
      clerkId: input.clerkId,
      email: input.email,
      name: input.name ?? null,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        email: input.email,
        name: input.name ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return user ?? null;
}

export async function getUserByClerkId(clerkId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  return user ?? null;
}

export async function deleteUserByClerkId(clerkId: string) {
  await db.delete(users).where(eq(users.clerkId, clerkId));
}