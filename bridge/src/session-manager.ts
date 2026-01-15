/**
 * Bridge Session Manager - SQLite-backed session storage
 * Uses Bun's built-in SQLite (no native compilation needed)
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import type { BridgeSession } from './types';

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class BridgeSessionManager {
  private db: Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(DATA_DIR, 'sessions.sqlite');
    this.db = new Database(path);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        claude_session_id TEXT,
        last_activity INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      )
    `);

    // Create index for cleanup queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_last_activity ON sessions(last_activity)
    `);
  }

  get(sessionId: string): BridgeSession | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as BridgeSession | undefined;

    if (!row) return null;

    // Check if expired
    if (Date.now() - row.last_activity > SESSION_TIMEOUT_MS) {
      this.updateStatus(sessionId, 'stale');
      return null;
    }

    return row;
  }

  getOrCreate(sessionId: string): BridgeSession {
    const existing = this.get(sessionId);
    if (existing) return existing;

    const now = Date.now();
    // Use ON CONFLICT to handle stale sessions that still exist in DB
    this.db
      .prepare(
        `INSERT INTO sessions (id, claude_session_id, last_activity, message_count, status)
         VALUES (?, NULL, ?, 0, 'active')
         ON CONFLICT(id) DO UPDATE SET
           claude_session_id = NULL,
           last_activity = excluded.last_activity,
           message_count = 0,
           status = 'active'`
      )
      .run(sessionId, now);

    return {
      id: sessionId,
      claude_session_id: null,
      last_activity: now,
      message_count: 0,
      status: 'active',
    };
  }

  update(sessionId: string, claudeSessionId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE sessions
         SET claude_session_id = ?, last_activity = ?, message_count = message_count + 1, status = 'active'
         WHERE id = ?`
      )
      .run(claudeSessionId, now, sessionId);
  }

  touch(sessionId: string): void {
    this.db
      .prepare('UPDATE sessions SET last_activity = ? WHERE id = ?')
      .run(Date.now(), sessionId);
  }

  updateStatus(sessionId: string, status: 'active' | 'stale' | 'archived'): void {
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, sessionId);
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE status = ?').get('active') as {
      count: number;
    };
    return row.count;
  }

  cleanup(): number {
    const cutoff = Date.now() - SESSION_TIMEOUT_MS;

    // First mark as stale
    this.db.prepare("UPDATE sessions SET status = 'stale' WHERE last_activity < ? AND status = 'active'").run(cutoff);

    // Delete sessions stale for more than 24 hours
    const archiveCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const result = this.db.prepare("DELETE FROM sessions WHERE last_activity < ? AND status = 'stale'").run(archiveCutoff);

    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
