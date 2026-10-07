CREATE TYPE "public"."attachment_entity_type" AS ENUM('cheque', 'dispute', 'contract', 'unit');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'owner', 'system');--> statement-breakpoint
CREATE TYPE "public"."cheque_status" AS ENUM('upcoming', 'deposited', 'cleared', 'bounced', 'replaced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'expired', 'terminated', 'renewed');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'in_progress', 'hearing_scheduled', 'judgment_issued', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('rent_arrears', 'bounced_cheque', 'eviction', 'damages', 'other');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('validating', 'ready', 'committing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('cheque_due_soon', 'cheque_bounced', 'contract_ending_60', 'contract_ending_30', 'new_device_login');--> statement-breakpoint
CREATE TYPE "public"."owner_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('apartment', 'villa', 'shop', 'office', 'warehouse', 'other');--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" DEFAULT 'viewer' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_failures" integer DEFAULT 0 NOT NULL,
	"totp_locked_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_firebaseUid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"platform" "device_platform" NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"push_token" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	CONSTRAINT "notification_log_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"preferred_lang" "lang" DEFAULT 'ar' NOT NULL,
	"status" "owner_status" DEFAULT 'invited' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"device_id" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_from" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"area" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"company" text,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_ownerships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"share_bp" integer NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	CONSTRAINT "unit_ownerships_share_bp_range" CHECK ("unit_ownerships"."share_bp" BETWEEN 1 AND 10000),
	CONSTRAINT "unit_ownerships_dates_order" CHECK ("unit_ownerships"."to_date" IS NULL OR "unit_ownerships"."to_date" >= "unit_ownerships"."from_date")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_no" text NOT NULL,
	"type" "unit_type" NOT NULL,
	"bedrooms" integer,
	"size_sqft" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cheque_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cheque_id" uuid NOT NULL,
	"from_status" "cheque_status",
	"to_status" "cheque_status" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_staff_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cheques" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_fils" bigint,
	"cheque_no" text,
	"bank_name" text,
	"status" "cheque_status" DEFAULT 'upcoming' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deposited_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"bounce_reason" text,
	"replaces_cheque_id" uuid,
	"image_key" text,
	CONSTRAINT "cheques_amount_positive" CHECK ("cheques"."amount_fils" IS NULL OR "cheques"."amount_fils" > 0),
	CONSTRAINT "cheques_seq_range" CHECK ("cheques"."seq" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"annual_rent_fils" bigint NOT NULL,
	"cheque_count" integer NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"previous_contract_id" uuid,
	"ejari_no" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_dates_order" CHECK ("contracts"."end_date" >= "contracts"."start_date"),
	CONSTRAINT "contracts_cheque_count_range" CHECK ("contracts"."cheque_count" BETWEEN 1 AND 12),
	CONSTRAINT "contracts_annual_rent_positive" CHECK ("contracts"."annual_rent_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" "attachment_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_r2Key_unique" UNIQUE("r2_key"),
	CONSTRAINT "attachments_size_limit" CHECK ("attachments"."size_bytes" > 0 AND "attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "dispute_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispute_id" uuid NOT NULL,
	"note" text NOT NULL,
	"visible_to_owner" boolean DEFAULT false NOT NULL,
	"actor_staff_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_no" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"contract_id" uuid,
	"tenant_id" uuid,
	"type" "dispute_type" NOT NULL,
	"amount_claimed_fils" bigint,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"next_hearing_date" date,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	CONSTRAINT "disputes_caseNo_unique" UNIQUE("case_no"),
	CONSTRAINT "disputes_amount_non_negative" CHECK ("disputes"."amount_claimed_fils" IS NULL OR "disputes"."amount_claimed_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_failed" integer DEFAULT 0 NOT NULL,
	"status" "import_status" DEFAULT 'validating' NOT NULL,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_replaces_cheque_id_cheques_id_fk" FOREIGN KEY ("replaces_cheque_id") REFERENCES "public"."cheques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_contract_id_contracts_id_fk" FOREIGN KEY ("previous_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_staff_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_updates" ADD CONSTRAINT "dispute_updates_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_updates" ADD CONSTRAINT "dispute_updates_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_users_active_idx" ON "staff_users" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_owner_device_uq" ON "devices" USING btree ("owner_id","device_id");--> statement-breakpoint
CREATE INDEX "devices_owner_idx" ON "devices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "notification_log_owner_idx" ON "notification_log" USING btree ("owner_id","sent_at");--> statement-breakpoint
CREATE INDEX "owners_status_idx" ON "owners" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_subject_idx" ON "sessions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "unit_ownerships_owner_idx" ON "unit_ownerships" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "unit_ownerships_unit_idx" ON "unit_ownerships" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_building_unit_no_uq" ON "units" USING btree ("building_id","unit_no");--> statement-breakpoint
CREATE INDEX "units_building_idx" ON "units" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "cheque_events_cheque_idx" ON "cheque_events" USING btree ("cheque_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "cheques_contract_seq_uq" ON "cheques" USING btree ("contract_id","seq");--> statement-breakpoint
CREATE INDEX "cheques_due_date_idx" ON "cheques" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "cheques_contract_idx" ON "cheques" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "cheques_pending_due_date_idx" ON "cheques" USING btree ("due_date") WHERE "cheques"."status" IN ('upcoming', 'deposited');--> statement-breakpoint
CREATE INDEX "contracts_unit_status_idx" ON "contracts" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "contracts_active_end_date_idx" ON "contracts" USING btree ("end_date") WHERE "contracts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "contracts_tenant_idx" ON "contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "dispute_updates_dispute_idx" ON "dispute_updates" USING btree ("dispute_id","at");--> statement-breakpoint
CREATE INDEX "disputes_unit_status_idx" ON "disputes" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_type","actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");