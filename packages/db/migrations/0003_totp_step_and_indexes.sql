ALTER TABLE "staff_users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
CREATE INDEX "contracts_created_idx" ON "contracts" USING btree ("created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX "cheques_bounced_idx" ON "cheques" USING btree ("bounced_at" DESC) WHERE "cheques"."status" = 'bounced';--> statement-breakpoint
CREATE INDEX "disputes_opened_idx" ON "disputes" USING btree ("opened_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action", "at" DESC);
