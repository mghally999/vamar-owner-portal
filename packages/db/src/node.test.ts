import { describe, expect, it } from 'vitest';
import { createNodeDb } from './node.js';

describe('createNodeDb', () => {
  it('survives a dropped idle connection instead of crashing the script', async () => {
    // No connection is opened until the first query, so a bogus address is fine here.
    const { pool } = createNodeDb('postgres://u:p@127.0.0.1:1/x');
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool.emit('error', new Error('read ECONNRESET'))).not.toThrow();
    await pool.end();
  });
});
