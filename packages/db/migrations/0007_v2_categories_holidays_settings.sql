-- v2 reference data. Everything here is editable by admins from the dashboard; the inserts are
-- idempotent so the migration can be re-applied to a database that already has them.

-- Expense categories (fixed and variable), in the order they are shown.
INSERT INTO "expense_categories" ("id", "name_ar", "name_en", "kind", "sort", "active") VALUES
  ('6a11213a-0372-4df2-b20b-f832913fdcaf', 'رواتب موظفي المبنى (حارس، نظافة، فني)', 'Building staff salaries (guard, cleaners, technician)', 'fixed', 0, true),
  ('a086f7f4-29f0-45cc-bf34-0f45c1a20484', 'كهرباء ومياه المناطق المشتركة (ديوا / سيوا)', 'Common-area electricity and water (DEWA / SEWA)', 'fixed', 10, true),
  ('5fd5aae8-9180-4679-9638-6afb1fb30eed', 'تبريد المناطق (تشيلر)', 'District cooling (chiller)', 'fixed', 20, true),
  ('d9ad525c-101a-4568-8cce-268d09d13b07', 'رسوم الخدمات / جمعية الملاك', 'Service charges / owners'' association', 'fixed', 30, true),
  ('30319050-3215-4e21-96f3-41e831214636', 'تأمين المبنى', 'Building insurance', 'fixed', 40, true),
  ('710b7681-9648-40f4-98dd-0b5694a3f0df', 'الأمن وكاميرات المراقبة', 'Security and CCTV', 'fixed', 50, true),
  ('be8d03e5-c211-4cee-8fe8-932bdc9e9a26', 'عقد صيانة المصاعد', 'Lift maintenance contract', 'fixed', 60, true),
  ('9e9ef9a3-5a5a-451e-a9cf-f24eabab340c', 'الإنترنت والإنتركم', 'Internet and intercom', 'fixed', 70, true),
  ('345cf971-f71c-4bac-8ffe-79007fde89ff', 'صيانة عامة', 'General maintenance', 'variable', 80, true),
  ('d5af8805-3ce6-47fd-8083-4dea6e05505b', 'أعطال وإصلاحات طارئة', 'Breakdowns and emergency repairs', 'variable', 90, true),
  ('ed5312b9-fab5-456b-8f13-5fd24cc90f83', 'سباكة', 'Plumbing', 'variable', 100, true),
  ('92a5eae1-509a-4ace-8fe1-62bd05cd6a1d', 'كهرباء', 'Electrical', 'variable', 110, true),
  ('08659d9d-88db-4f4e-91ed-af45b08d3add', 'تكييف', 'Air conditioning', 'variable', 120, true),
  ('3c03b4e4-f89a-4aaf-b375-104b574822ac', 'إصلاح المصاعد', 'Lifts (repairs)', 'variable', 130, true),
  ('6e2bc1d8-a9e2-48a5-9d42-71c29fbf8eac', 'دهان', 'Painting', 'variable', 140, true),
  ('f385d985-a5dc-43e6-aaa7-6500bf96bb8c', 'تنظيف عميق', 'Deep cleaning', 'variable', 150, true),
  ('db2d020e-9e58-4e8f-b45e-4d99b7948182', 'مكافحة الحشرات', 'Pest control', 'variable', 160, true),
  ('da260cdc-f8fd-4752-8ef2-472b4a706eb8', 'تجديد الوحدة قبل التأجير', 'Unit refurbishment before letting', 'variable', 170, true),
  ('ec61f533-7af1-4248-8d8e-04246cd26b57', 'رسوم قانونية ومحاكم', 'Legal and court fees', 'variable', 180, true),
  ('0b75f7fe-94b2-41b3-9329-0d9e1b39d23b', 'رسوم حكومية', 'Government fees', 'variable', 190, true),
  ('2e84a8f4-de16-4d2a-b9dc-920dd780e17e', 'أخرى', 'Other', 'variable', 200, true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- UAE public holidays 2026 and 2027. Dates of the religious holidays follow the Umm al-Qura
-- calendar and are marked tentative: the cabinet announces them after the moon sighting.
INSERT INTO "holidays" ("date", "name_ar", "name_en", "tentative") VALUES
  ('2026-01-01', 'رأس السنة الميلادية', 'New Year''s Day', false),
  ('2026-03-18', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2026-03-19', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2026-03-20', 'عيد الفطر', 'Eid Al Fitr', true),
  ('2026-03-21', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2026-03-22', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2026-05-26', 'يوم عرفة', 'Arafat Day', true),
  ('2026-05-27', 'عيد الأضحى', 'Eid Al Adha', true),
  ('2026-05-28', 'عطلة عيد الأضحى', 'Eid Al Adha holiday', true),
  ('2026-05-29', 'عطلة عيد الأضحى', 'Eid Al Adha holiday', true),
  ('2026-06-16', 'رأس السنة الهجرية', 'Islamic New Year', true),
  ('2026-08-25', 'المولد النبوي', 'Prophet Muhammad''s Birthday', true),
  ('2026-12-01', 'يوم الشهداء', 'Commemoration Day', true),
  ('2026-12-02', 'اليوم الوطني', 'National Day', false),
  ('2026-12-03', 'اليوم الوطني', 'National Day', false),
  ('2027-01-01', 'رأس السنة الميلادية', 'New Year''s Day', false),
  ('2027-03-08', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2027-03-09', 'عيد الفطر', 'Eid Al Fitr', true),
  ('2027-03-10', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2027-03-11', 'عطلة عيد الفطر', 'Eid Al Fitr holiday', true),
  ('2027-05-15', 'يوم عرفة', 'Arafat Day', true),
  ('2027-05-16', 'عيد الأضحى', 'Eid Al Adha', true),
  ('2027-05-17', 'عطلة عيد الأضحى', 'Eid Al Adha holiday', true),
  ('2027-05-18', 'عطلة عيد الأضحى', 'Eid Al Adha holiday', true),
  ('2027-06-06', 'رأس السنة الهجرية', 'Islamic New Year', true),
  ('2027-08-14', 'المولد النبوي', 'Prophet Muhammad''s Birthday', true),
  ('2027-12-01', 'يوم الشهداء', 'Commemoration Day', true),
  ('2027-12-02', 'اليوم الوطني', 'National Day', false),
  ('2027-12-03', 'اليوم الوطني', 'National Day', false)
ON CONFLICT ("date") DO NOTHING;--> statement-breakpoint

-- Settings and their defaults (packages/shared/src/settings.ts).
INSERT INTO "app_settings" ("key", "value") VALUES
  ('week_start', '"monday"'::jsonb),
  ('hijri_display', 'false'::jsonb),
  ('show_before_fee_label', 'true'::jsonb),
  ('large_expense_alert_fils', '500000'::jsonb),
  ('owners_see_invoice_files', 'true'::jsonb)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Backfill: a bounced-cheque case opened on a contract is about that contract's bounced cheques.
INSERT INTO "dispute_cheques" ("dispute_id", "cheque_id")
SELECT d."id", q."id"
FROM "disputes" d
JOIN "cheques" q ON q."contract_id" = d."contract_id"
WHERE d."type" = 'bounced_cheque' AND d."contract_id" IS NOT NULL AND q."status" IN ('bounced', 'replaced')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Allocations and status history are written once and never changed by the application.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories, vendors, recurring_expense_rules, expenses,
      expense_allocations, work_orders, calendar_events, holidays, app_settings, unit_status_events,
      dispute_cheques TO vamar_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON expense_allocations FROM vamar_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON unit_status_events FROM vamar_app;
  END IF;
END
$$;
