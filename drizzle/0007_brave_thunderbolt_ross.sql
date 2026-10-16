ALTER TABLE "tasks" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" text;--> statement-breakpoint
CREATE INDEX "tasks_due_reminder_idx" ON "tasks" USING btree ("completed","due_date","reminded_at");