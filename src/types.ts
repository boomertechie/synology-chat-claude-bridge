/**
 * Synology Chat Executor - Type Definitions
 */

export interface ExecuteRequest {
  session_id: string;
  claude_session_id?: string;
  prompt: string;
  user_name: string;
  callback_url?: string;
}

export interface ExecuteResponse {
  success: boolean;
  session_id: string;
  claude_session_id?: string;
  result?: string;
  error?: string;
}

export interface ContextState {
  estimated_tokens: number;
  needs_summarization: boolean;
  conversation_summary?: string;
  last_summarization?: string;
  chunk_count?: number;
}

export interface SessionData {
  session_id: string;
  claude_session_id?: string;
  user_name: string;
  created_at: string;
  last_activity: string;
  message_count: number;
  context_state?: ContextState;
}

export interface QueuedRequest {
  id: string;
  request: ExecuteRequest;
  resolve: (value: ExecuteResponse) => void;
  reject: (error: Error) => void;
  timestamp: number;
}
