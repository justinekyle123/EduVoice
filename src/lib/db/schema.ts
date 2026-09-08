import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Starter schema — expand with the EduVoice models as features are built
// (study sessions, quiz results, tasks, flashcards, documents, ...).

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});