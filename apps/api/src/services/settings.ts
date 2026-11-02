/**
 * Application settings: one row per key in app_settings, parsed with the shared defaults so a
 * missing or malformed row never breaks a screen. Only admins change them; every change is audited.
 */
import { schema } from '@vamar/db';
import {
  APP_SETTING_KEYS,
  parseAppSettings,
  type AppSettings,
  type UpdateSettingsInput,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { audit, type AuditActor } from './audit.js';

const { appSettings } = schema;

export async function getSettings(db: Dbx): Promise<AppSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings);
  return parseAppSettings(rows);
}

export async function updateSettings(
  db: Dbx,
  actor: AuditActor,
  patch: UpdateSettingsInput,
): Promise<AppSettings> {
  const before = await getSettings(db);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
    keyof AppSettings,
    unknown,
  ][];
  for (const [name, value] of entries) {
    const key = APP_SETTING_KEYS[name];
    await db
      .insert(appSettings)
      .values({
        key,
        value,
        updatedBy: actor.type === 'staff' ? actor.id : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: actor.type === 'staff' ? actor.id : null, updatedAt: new Date() },
      });
  }
  const after = await getSettings(db);
  await audit(db, actor, {
    action: 'settings.update',
    entityType: 'settings',
    entityId: null,
    before,
    after,
  });
  return after;
}
