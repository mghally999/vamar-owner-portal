-- Large synthetic dataset for load tests (AUDIT.md section 6): 2,000 owners, 300 buildings,
-- 6,000 units, 12,000 contracts, 68,000 cheques and the rest. Deterministic ids. Run on a migrated,
-- empty database: psql "$DATABASE_URL" -f tooling/load/large-dataset.sql
\timing on
set synchronous_commit = off;
-- staff
insert into staff_users (id, firebase_uid, email, name, role, totp_enabled, totp_required, active)
values ('11111111-1111-1111-1111-111111111111','load-admin','admin@load.test','Load Admin','admin',false,false,true),
       ('22222222-2222-2222-2222-222222222222','load-entry','entry@load.test','Load Entry','editor',false,false,true);
-- owners: 2000, deterministic uuids
insert into owners (id, name_ar, name_en, phone_e164, email, preferred_lang, status, created_at)
select ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
       'مالك ' || i, 'Owner ' || i, '+9715' || lpad(i::text, 8, '0'),
       case when i % 3 = 0 then 'owner' || i || '@load.test' end,
       case when i % 4 = 0 then 'en' else 'ar' end::lang,
       case when i % 50 = 0 then 'disabled' when i % 7 = 0 then 'invited' else 'active' end::owner_status,
       now() - (i || ' hours')::interval
from generate_series(1, 2000) i;
-- buildings: 300
insert into buildings (id, name_ar, name_en, area, address, notes)
select ('00000000-0000-4000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
       'برج ' || i, 'Tower ' || i, (array['Deira','Bur Dubai','Marina','JLT','Sharjah','Ajman','Mamzar','Al Nahda'])[1 + i % 8],
       'Street ' || i || ', Dubai', ''
from generate_series(1, 300) i;
-- units: 20 per building = 6000
insert into units (id, building_id, unit_no, type, bedrooms, size_sqft, active)
select ('00000000-0000-4000-a000-' || lpad(to_hex(b * 100 + u), 12, '0'))::uuid,
       ('00000000-0000-4000-9000-' || lpad(to_hex(b), 12, '0'))::uuid,
       case when u <= 16 then ((u - 1) / 4 + 1)::text || lpad((u % 4 + 1)::text, 2, '0') else 'S' || (u - 16) end,
       case when u <= 16 then 'apartment' else 'shop' end::unit_type,
       case when u <= 16 then 1 + u % 3 end, 600 + (u * 37) % 900, true
from generate_series(1, 300) b, generate_series(1, 20) u;
-- ownerships: 70% single owner, 30% 60/40 split
insert into unit_ownerships (id, unit_id, owner_id, share_bp, from_date, to_date)
select gen_random_uuid(), u.id,
       ('00000000-0000-4000-8000-' || lpad(to_hex(1 + (n % 1999)), 12, '0'))::uuid,
       case when n % 10 < 7 then 10000 else 6000 end, date '2022-01-01', null
from (select id, row_number() over (order by id) n from units) u;
insert into unit_ownerships (id, unit_id, owner_id, share_bp, from_date, to_date)
select gen_random_uuid(), u.id,
       ('00000000-0000-4000-8000-' || lpad(to_hex(1 + ((n * 7) % 1999)), 12, '0'))::uuid,
       4000, date '2022-01-01', null
from (select id, row_number() over (order by id) n from units) u where n % 10 >= 7;
-- heavy owner #1: holds 150 units
update unit_ownerships set owner_id = '00000000-0000-4000-8000-000000000001'
where unit_id in (select id from units order by id limit 150) and share_bp = 10000;
-- tenants: 9000
insert into tenants (id, name, phone, email, company, notes)
select ('00000000-0000-4000-b000-' || lpad(to_hex(i), 12, '0'))::uuid, 'Tenant ' || i, '+9715' || lpad((5000000 + i)::text, 8, '0'),
       null, case when i % 5 = 0 then 'Company ' || i end, ''
from generate_series(1, 9000) i;
-- contracts: per unit one expired (2024) and one current (2025-26, 5% draft)
insert into contracts (id, unit_id, tenant_id, start_date, end_date, annual_rent_fils, cheque_count, status, notes, created_at)
select ('00000000-0000-4000-c000-' || lpad(to_hex(n * 10 + 1), 12, '0'))::uuid, u.id,
       ('00000000-0000-4000-b000-' || lpad(to_hex(1 + (n % 9000)), 12, '0'))::uuid,
       (date '2024-01-01' + ((n % 365) || ' days')::interval)::date, (date '2024-12-31' + ((n % 365) || ' days')::interval)::date,
       (40000 + (n % 90) * 1000) * 100, 4, 'expired', '', date '2023-12-15'
from (select id, row_number() over (order by id) n from units) u;
insert into contracts (id, unit_id, tenant_id, start_date, end_date, annual_rent_fils, cheque_count, status, notes, created_at)
select ('00000000-0000-4000-c000-' || lpad(to_hex(n * 10 + 2), 12, '0'))::uuid, u.id,
       ('00000000-0000-4000-b000-' || lpad(to_hex(1 + ((n + 3000) % 9000)), 12, '0'))::uuid,
       (date '2025-11-01' + ((n % 365) || ' days')::interval)::date, (date '2026-10-31' + ((n % 365) || ' days')::interval)::date,
       (42000 + (n % 90) * 1000) * 100, case when n % 3 = 0 then 12 when n % 3 = 1 then 6 else 4 end,
       case when n % 20 = 0 then 'draft' else 'active' end::contract_status, '', date '2025-10-15'
from (select id, row_number() over (order by id) n from units) u;
-- cheques
insert into cheques (id, contract_id, seq, due_date, amount_fils, cheque_no, bank_name, status, status_changed_at, deposited_at, cleared_at, bounced_at, bounce_reason)
select gen_random_uuid(), c.id, s, d.due,
       (c.annual_rent_fils / c.cheque_count), lpad((row_number() over ())::text, 6, '0'),
       (array['ENBD','ADCB','FAB','DIB','Mashreq','RAKBANK'])[1 + s % 6],
       st.status::cheque_status, now(),
       case when st.status in ('deposited','cleared','bounced') then now() - interval '20 days' end,
       case when st.status = 'cleared' then now() - interval '15 days' end,
       case when st.status = 'bounced' then now() - interval '15 days' end,
       case when st.status = 'bounced' then 'Insufficient funds' end
from contracts c
cross join lateral generate_series(1, c.cheque_count) s
cross join lateral (select (c.start_date + ((s - 1) * (12 / c.cheque_count) || ' months')::interval)::date as due) d
cross join lateral (select case
    when c.status = 'expired' then (case when s % 17 = 0 then 'bounced' else 'cleared' end)
    when d.due < current_date - 45 then (case when s % 23 = 0 then 'bounced' when s % 29 = 0 then 'replaced' else 'cleared' end)
    when d.due < current_date then 'deposited'
    else 'upcoming' end as status) st;
insert into cheque_events (id, cheque_id, from_status, to_status, note, actor_staff_id, at)
select gen_random_uuid(), id, 'upcoming', status, '', '22222222-2222-2222-2222-222222222222', status_changed_at from cheques where status <> 'upcoming';
-- disputes: 1500
insert into disputes (id, case_no, unit_id, contract_id, tenant_id, type, amount_claimed_fils, status, next_hearing_date, opened_at, notes)
select gen_random_uuid(), 'RDC-2026-' || lpad(n::text, 5, '0'), c.unit_id, c.id, c.tenant_id,
       (array['rent_arrears','bounced_cheque','eviction','damages','other'])[1 + n % 5]::dispute_type,
       (10000 + n * 100) * 100,
       (array['open','in_progress','hearing_scheduled','judgment_issued','closed'])[1 + n % 5]::dispute_status,
       case when n % 5 = 2 then current_date + (n % 60)::int end, now() - ((n % 300) || ' days')::interval, ''
from (select *, row_number() over (order by id) n from contracts where status = 'active') c where n <= 1500;
insert into dispute_counters values (2026, 1500);
insert into dispute_updates (id, dispute_id, note, visible_to_owner, actor_staff_id, at)
select gen_random_uuid(), d.id, 'Update ' || g, g % 2 = 0, '22222222-2222-2222-2222-222222222222', d.opened_at + (g || ' days')::interval
from disputes d cross join generate_series(1, 4) g;
-- audit log: 60,000 rows
insert into audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, ip, user_agent, at)
select gen_random_uuid(), 'staff', '22222222-2222-2222-2222-222222222222',
       (array['cheque.status','contract.create','contract.activate','owner.update','unit.owners'])[1 + i % 5],
       'cheque', q.id, '{"status":"upcoming"}', '{"status":"cleared"}', '10.0.0.' || (i % 250), 'load', now() - (i || ' minutes')::interval
