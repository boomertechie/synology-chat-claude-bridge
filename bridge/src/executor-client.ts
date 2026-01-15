/**
 * Executor Client - Communicate with Claude Code Executor
 */

import type { ExecutorRequest, ExecutorResponse } from './types';

const EXECUTOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ExecutorClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
  }

  /**
   * Execute a prompt via Claude Code
   */
  async execute(request: ExecutorRequest): Promise<ExecutorResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXECUTOR_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          session_id: request.session_id,
          error: `Executor error: ${response.status} - ${errorText}`,
        };
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          session_id: request.session_id,
          error: 'Request timeout (5 minutes)',
        };
      }

      return {
        success: false,
        session_id: request.session_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reset a session
   */
  async resetSession(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
