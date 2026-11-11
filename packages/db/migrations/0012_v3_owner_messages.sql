CREATE TYPE "public"."message_link_type" AS ENUM('unit', 'cheque', 'expense', 'work_order', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."message_thread_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "public"."attachment_entity_type" ADD VALUE 'message';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'message_reply';--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"link_type" "message_link_type",
	"link_id" uuid,
	"subject" text NOT NULL,
	"status" "message_thread_status" DEFAULT 'open' NOT NULL,
	"assigned_staff_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sender_type" "subject_type" NOT NULL,
	"owner_last_read_at" timestamp with time zone,
	"staff_last_read_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_threads_link_whole" CHECK (("message_threads"."link_type" IS NULL) = ("message_threads"."link_id" IS NULL)),
	CONSTRAINT "message_threads_subject_length" CHECK (char_length("message_threads"."subject") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_type" "subject_type" NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_messages_body_length" CHECK (char_length("thread_messages"."body") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_assigned_staff_id_staff_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_threads_inbox_idx" ON "message_threads" USING btree ("status","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_threads_owner_idx" ON "message_threads" USING btree ("owner_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_threads_waiting_idx" ON "message_threads" USING btree ("last_message_at") WHERE "message_threads"."status" = 'open' AND "message_threads"."last_sender_type" = 'owner';--> statement-breakpoint
CREATE INDEX "thread_messages_thread_idx" ON "thread_messages" USING btree ("thread_id","created_at","id");--> statement-breakpoint

-- The runtime role starts threads, answers them and moves their status, assignee and read times;
-- messages are append-only, so what an owner was told stays on record.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT SELECT, INSERT, UPDATE ON message_threads TO vamar_app;
    REVOKE DELETE, TRUNCATE ON message_threads FROM vamar_app;
    GRANT SELECT, INSERT ON thread_messages TO vamar_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON thread_messages FROM vamar_app;
  END IF;
END
$$;
