/**
 * Conversation History Summarization Utility
 *
 * Manages conversation context by summarizing older messages while preserving
 * recent context verbatim. Reduces token usage for long conversations.
 */

import { ContextEstimator } from './context-estimator';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface SummarizationResult {
  summary: string;
  recentMessages: Message[];
  originalTokens: number;
  reducedTokens: number;
}

/**
 * Default Claude runner for testing - returns simple summary
 */
const defaultClaudeRunner = async (messages: Message[]): Promise<string> => {
  const messageCount = messages.length;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  return `Conversation summary: ${messageCount} messages exchanged covering approximately ${totalChars} characters of discussion.`;
};

export class HistorySummarizer {
  private static readonly RECENT_MESSAGE_COUNT = 5;
  private static readonly MAX_SUMMARIZABLE_MESSAGES = 20;
  private static readonly MIN_MESSAGES_FOR_SUMMARIZATION = 6;

  /**
   * Summarize conversation history while preserving recent context
   *
   * Strategy:
   * - ≤5 messages: No summarization needed, return as-is
   * - 6-20 messages: Summarize messages 6-20 (oldest to 6th most recent), keep last 5
   * - >20 messages: Only summarize messages 6-20, discard older
   *
   * @param messages - Array of conversation messages
   * @param claudeRunner - Optional function to call Claude for summarization
   * @returns Summarization result with summary, recent messages, and token metrics
   */
  static async summarize(
    messages: Message[],
    claudeRunner?: (messages: Message[]) => Promise<string>
  ): Promise<SummarizationResult> {
    // Handle edge cases
    if (!messages || messages.length === 0) {
      return {
        summary: '',
        recentMessages: [],
        originalTokens: 0,
        reducedTokens: 0,
      };
    }

    // If ≤5 messages, no summarization needed
    if (messages.length <= this.RECENT_MESSAGE_COUNT) {
      const totalTokens = this.calculateTotalTokens(messages);
      return {
        summary: '',
        recentMessages: messages,
        originalTokens: totalTokens,
        reducedTokens: totalTokens,
      };
    }

    // Determine which messages to summarize
    const recentMessages = messages.slice(-this.RECENT_MESSAGE_COUNT);

    // For messages 6-20: take from oldest up to 6th most recent
    const messagesToSummarize = this.getMessagesToSummarize(messages);

    // Calculate original tokens
    const originalTokens = this.calculateTotalTokens(messages);

    // Generate summary using Claude or default runner
    const runner = claudeRunner || defaultClaudeRunner;
    const summary = await this.generateSummary(messagesToSummarize, runner);

    // Calculate reduced tokens (summary + recent messages)
    const summaryTokens = ContextEstimator.estimate(summary);
    const recentTokens = this.calculateTotalTokens(recentMessages);
    const reducedTokens = summaryTokens + recentTokens;

    return {
      summary,
      recentMessages,
      originalTokens,
      reducedTokens,
    };
  }

  /**
   * Get messages that should be summarized (messages 6-20 from most recent)
   */
  private static getMessagesToSummarize(messages: Message[]): Message[] {
    const totalMessages = messages.length;

    // If we have more than 20 messages, only summarize messages 6-20
    // (discard older messages beyond 20)
    if (totalMessages > this.MAX_SUMMARIZABLE_MESSAGES) {
      // Take messages from index (total - 20) to (total - 5)
      const startIndex = totalMessages - this.MAX_SUMMARIZABLE_MESSAGES;
      const endIndex = totalMessages - this.RECENT_MESSAGE_COUNT;
      return messages.slice(startIndex, endIndex);
    }

    // If we have 6-20 messages, summarize everything except last 5
    return messages.slice(0, -this.RECENT_MESSAGE_COUNT);
  }

  /**
   * Generate summary by calling Claude with appropriate prompt
   */
  private static async generateSummary(
    messages: Message[],
    claudeRunner: (messages: Message[]) => Promise<string>
  ): Promise<string> {
    if (messages.length === 0) {
      return '';
    }

    // Format messages for summarization
    const formattedMessages = messages
      .map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');

    // Call Claude with summarization prompt
    const prompt = `Summarize this conversation history concisely, preserving key context, decisions, and any code/technical details mentioned. Keep it under 500 words.

${formattedMessages}`;

    try {
      // Create a temporary message for Claude runner
      const summaryRequest: Message[] = [{
        role: 'user',
        content: prompt,
      }];

      return await claudeRunner(summaryRequest);
    } catch (error) {
      // If summarization fails, return basic fallback summary
      console.error('Failed to generate summary:', error);
      return `Previous conversation: ${messages.length} messages exchanged.`;
    }
  }

  /**
   * Calculate total tokens for an array of messages
   */
  private static calculateTotalTokens(messages: Message[]): number {
    return messages.reduce((total, msg) => {
      const contentTokens = ContextEstimator.estimate(msg.content);
      // Add small overhead for role and formatting (~10 tokens per message)
      return total + contentTokens + 10;
    }, 0);
  }

  /**
   * Calculate token reduction percentage
   */
  static calculateReduction(originalTokens: number, reducedTokens: number): number {
    if (originalTokens === 0) return 0;
    return Math.round((1 - reducedTokens / originalTokens) * 100);
  }
}
