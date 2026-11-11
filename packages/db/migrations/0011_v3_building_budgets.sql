ALTER TYPE "public"."notification_type" ADD VALUE 'budget_threshold';--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"category_id" uuid,
	"amount_fils" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_amount_positive" CHECK ("budgets"."amount_fils" > 0),
	CONSTRAINT "budgets_year_range" CHECK ("budgets"."year" BETWEEN 2020 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_building_year_category_uq" ON "budgets" USING btree ("building_id","year","category_id") WHERE "budgets"."category_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_building_year_total_uq" ON "budgets" USING btree ("building_id","year") WHERE "budgets"."category_id" IS NULL;--> statement-breakpoint

-- The runtime role reads budgets for the screens and alerts; admins add, change and remove them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON budgets TO vamar_app;
  END IF;
END
$$;
