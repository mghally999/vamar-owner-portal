CREATE TABLE "push_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "attempts" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_notification_id_notification_log_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_tickets_created_idx" ON "push_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_log_retry_idx" ON "notification_log" USING btree ("next_attempt_at") WHERE "notification_log"."result" LIKE 'failed:%';--> statement-breakpoint
-- push_tickets is written, read and deleted by the API (receipts are removed once read).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON push_tickets TO vamar_app;
  END IF;
END
$$;
