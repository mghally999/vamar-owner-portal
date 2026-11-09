-- v2 part of the large synthetic dataset: 200 vendors, 600 recurring rules, 200,000 posted expenses
-- with their owner allocations, 20,000 work orders and 6,000 calendar events in the current month.
-- Run after large-dataset.sql on a database migrated to 0006 or later:
--   psql "$DATABASE_URL" -f tooling/load/large-dataset-v2.sql
\timing on
set synchronous_commit = off;
-- v2: vendors, recurring rules, 200,000 posted expenses with their allocations, work orders, events
insert into vendors (id, name, phone, email, trn, notes, active)
select ('00000000-0000-4000-d000-' || lpad(to_hex(i), 12, '0'))::uuid, 'Vendor ' || i, '+9714' || lpad(i::text, 7, '0'), null,
       case when i % 2 = 0 then lpad((100000000000000 + i)::text, 15, '0') end, '', true
from generate_series(1, 200) i;
create temp table cats as select id, kind, row_number() over (order by kind, sort) n from expense_categories;
-- recurring rules: two per building (salaries, utilities)
insert into recurring_expense_rules (id, scope, building_id, unit_id, category_id, vendor_id, reason_ar, reason_en, amount_fils, vat_fils, frequency, day_of_month, start_date, end_date, allocation_method, visible_to_owner, active, created_by)
select gen_random_uuid(), 'building', b.id, null, k.id, null, 'مصروف ثابت', 'Fixed cost', (3000 + (r * 700)) * 100, 0, 'monthly', 1 + r * 14, date '2025-01-01', null, 'by_area', true, true, '22222222-2222-2222-2222-222222222222'
from buildings b cross join generate_series(0, 1) r join cats k on k.n = 1 + r;
-- expenses: 200,000 over the last 24 months; 80 % on a unit, 20 % on a building; deterministic ids
insert into expenses (id, scope, building_id, unit_id, category_id, kind, vendor_id, reason_ar, reason_en, invoice_no, invoice_date,
                      amount_fils, vat_fils, total_fils, paid_on, payment_method, status, allocation_method, visible_to_owner, created_by, created_at, posted_at, posted_by)
select ('00000000-0000-4000-e000-' || lpad(to_hex(i), 12, '0'))::uuid,
       case when i % 5 = 0 then 'building' else 'unit' end::expense_scope,
       ('00000000-0000-4000-9000-' || lpad(to_hex(1 + i % 300), 12, '0'))::uuid,
       case when i % 5 = 0 then null else ('00000000-0000-4000-a000-' || lpad(to_hex((1 + i % 300) * 100 + 1 + (i / 300) % 20), 12, '0'))::uuid end,
       k.id, k.kind,
       case when i % 3 = 0 then null else ('00000000-0000-4000-d000-' || lpad(to_hex(1 + i % 200), 12, '0'))::uuid end,
       'مصروف ' || i, 'Expense ' || i, 'INV-' || i, d.day,
       a.amt, a.vat, a.amt + a.vat, d.day + 7, 'transfer', 'posted',
       case when i % 5 = 0 then 'by_area' else 'single_unit' end::allocation_method, i % 50 <> 0,
       '22222222-2222-2222-2222-222222222222', d.day, d.day, '22222222-2222-2222-2222-222222222222'
from generate_series(1, 200000) i
join cats k on k.n = 1 + i % 21
cross join lateral (select (current_date - ((i * 7) % 730))::date as day) d
cross join lateral (select ((500 + (i % 400) * 25) * 100)::bigint as amt, case when i % 3 = 0 or i % 6 = 1 then 0 else ((500 + (i % 400) * 25) * 5)::bigint end as vat) a;
-- allocations: the owners' shares (unit expenses by share; building expenses equally per unit then by share)
insert into expense_allocations (id, expense_id, unit_id, owner_id, amount_fils, on_date)
select gen_random_uuid(), x.id, x.unit_id, uo.owner_id, (x.total_fils * uo.share_bp / 10000)::bigint, x.invoice_date
from expenses x join unit_ownerships uo on uo.unit_id = x.unit_id and uo.to_date is null where x.scope = 'unit';
insert into expense_allocations (id, expense_id, unit_id, owner_id, amount_fils, on_date)
select gen_random_uuid(), x.id, u.id, uo.owner_id, (x.total_fils / 20 * uo.share_bp / 10000)::bigint, x.invoice_date
from expenses x join units u on u.building_id = x.building_id join unit_ownerships uo on uo.unit_id = u.id and uo.to_date is null where x.scope = 'building';
-- work orders: 20,000, a tenth scheduled ahead
insert into work_orders (id, building_id, unit_id, title_ar, title_en, description, priority, status, reported_on, scheduled_for, completed_at, vendor_id, expense_id, visible_to_owner, created_by)
select gen_random_uuid(), ('00000000-0000-4000-9000-' || lpad(to_hex(1 + i % 300), 12, '0'))::uuid,
       case when i % 4 = 0 then null else ('00000000-0000-4000-a000-' || lpad(to_hex((1 + i % 300) * 100 + 1 + i % 20), 12, '0'))::uuid end,
       'صيانة ' || i, 'Maintenance ' || i, '', (array['low','normal','urgent'])[1 + i % 3]::work_order_priority,
       (array['open','scheduled','in_progress','done','cancelled'])[1 + i % 5]::work_order_status,
       (current_date - (i % 400))::date, case when i % 5 = 1 then (current_date + (i % 45))::date end,
       case when i % 5 = 3 then now() - ((i % 400) || ' days')::interval end,
       null, case when i % 5 = 3 then ('00000000-0000-4000-e000-' || lpad(to_hex(i), 12, '0'))::uuid end, true, '22222222-2222-2222-2222-222222222222'
from generate_series(1, 20000) i;
-- calendar events: 6,000 in the current month, a busy month for the dashboard calendar
insert into calendar_events (id, title_ar, title_en, starts_at, ends_at, all_day, type, building_id, unit_id, owner_id, visible_to_owner, notes, created_by)
select gen_random_uuid(), 'موعد ' || i, 'Event ' || i,
       date_trunc('month', now()) + ((i % 28) || ' days')::interval + ((8 + i % 9) || ' hours')::interval,
       date_trunc('month', now()) + ((i % 28) || ' days')::interval + ((9 + i % 9) || ' hours')::interval,
       false, (array['inspection','meeting','handover','reminder','other'])[1 + i % 5]::calendar_event_type,
       ('00000000-0000-4000-9000-' || lpad(to_hex(1 + i % 300), 12, '0'))::uuid, null, null, i % 2 = 0, '', '22222222-2222-2222-2222-222222222222'
from generate_series(1, 6000) i;
drop table cats;
analyze;
select 'expenses' t, count(*) from expenses union all select 'expense_allocations', count(*) from expense_allocations
union all select 'work_orders', count(*) from work_orders union all select 'calendar_events', count(*) from calendar_events;
