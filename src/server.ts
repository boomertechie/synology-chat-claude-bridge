/**
 * Synology Chat Executor - Main HTTP Server
 *
 * Receives requests from the Synology Bridge and executes Claude Code.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { sessionManager } from './session-manager';
import { requestQueue } from './queue';
import { ContextManager } from './context-manager';
import type { ExecuteRequest, ExecuteResponse } from './types';

const app = new Hono();

// Auth token validation
const AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN;

function validateAuth(authHeader: string | undefined): boolean {
  if (!AUTH_TOKEN) {
    console.warn('WARNING: No BRIDGE_AUTH_TOKEN set - auth disabled');
    return true;
  }
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return token === AUTH_TOKEN;
}

// Middleware
app.use('*', logger());

// Health check
app.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    queue: {
      active: requestQueue.activeCount,
      pending: requestQueue.pendingCount,
    },
    sessions: sessionManager.count(),
    uptime: process.uptime(),
  });
});

// Execute Claude Code
app.post('/execute', async (c) => {
  // Validate auth
  if (!validateAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: ExecuteRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { session_id, claude_session_id, prompt, user_name } = body;

  if (!session_id || !prompt) {
    return c.json({ error: 'Missing required fields: session_id, prompt' }, 400);
  }

  console.log(`Execute request: session=${session_id}, user=${user_name}`);

  // Get or create session
  let session = await sessionManager.get(session_id);
  if (!session) {
    session = await sessionManager.create(session_id, user_name);
  }

  // If client provided a Claude session ID and session doesn't have one yet, use it
  if (claude_session_id && !session.claude_session_id) {
    session.claude_session_id = claude_session_id;
  }

  try {
    // Queue the execution using ContextManager
    const result = await requestQueue.add(async () => {
      return await ContextManager.execute({
        prompt,
        session,
        userName: user_name,
      });
    });

    // Update session with new Claude session ID and context state
    const updates: Partial<import('./types').SessionData> = {
      context_state: result.contextState,
    };

    if (result.sessionId) {
      updates.claude_session_id = result.sessionId;
    }

    await sessionManager.update(session_id, updates);
    await sessionManager.incrementMessageCount(session_id);

    const response: ExecuteResponse = {
      success: result.success,
      session_id,
      claude_session_id: result.sessionId,
      result: result.output,
      error: result.error,
    };

    console.log(`Execute complete: session=${session_id}, success=${result.success}, tokens=${result.contextState.estimated_tokens}`);
    return c.json(response);

  } catch (error) {
    console.error(`Execute error: session=${session_id}`, error);
    const response: ExecuteResponse = {
      success: false,
      session_id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
  }
});

// Reset session
app.post('/reset', async (c) => {
  if (!validateAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { session_id } = await c.req.json();
  if (!session_id) {
    return c.json({ error: 'Missing session_id' }, 400);
  }

  await sessionManager.delete(session_id);
  console.log(`Session reset: ${session_id}`);
  return c.json({ success: true, message: 'Session reset' });
});

// Get session status
app.get('/session/:id', async (c) => {
  if (!validateAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionId = c.req.param('id');
  const session = await sessionManager.get(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json(session);
});

// Cleanup expired sessions
app.post('/cleanup', async (c) => {
  if (!validateAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const cleaned = await sessionManager.cleanup();
  return c.json({ success: true, cleaned });
});

// Initialize and start
const PORT = parseInt(process.env.PORT || '3457', 10);

async function main() {
  await sessionManager.init();

  // Periodic cleanup every 10 minutes
  setInterval(async () => {
    const cleaned = await sessionManager.cleanup();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired sessions`);
    }
  }, 10 * 60 * 1000);

  console.log(`Synology Chat Executor listening on port ${PORT}`);
}

main().catch(console.error);

export default {
  port: PORT,
  fetch: app.fetch,
};
