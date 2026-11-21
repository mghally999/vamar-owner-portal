DROP INDEX "unit_status_events_unit_idx";--> statement-breakpoint
DROP INDEX "expenses_status_date_idx";--> statement-breakpoint
DROP INDEX "work_orders_reported_idx";--> statement-breakpoint
DROP INDEX "message_threads_inbox_idx";--> statement-breakpoint
DROP INDEX "message_threads_owner_idx";--> statement-breakpoint
CREATE INDEX "sessions_rotated_from_idx" ON "sessions" USING btree ("rotated_from") WHERE "sessions"."rotated_from" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_invoice_date_idx" ON "expenses" USING btree ("invoice_date" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "unit_status_events_unit_idx" ON "unit_status_events" USING btree ("unit_id","at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "expenses_status_date_idx" ON "expenses" USING btree ("status","invoice_date" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "work_orders_reported_idx" ON "work_orders" USING btree ("reported_on" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "message_threads_inbox_idx" ON "message_threads" USING btree ("status","last_message_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "message_threads_owner_idx" ON "message_threads" USING btree ("owner_id","last_message_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);