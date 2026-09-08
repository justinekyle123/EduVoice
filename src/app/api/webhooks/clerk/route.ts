import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import {
  deleteUserByClerkId,
  upsertUser,
} from "@/features/auth/server/users";

// Keeps the Postgres `users` table in sync with Clerk.
// Events subscribed in the Clerk dashboard: user.created, user.updated, user.deleted
export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.json();

  let evt: WebhookEvent;
  try {
    evt = new Webhook(webhookSecret).verify(JSON.stringify(payload), {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as WebhookEvent;
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  switch (evt.type) {
    case "user.created":
    case "user.updated": {
      const { id, email_addresses, first_name, last_name } = evt.data;
      await upsertUser({
        clerkId: id,
        email: email_addresses[0]?.email_address ?? "",
        name: [first_name, last_name].filter(Boolean).join(" ") || null,
      });
      break;
    }
    case "user.deleted": {
      if (evt.data.id) {
        await deleteUserByClerkId(evt.data.id);
      }
      break;
    }
  }

  return new Response("OK", { status: 200 });
}