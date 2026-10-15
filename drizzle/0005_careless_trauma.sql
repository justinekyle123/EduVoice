ALTER TYPE "public"."room_quiz_status" ADD VALUE 'lobby' BEFORE 'question';--> statement-breakpoint
CREATE TABLE "room_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_quiz_ready" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ready_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_quiz_ready_session_user" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "room_messages" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "room_files" ADD CONSTRAINT "room_files_room_id_study_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_files" ADD CONSTRAINT "room_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_ready" ADD CONSTRAINT "room_quiz_ready_session_id_room_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."room_quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_ready" ADD CONSTRAINT "room_quiz_ready_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_files_room_idx" ON "room_files" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_quiz_ready_session_idx" ON "room_quiz_ready" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_file_id_room_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."room_files"("id") ON DELETE set null ON UPDATE no action;