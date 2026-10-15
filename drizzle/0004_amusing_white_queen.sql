CREATE TYPE "public"."room_quiz_status" AS ENUM('question', 'reveal', 'ended');--> statement-breakpoint
CREATE TABLE "room_quiz_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_index" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"response_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_quiz_responses_session_q_user" UNIQUE("session_id","question_index","user_id")
);
--> statement-breakpoint
CREATE TABLE "room_quiz_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"status" "room_quiz_status" DEFAULT 'question' NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"question_seconds" integer DEFAULT 30 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_quiz_responses" ADD CONSTRAINT "room_quiz_responses_session_id_room_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."room_quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_responses" ADD CONSTRAINT "room_quiz_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_sessions" ADD CONSTRAINT "room_quiz_sessions_room_id_study_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_sessions" ADD CONSTRAINT "room_quiz_sessions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_quiz_sessions" ADD CONSTRAINT "room_quiz_sessions_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_quiz_responses_session_idx" ON "room_quiz_responses" USING btree ("session_id","question_index");--> statement-breakpoint
CREATE INDEX "room_quiz_sessions_room_idx" ON "room_quiz_sessions" USING btree ("room_id","created_at");