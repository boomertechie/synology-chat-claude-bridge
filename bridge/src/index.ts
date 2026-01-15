/**
 * Synology Chat Bridge - Main Server
 *
 * Receives webhooks from Synology Chat, forwards to Claude Code Executor,
 * and sends responses back to Synology Chat.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { SynologyClient } from './synology-client';
import { ExecutorClient } from './executor-client';
import { BridgeSessionManager } from './session-manager';
import { rateLimiter } from './rate-limiter';
import type { SynologyWebhookPayload } from './types';

// Configuration
const SYNOLOGY_WEBHOOK_URL = process.env.SYNOLOGY_WEBHOOK_URL;
const SYNOLOGY_WEBHOOK_TOKEN = process.env.SYNOLOGY_WEBHOOK_TOKEN;
const EXECUTOR_URL = process.env.EXECUTOR_URL || 'http://localhost:3457';
const EXECUTOR_AUTH_TOKEN = process.env.EXECUTOR_AUTH_TOKEN;
const PORT = parseInt(process.env.PORT || '3456', 10);

if (!SYNOLOGY_WEBHOOK_URL) {
  console.error('ERROR: SYNOLOGY_WEBHOOK_URL is required');
  process.exit(1);
}

if (!EXECUTOR_AUTH_TOKEN) {
  console.error('ERROR: EXECUTOR_AUTH_TOKEN is required');
  process.exit(1);
}

// Initialize clients
const synology = new SynologyClient(SYNOLOGY_WEBHOOK_URL);
const executor = new ExecutorClient(EXECUTOR_URL, EXECUTOR_AUTH_TOKEN);
const sessions = new BridgeSessionManager();

const app = new Hono();

// Middleware
app.use('*', logger());

// Health check
app.get('/health', async (c) => {
  const executorHealthy = await executor.isHealthy();
  return c.json({
    status: executorHealthy ? 'ok' : 'degraded',
    executor_reachable: executorHealthy,
    active_sessions: sessions.count(),
    uptime: process.uptime(),
  });
});

// Synology Chat webhook endpoint
app.post('/webhook', async (c) => {
  // Parse the incoming webhook
  let payload: SynologyWebhookPayload;

  try {
    // Synology sends form-urlencoded or JSON depending on configuration
    const contentType = c.req.header('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await c.req.parseBody();
      if (typeof formData.payload === 'string') {
        payload = JSON.parse(formData.payload);
      } else {
        payload = formData as unknown as SynologyWebhookPayload;
      }
    } else {
      payload = await c.req.json();
    }
  } catch (error) {
    console.error('Failed to parse webhook payload:', error);
    return c.json({ error: 'Invalid payload' }, 400);
  }

  // Validate webhook token if configured
  if (SYNOLOGY_WEBHOOK_TOKEN && payload.token !== SYNOLOGY_WEBHOOK_TOKEN) {
    console.warn('Invalid webhook token received');
    return c.json({ error: 'Invalid token' }, 401);
  }

  const userId = String(payload.user_id);
  const channelId = String(payload.channel_id);
  const userName = payload.user_name || 'Unknown';
  const text = (payload.text || '').trim();

  console.log(`Webhook received: user=${userName}, channel=${channelId}`);

  // Remove @claude mention and trim
  const command = text.replace(/@claude\s*/gi, '').trim();

  if (!command) {
    await synology.sendMessage('Hi! Send me a message after @claude to get started.');
    return c.json({ success: true });
  }

  // Check rate limits
  if (!rateLimiter.canProceed('global', 500)) {
    console.log('Global rate limit hit');
    return c.json({ success: true }); // Silently ignore
  }

  if (rateLimiter.isUserRateLimited(userId, 20)) {
    await synology.sendMessage('Please slow down - too many requests.');
    return c.json({ success: true });
  }

  rateLimiter.record('global');
  rateLimiter.record(userId);

  // Handle special commands
  const sessionId = `${channelId}_${userId}`;

  if (command.toLowerCase() === 'reset') {
    sessions.delete(sessionId);
    await executor.resetSession(sessionId);
    await synology.sendMessage('Session reset. Starting fresh!');
    return c.json({ success: true });
  }

  if (command.toLowerCase() === 'status') {
    const session = sessions.get(sessionId);
    if (session) {
      const duration = Math.round((Date.now() - session.last_activity) / 60000);
      await synology.sendMessage(
        `Session: ${session.message_count} messages, last active ${duration} minutes ago`
      );
    } else {
      await synology.sendMessage('No active session.');
    }
    return c.json({ success: true });
  }

  if (command.toLowerCase() === 'help') {
    await synology.sendMessage(`Claude Code Commands:
@claude <message> - Chat with Claude
@claude reset - Start a new session
@claude status - Show session info
@claude help - Show this help`);
    return c.json({ success: true });
  }

  // Get or create session
  const session = sessions.getOrCreate(sessionId);

  // Send processing indicator
  await synology.sendMessage('Thinking...');

  // Execute via Claude Code
  const result = await executor.execute({
    session_id: sessionId,
    claude_session_id: session.claude_session_id || undefined,
    prompt: command,
    user_name: userName,
  });

  if (result.success && result.result) {
    // Update session
    if (result.claude_session_id) {
      sessions.update(sessionId, result.claude_session_id);
    } else {
      sessions.touch(sessionId);
    }

    // Send response
    await synology.sendMessage(result.result);
  } else {
    const errorMsg = result.error || 'Something went wrong';
    await synology.sendMessage(`Error: ${errorMsg}`);
  }

  return c.json({ success: true });
});

// Periodic cleanup
setInterval(
  () => {
    const cleaned = sessions.cleanup();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired sessions`);
    }
  },
  10 * 60 * 1000
); // Every 10 minutes

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  sessions.close();
  process.exit(0);
});

// Start server explicitly (required for Docker - export default pattern doesn't keep process alive)
const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log(`Synology Chat Bridge listening on port ${server.port}`);