from generate_series(1, 60000) i cross join lateral (select id from cheques offset (i % 1000) limit 1) q;
insert into devices (id, owner_id, device_id, platform, model, push_token, first_seen, last_seen)
select gen_random_uuid(), id, 'dev-' || id, 'android', 'Pixel 7', 'ExponentPushToken[load' || id || ']', now(), now() from owners where status = 'active';
insert into notification_log (id, owner_id, type, entity_id, dedupe_key, sent_at, result)
select gen_random_uuid(), o.id, 'cheque_due_soon', gen_random_uuid(), 'load:' || o.id || ':' || g, now() - (g || ' days')::interval, 'ok'
from owners o cross join generate_series(1, 10) g;
analyze;
select 'owners' t, count(*) from owners union all select 'buildings', count(*) from buildings union all select 'units', count(*) from units
union all select 'unit_ownerships', count(*) from unit_ownerships union all select 'contracts', count(*) from contracts union all select 'cheques', count(*) from cheques
union all select 'cheque_events', count(*) from cheque_events union all select 'disputes', count(*) from disputes union all select 'audit_log', count(*) from audit_log
union all select 'devices', count(*) from devices union all select 'notification_log', count(*) from notification_log;
select status, count(*) from cheques group by 1 order by 1;
select pg_size_pretty(pg_database_size('vamar_load'));
