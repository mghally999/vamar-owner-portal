-- v2: expenses, allocations, recurring rules, work orders, property records, dispute cheques,
-- calendar events, holidays and settings. Migrations 0003 to 0005 were written by hand without
-- snapshots, so the statements they already applied were removed from this generated file.
CREATE TYPE "public"."allocation_method" AS ENUM('by_ownership', 'equal_units', 'by_area', 'single_unit');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_type" AS ENUM('inspection', 'meeting', 'handover', 'reminder', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_kind" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TYPE "public"."expense_scope" AS ENUM('building', 'unit');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'posted', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'cheque', 'transfer', 'card');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('occupied', 'vacant_ready', 'under_maintenance', 'reserved', 'not_available');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('low', 'normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('open', 'scheduled', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."attachment_entity_type" ADD VALUE IF NOT EXISTS 'expense';--> statement-breakpoint
ALTER TYPE "public"."attachment_entity_type" ADD VALUE IF NOT EXISTS 'work_order';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'monthly_summary';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'hearing_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'work_order_done';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'large_expense';--> statement-breakpoint
CREATE TABLE "unit_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"from_status" "unit_status",
	"to_status" "unit_status" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor_staff_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_cheques" (
	"dispute_id" uuid NOT NULL,
	"cheque_id" uuid NOT NULL,
	CONSTRAINT "dispute_cheques_dispute_id_cheque_id_pk" PRIMARY KEY("dispute_id","cheque_id")
);
--> statement-breakpoint
CREATE TABLE "expense_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"amount_fils" bigint NOT NULL,
	"on_date" date NOT NULL,
	CONSTRAINT "expense_allocations_amount_non_negative" CHECK ("expense_allocations"."amount_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" "expense_kind" NOT NULL,
	"parent_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "expense_scope" NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"category_id" uuid NOT NULL,
	"kind" "expense_kind" NOT NULL,
	"vendor_id" uuid,
	"reason_ar" text NOT NULL,
	"reason_en" text NOT NULL,
	"invoice_no" text,
	"invoice_date" date NOT NULL,
	"covers_from" date,
	"covers_to" date,
	"amount_fils" bigint NOT NULL,
	"vat_fils" bigint DEFAULT 0 NOT NULL,
	"total_fils" bigint NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"status" "expense_status" DEFAULT 'draft' NOT NULL,
	"void_reason" text,
	"allocation_method" "allocation_method" NOT NULL,
	"visible_to_owner" boolean DEFAULT true NOT NULL,
	"recurring_rule_id" uuid,
	"dispute_id" uuid,
	"corrects_expense_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_fils" > 0),
	CONSTRAINT "expenses_vat_non_negative" CHECK ("expenses"."vat_fils" >= 0),
	CONSTRAINT "expenses_total_is_sum" CHECK ("expenses"."total_fils" = "expenses"."amount_fils" + "expenses"."vat_fils"),
	CONSTRAINT "expenses_scope_unit" CHECK ("expenses"."scope" = 'building' OR "expenses"."unit_id" IS NOT NULL),
	CONSTRAINT "expenses_covers_order" CHECK ("expenses"."covers_from" IS NULL OR "expenses"."covers_to" IS NULL OR "expenses"."covers_to" >= "expenses"."covers_from")
);
--> statement-breakpoint
CREATE TABLE "recurring_expense_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "expense_scope" NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"reason_ar" text NOT NULL,
	"reason_en" text NOT NULL,
	"amount_fils" bigint NOT NULL,
	"vat_fils" bigint DEFAULT 0 NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"day_of_month" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"allocation_method" "allocation_method" NOT NULL,
	"visible_to_owner" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_day_range" CHECK ("recurring_expense_rules"."day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_rules_amount_positive" CHECK ("recurring_expense_rules"."amount_fils" > 0),
	CONSTRAINT "recurring_rules_vat_non_negative" CHECK ("recurring_expense_rules"."vat_fils" >= 0),
	CONSTRAINT "recurring_rules_scope_unit" CHECK ("recurring_expense_rules"."scope" = 'building' OR "recurring_expense_rules"."unit_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"trn" text,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "work_order_priority" DEFAULT 'normal' NOT NULL,
	"status" "work_order_status" DEFAULT 'open' NOT NULL,
	"reported_on" date NOT NULL,
	"scheduled_for" date,
	"completed_at" timestamp with time zone,
	"vendor_id" uuid,
	"expense_id" uuid,
	"visible_to_owner" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"type" "calendar_event_type" DEFAULT 'other' NOT NULL,
	"building_id" uuid,
	"unit_id" uuid,
	"owner_id" uuid,
	"visible_to_owner" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_order" CHECK ("calendar_events"."ends_at" >= "calendar_events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"tentative" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "plot_no" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "makani_no" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "title_deed_no" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "completion_year" integer;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "floors_count" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "status" "unit_status" DEFAULT 'vacant_ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "title_deed_no" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "plot_no" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "makani_no" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "dewa_premise_no" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "municipality_no" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "handover_date" date;--> statement-breakpoint
ALTER TABLE "unit_status_events" ADD CONSTRAINT "unit_status_events_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_status_events" ADD CONSTRAINT "unit_status_events_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_cheques" ADD CONSTRAINT "dispute_cheques_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_cheques" ADD CONSTRAINT "dispute_cheques_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_parent_id_expense_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_rule_id_recurring_expense_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_expense_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_corrects_expense_id_expenses_id_fk" FOREIGN KEY ("corrects_expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_posted_by_staff_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_staff_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_rules" ADD CONSTRAINT "recurring_expense_rules_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_rules" ADD CONSTRAINT "recurring_expense_rules_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_rules" ADD CONSTRAINT "recurring_expense_rules_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_rules" ADD CONSTRAINT "recurring_expense_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_rules" ADD CONSTRAINT "recurring_expense_rules_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_status_events_unit_idx" ON "unit_status_events" USING btree ("unit_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dispute_cheques_cheque_idx" ON "dispute_cheques" USING btree ("cheque_id");--> statement-breakpoint
CREATE INDEX "expense_allocations_owner_date_idx" ON "expense_allocations" USING btree ("owner_id","on_date");--> statement-breakpoint
CREATE INDEX "expense_allocations_expense_idx" ON "expense_allocations" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "expense_allocations_unit_date_idx" ON "expense_allocations" USING btree ("unit_id","on_date");--> statement-breakpoint
CREATE INDEX "expense_categories_kind_sort_idx" ON "expense_categories" USING btree ("kind","sort");--> statement-breakpoint
CREATE INDEX "expenses_building_date_idx" ON "expenses" USING btree ("building_id","invoice_date");--> statement-breakpoint
CREATE INDEX "expenses_unit_date_idx" ON "expenses" USING btree ("unit_id","invoice_date") WHERE "expenses"."unit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_status_date_idx" ON "expenses" USING btree ("status","invoice_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_category_date_idx" ON "expenses" USING btree ("category_id","invoice_date");--> statement-breakpoint
CREATE INDEX "expenses_vendor_invoice_idx" ON "expenses" USING btree ("vendor_id","invoice_no") WHERE "expenses"."invoice_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_rule_date_idx" ON "expenses" USING btree ("recurring_rule_id","invoice_date") WHERE "expenses"."recurring_rule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_dispute_idx" ON "expenses" USING btree ("dispute_id") WHERE "expenses"."dispute_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recurring_rules_active_idx" ON "recurring_expense_rules" USING btree ("active","start_date");--> statement-breakpoint
CREATE INDEX "recurring_rules_building_idx" ON "recurring_expense_rules" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "vendors_name_idx" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "work_orders_unit_status_idx" ON "work_orders" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_building_status_idx" ON "work_orders" USING btree ("building_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_scheduled_idx" ON "work_orders" USING btree ("scheduled_for") WHERE "work_orders"."scheduled_for" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_orders_reported_idx" ON "work_orders" USING btree ("reported_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calendar_events_starts_idx" ON "calendar_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_unit_idx" ON "calendar_events" USING btree ("unit_id","starts_at") WHERE "calendar_events"."unit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_events_owner_idx" ON "calendar_events" USING btree ("owner_id","starts_at") WHERE "calendar_events"."owner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "units_title_deed_idx" ON "units" USING btree ("title_deed_no");--> statement-breakpoint
CREATE INDEX "units_makani_idx" ON "units" USING btree ("makani_no");--> statement-breakpoint
CREATE INDEX "disputes_hearing_idx" ON "disputes" USING btree ("next_hearing_date") WHERE "disputes"."next_hearing_date" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_status_manual" CHECK ("units"."status" <> 'occupied');