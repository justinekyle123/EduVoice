import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studyRoomMembers } from "@/lib/db/schema";

// Shared room-membership lookup. Kept free of "use server" so plain server code
// (the quiz actions, for instance) can import it without turning it into a
// client-callable action.

/** The caller's membership row in a room, or null when they aren't a member. */
export async function membershipFor(roomId: string, userId: string) {
  const [member] = await db
    .select()
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, userId)
      )
    );
  return member ?? null;
}

/** True when the user belongs to the room — the gate for room-scoped writes. */
export async function isRoomMember(roomId: string, userId: string) {
  return (await membershipFor(roomId, userId)) !== null;
}
