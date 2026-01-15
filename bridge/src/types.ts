/**
 * Synology Chat Bridge - Type Definitions
 */

// Synology Chat Outgoing Webhook Payload
export interface SynologyWebhookPayload {
  text: string;
  user_id: string | number;
  user_name: string;
  channel_id: string | number;
  channel_name?: string;
  timestamp?: number;
  token?: string;
}

// Session stored in SQLite
export interface BridgeSession {
  id: string; // channel_id + "_" + user_id
  claude_session_id: string | null;
  last_activity: number; // Unix timestamp ms
  message_count: number;
  status: 'active' | 'stale' | 'archived';
}

// Request to Executor
export interface ExecutorRequest {
  session_id: string;
  claude_session_id?: string;
  prompt: string;
  user_name: string;
}

// Response from Executor
export interface ExecutorResponse {
  success: boolean;
  session_id: string;
  claude_session_id?: string;
  result?: string;
  error?: string;
}
