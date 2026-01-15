/**
 * Session Manager - Tracks Claude Code session continuity
 */

import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import type { SessionData } from './types';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const SESSIONS_DIR = join(PAI_DIR, 'integrations/synology-chat/sessions');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private cache: Map<string, SessionData> = new Map();

  async init(): Promise<void> {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    try {
      const files = await readdir(SESSIONS_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(SESSIONS_DIR, file), 'utf-8');
          const session = JSON.parse(data) as SessionData;
          this.cache.set(session.session_id, session);
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const session = this.cache.get(sessionId);
    if (!session) return null;

    // Check if session is expired
    const lastActivity = new Date(session.last_activity).getTime();
    if (Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  async create(sessionId: string, userName: string): Promise<SessionData> {
    const now = new Date().toISOString();
    const session: SessionData = {
      session_id: sessionId,
      user_name: userName,
      created_at: now,
      last_activity: now,
      message_count: 0,
    };

    await this.save(session);
    return session;
  }

  async update(sessionId: string, updates: Partial<SessionData>): Promise<SessionData | null> {
    const session = this.cache.get(sessionId);
    if (!session) return null;

    const updated = {
      ...session,
      ...updates,
      last_activity: new Date().toISOString(),
    };

    await this.save(updated);
    return updated;
  }

  async incrementMessageCount(sessionId: string): Promise<void> {
    const session = this.cache.get(sessionId);
    if (session) {
      session.message_count++;
      session.last_activity = new Date().toISOString();
      await this.save(session);
    }
  }

  private async save(session: SessionData): Promise<void> {
    this.cache.set(session.session_id, session);
    const filePath = join(SESSIONS_DIR, `${session.session_id}.json`);
    await writeFile(filePath, JSON.stringify(session, null, 2));
  }

  async delete(sessionId: string): Promise<void> {
    this.cache.delete(sessionId);
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
    try {
      await unlink(filePath);
    } catch {
      // File might not exist
    }
  }

  count(): number {
    return this.cache.size;
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.cache) {
      const lastActivity = new Date(session.last_activity).getTime();
      if (now - lastActivity > SESSION_TIMEOUT_MS) {
        await this.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

export const sessionManager = new SessionManager();
