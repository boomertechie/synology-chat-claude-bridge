/**
 * Context Window Estimation Utility
 *
 * Provides token estimation and context management for Claude sessions.
 * Uses conservative 4:1 character-to-token ratio for estimation.
 */

import type { SessionData } from '../types';

export const CONTEXT_SOFT_LIMIT = 120000; // tokens - triggers summarization
export const CONTEXT_HARD_LIMIT = 180000; // tokens - hard limit
export const CHARS_PER_TOKEN = 4; // conservative estimate (4 chars ≈ 1 token)

export class ContextEstimator {
  /**
   * Estimate token count from text using conservative 4:1 ratio
   * @param text - Input text to estimate
   * @returns Estimated token count
   */
  static estimate(text: string): number {
    if (!text) return 0;

    const charCount = text.length;
    return Math.ceil(charCount / CHARS_PER_TOKEN);
  }

  /**
   * Calculate total context usage for a session including new prompt
   * @param session - Session data with context state
   * @param newPrompt - New prompt to add to context
   * @returns Total estimated tokens
   */
  static calculateTotal(session: SessionData, newPrompt: string): number {
    const currentTokens = session.context_state?.estimated_tokens || 0;
    const newPromptTokens = this.estimate(newPrompt);

    return currentTokens + newPromptTokens;
  }

  /**
   * Check if summarization is needed based on soft limit
   * @param totalTokens - Total estimated tokens in context
   * @returns True if exceeds soft limit and summarization should be triggered
   */
  static needsSummarization(totalTokens: number): boolean {
    return totalTokens >= CONTEXT_SOFT_LIMIT;
  }

  /**
   * Check if hard limit is exceeded (should not accept new messages)
   * @param totalTokens - Total estimated tokens in context
   * @returns True if exceeds hard limit
   */
  static exceedsHardLimit(totalTokens: number): boolean {
    return totalTokens >= CONTEXT_HARD_LIMIT;
  }

  /**
   * Get context usage percentage for monitoring
   * @param totalTokens - Total estimated tokens in context
   * @returns Percentage of hard limit used (0-100+)
   */
  static getUsagePercentage(totalTokens: number): number {
    return Math.round((totalTokens / CONTEXT_HARD_LIMIT) * 100);
  }
}
