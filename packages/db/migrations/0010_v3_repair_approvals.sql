CREATE TYPE "public"."repair_approval_status" AS ENUM('pending', 'approved', 'rejected', 'approved_by_silence');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'repair_approval_needed';--> statement-breakpoint
CREATE TABLE "repair_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_order_id" uuid,
	"expense_id" uuid,
	"owner_id" uuid NOT NULL,
	"amount_fils" bigint NOT NULL,
	"share_fils" bigint NOT NULL,
	"status" "repair_approval_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"asked_on" date NOT NULL,
	"answered_at" timestamp with time zone,
	"overridden_at" timestamp with time zone,
	"overridden_by" uuid,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_approvals_one_subject" CHECK (("repair_approvals"."work_order_id" IS NULL) <> ("repair_approvals"."expense_id" IS NULL)),
	CONSTRAINT "repair_approvals_amount_positive" CHECK ("repair_approvals"."amount_fils" > 0),
	CONSTRAINT "repair_approvals_share_non_negative" CHECK ("repair_approvals"."share_fils" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "estimate_fils" bigint;--> statement-breakpoint
ALTER TABLE "repair_approvals" ADD CONSTRAINT "repair_approvals_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_approvals" ADD CONSTRAINT "repair_approvals_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_approvals" ADD CONSTRAINT "repair_approvals_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_approvals" ADD CONSTRAINT "repair_approvals_overridden_by_staff_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_approvals_work_order_owner_uq" ON "repair_approvals" USING btree ("work_order_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_approvals_expense_owner_uq" ON "repair_approvals" USING btree ("expense_id","owner_id");--> statement-breakpoint
CREATE INDEX "repair_approvals_owner_idx" ON "repair_approvals" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "repair_approvals_pending_idx" ON "repair_approvals" USING btree ("asked_on") WHERE "repair_approvals"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_estimate_positive" CHECK ("work_orders"."estimate_fils" IS NULL OR "work_orders"."estimate_fils" > 0);--> statement-breakpoint

-- Settings and their defaults (packages/shared/src/settings.ts): owner approval of large repairs.
INSERT INTO "app_settings" ("key", "value") VALUES
  ('repair_approval_threshold_fils', '500000'::jsonb),
  ('repair_approval_silence_days', '3'::jsonb)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- The runtime role reads and answers approvals; rows go away only with a discarded draft.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON repair_approvals TO vamar_app;
  END IF;
END
$$;
