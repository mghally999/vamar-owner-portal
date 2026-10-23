// Access tokens for the load runner, backed by real session rows (the API checks that the session
// behind every staff token and owner token is still active).
//
//   DATABASE_URL=... JWT_SECRET=... node tooling/load/tokens.mjs > tokens.json
//
// JWT_SECRET defaults to the local dev server's secret. Never point this at production: it writes
// sessions for the admin and up to 200 owners.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-only-change-me-dev-only-change-me-dev-only',
);
const TTL_S = 60 * 60 * 2;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const session = async (subjectType, subjectId) => {
    const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const { rows } = await client.query(
      `insert into sessions (id, subject_type, subject_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '2 hours') returning id`,
      [randomUUID(), subjectType, subjectId, hash],
    );
    return rows[0].id;
  };
  const sign = async (sub, claims) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt(now)
      .setExpirationTime(now + TTL_S)
      .setIssuer('vamar-owner-portal')
      .sign(secret);
  };

  const staff = (await client.query(`select id, role from staff_users where active order by role`))
    .rows;
  const admin = staff.find((s) => s.role === 'admin');
  const editor = staff.find((s) => s.role === 'editor') ?? admin;
  if (!admin) throw new Error('no active admin in this database');
  const staffToken = async (s) =>
    sign(s.id, { typ: 'staff', sid: await session('staff', s.id), role: s.role, mfa: true });

  // The owner with the most units first: the "heavy" owner of the scenarios.
  const owners = (
    await client.query(`
      select o.id from owners o left join unit_ownerships u on u.owner_id = o.id and u.to_date is null
      where o.status = 'active' group by o.id order by count(u.unit_id) desc, o.id limit 200`)
  ).rows;
  if (!owners.length) throw new Error('no active owners in this database');
  const ownerToken = async (o) => sign(o.id, { typ: 'owner', sid: await session('owner', o.id) });

  const out = {
    admin: await staffToken(admin),
    editor: await staffToken(editor),
    heavyOwner: await ownerToken(owners[0]),
    owners: [],
  };
  for (const o of owners) out.owners.push(await ownerToken(o));
  process.stdout.write(`${JSON.stringify(out)}\n`);
} finally {
  await client.end();
}
