import { and, asc, eq } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { roomFiles, roomMessages, users } from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";

// Shared room files (feature 6.13) — the host drops a study file into the room
// chat and everyone can download it.
//
// The bytes live in Postgres (`room_files.data`) so this needs no external
// object store and no extra credentials. Downloads never get a public URL: they
// go through an authenticated route that checks room membership first, so a
// shared file is only readable by the room it was posted in. Kept free of
// "use server" so the route handlers can import it without turning every helper
// into a client-callable action.

/** Keep uploaded files small — these are class notes, not media libraries. */
export const MAX_ROOM_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * File types a room may share. Kept broad enough for notes (text/PDF/Office) and
 * images of handouts, while excluding executables and archives that have no
 * place in a study chat.
 */
const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
];
const ALLOWED_EXT = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
];

export function isAllowedRoomFile(fileName: string, fileType: string): boolean {
  const lower = fileType.toLowerCase();
  if (ALLOWED_MIME.includes(lower)) return true;
  // Browsers are inconsistent about MIME type for Office files, so the
  // extension is the reliable signal.
  const name = fileName.toLowerCase();
  return ALLOWED_EXT.some((ext) => name.endsWith(ext));
}

/**
 * Resolve the signed-in Clerk id to the Postgres `users.id`, creating the row on
 * demand if the webhook hasn't synced the user yet. Same pattern as the room and
 * chat actions use.
 */
export async function resolveAppUserId(
  clerkId: string
): Promise<string> {
  let user = await getUserByClerkId(clerkId);
  if (!user) {
    const clerkUser = await currentUser();
    user = await upsertUser({
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: clerkUser?.fullName ?? clerkUser?.username ?? null,
    });
  }
  return user.id;
}

export type RoomFileRow = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: Date;
  uploadedBy: string;
};

/** Metadata for every file shared in a room, oldest first (a timeline). */
export async function listRoomFiles(roomId: string): Promise<RoomFileRow[]> {
  const rows = await db
    .select({
      id: roomFiles.id,
      fileName: roomFiles.fileName,
      fileType: roomFiles.fileType,
      fileSize: roomFiles.fileSize,
      createdAt: roomFiles.createdAt,
      uploadedBy: users.name,
      uploaderEmail: users.email,
    })
    .from(roomFiles)
    .innerJoin(users, eq(users.id, roomFiles.userId))
    .where(eq(roomFiles.roomId, roomId))
    .orderBy(asc(roomFiles.createdAt));

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy ?? row.uploaderEmail,
  }));
}

/**
 * Store a shared file and post it to the room chat as a message. The chat line
 * is what makes the upload visible in the conversation; its `fileId` turns it
 * into a downloadable card.
 */
export async function saveRoomFile(input: {
  roomId: string;
  userId: string;
  fileName: string;
  fileType: string;
  bytes: Buffer;
}) {
  const [file] = await db
    .insert(roomFiles)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.bytes.length,
      data: input.bytes,
    })
    .returning({
      id: roomFiles.id,
      fileName: roomFiles.fileName,
      fileType: roomFiles.fileType,
      fileSize: roomFiles.fileSize,
      createdAt: roomFiles.createdAt,
    });

  await db.insert(roomMessages).values({
    roomId: input.roomId,
    userId: input.userId,
    content: input.fileName,
    fileId: file.id,
  });

  return file;
}

/** The file's bytes plus the metadata needed for a download response. */
export async function readRoomFile(roomId: string, fileId: string) {
  const [file] = await db
    .select({
      id: roomFiles.id,
      fileName: roomFiles.fileName,
      fileType: roomFiles.fileType,
      data: roomFiles.data,
    })
    .from(roomFiles)
    // Scoping to the room is the access check: a file id alone can't read a
    // file that belongs to a room the caller isn't in.
    .where(and(eq(roomFiles.id, fileId), eq(roomFiles.roomId, roomId)));

  return file ?? null;
}

export async function deleteRoomFile(roomId: string, fileId: string) {
  await db
    .delete(roomFiles)
    .where(and(eq(roomFiles.id, fileId), eq(roomFiles.roomId, roomId)));
}
