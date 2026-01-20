/**
 * Tests for History Summarizer
 */

import { describe, test, expect } from 'bun:test';
import { HistorySummarizer, type Message } from './history-summarizer';

/**
 * Helper: Create test messages
 */
function createMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: This is test message content with some reasonable length to simulate real conversation data.`,
      timestamp: new Date(Date.now() - (count - i) * 60000).toISOString(),
    });
  }
  return messages;
}

/**
 * Mock Claude runner for testing - returns concise summary
 */
async function mockClaudeRunner(messages: Message[]): Promise<string> {
  const content = messages[0]?.content || '';
  const messageCount = content.match(/Message \d+/g)?.length || 0;

  // Return a much shorter summary to ensure good token reduction
  return `Summary of ${messageCount} messages covering test topics.`;
}

describe('HistorySummarizer', () => {
  describe('Edge Cases', () => {
    test('handles empty message array', async () => {
      const result = await HistorySummarizer.summarize([]);

      expect(result.summary).toBe('');
      expect(result.recentMessages).toHaveLength(0);
      expect(result.originalTokens).toBe(0);
      expect(result.reducedTokens).toBe(0);
    });

    test('handles single message', async () => {
      const messages = createMessages(1);
      const result = await HistorySummarizer.summarize(messages);

      expect(result.summary).toBe('');
      expect(result.recentMessages).toHaveLength(1);
      expect(result.recentMessages[0].content).toBe(messages[0].content);
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.reducedTokens).toBe(result.originalTokens);
    });
  });

  describe('No Summarization Needed (≤5 messages)', () => {
    test('returns 3 messages as-is without summarization', async () => {
      const messages = createMessages(3);
      const result = await HistorySummarizer.summarize(messages);

      expect(result.summary).toBe('');
      expect(result.recentMessages).toHaveLength(3);
      expect(result.recentMessages).toEqual(messages);
      expect(result.originalTokens).toBe(result.reducedTokens);
    });

    test('returns 5 messages as-is without summarization', async () => {
      const messages = createMessages(5);
      const result = await HistorySummarizer.summarize(messages);

      expect(result.summary).toBe('');
      expect(result.recentMessages).toHaveLength(5);
      expect(result.recentMessages).toEqual(messages);
      expect(result.originalTokens).toBe(result.reducedTokens);
    });
  });

  describe('Basic Summarization (6-10 messages)', () => {
    test('summarizes 6 messages: keeps last 5, summarizes message 1', async () => {
      const messages = createMessages(6);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain('Summary');
      expect(result.recentMessages).toHaveLength(5);
      expect(result.recentMessages[0].content).toBe(messages[1].content); // 2nd message
      expect(result.recentMessages[4].content).toBe(messages[5].content); // Last message
      // With only 1 message summarized, reduction may be minimal
      expect(result.reducedTokens).toBeGreaterThan(0);
    });

    test('summarizes 10 messages: keeps last 5, summarizes messages 1-5', async () => {
      const messages = createMessages(10);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      expect(result.summary).toBeTruthy();
      expect(result.recentMessages).toHaveLength(5);
      expect(result.recentMessages[0].content).toBe(messages[5].content); // 6th message
      expect(result.recentMessages[4].content).toBe(messages[9].content); // Last message
      expect(result.originalTokens).toBeGreaterThan(result.reducedTokens);
    });
  });

  describe('Maximum Range (20 messages)', () => {
    test('summarizes 20 messages: keeps last 5, summarizes messages 1-15', async () => {
      const messages = createMessages(20);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      expect(result.summary).toBeTruthy();
      expect(result.recentMessages).toHaveLength(5);
      expect(result.recentMessages[0].content).toBe(messages[15].content); // 16th message
      expect(result.recentMessages[4].content).toBe(messages[19].content); // Last message
      expect(result.originalTokens).toBeGreaterThan(result.reducedTokens);
    });

    test('handles 25 messages: discards oldest 5, summarizes messages 6-20, keeps last 5', async () => {
      const messages = createMessages(25);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      expect(result.summary).toBeTruthy();
      expect(result.recentMessages).toHaveLength(5);
      expect(result.recentMessages[0].content).toBe(messages[20].content); // 21st message
      expect(result.recentMessages[4].content).toBe(messages[24].content); // Last message

      // Should only summarize 15 messages (messages 6-20 from end)
      // Original: 25 messages, Effective: 20 messages (summary covers 15, recent 5)
      expect(result.originalTokens).toBeGreaterThan(result.reducedTokens);
    });
  });

  describe('Token Reduction Validation', () => {
    test('achieves at least 60% token reduction for typical conversation', async () => {
      // Create 15 messages with realistic content
      const messages = createMessages(15);

      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      const reductionPercent = HistorySummarizer.calculateReduction(
        result.originalTokens,
        result.reducedTokens
      );

      expect(reductionPercent).toBeGreaterThanOrEqual(60);
      expect(result.reducedTokens).toBeLessThan(result.originalTokens);
    });

    test('achieves significant reduction for 20-message conversation', async () => {
      const messages = createMessages(20);

      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      const reductionPercent = HistorySummarizer.calculateReduction(
        result.originalTokens,
        result.reducedTokens
      );

      expect(reductionPercent).toBeGreaterThan(50); // Should be well over 50%
      expect(result.summary).toBeTruthy();
    });
  });

  describe('Message Preservation', () => {
    test('preserves last 5 messages exactly', async () => {
      const messages = createMessages(12);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      const expectedRecent = messages.slice(-5);
      expect(result.recentMessages).toEqual(expectedRecent);
    });

    test('preserves message metadata (role, timestamp)', async () => {
      const messages = createMessages(8);
      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      result.recentMessages.forEach((msg, idx) => {
        const originalMsg = messages[messages.length - 5 + idx];
        expect(msg.role).toBe(originalMsg.role);
        expect(msg.timestamp).toBe(originalMsg.timestamp);
        expect(msg.content).toBe(originalMsg.content);
      });
    });
  });

  describe('Default Claude Runner', () => {
    test('uses default runner when none provided', async () => {
      const messages = createMessages(10);
      const result = await HistorySummarizer.summarize(messages);

      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain('Conversation summary');
      expect(result.recentMessages).toHaveLength(5);
    });
  });

  describe('Token Calculation', () => {
    test('calculates tokens correctly for messages', async () => {
      const messages = createMessages(5);
      const result = await HistorySummarizer.summarize(messages);

      // Each message has ~35 words + 10 token overhead
      // At 4 chars per token, should be reasonable
      expect(result.originalTokens).toBeGreaterThan(100); // At least some tokens
      expect(result.originalTokens).toBeLessThan(1000); // Not unreasonably high
    });

    test('reduction calculation works correctly', () => {
      const reduction = HistorySummarizer.calculateReduction(1000, 400);
      expect(reduction).toBe(60); // 60% reduction

      const noReduction = HistorySummarizer.calculateReduction(100, 100);
      expect(noReduction).toBe(0); // 0% reduction

      const perfectReduction = HistorySummarizer.calculateReduction(1000, 0);
      expect(perfectReduction).toBe(100); // 100% reduction
    });

    test('handles zero original tokens', () => {
      const reduction = HistorySummarizer.calculateReduction(0, 0);
      expect(reduction).toBe(0);
    });
  });

  describe('Integration Test', () => {
    test('successfully summarizes 20-message history with all metrics', async () => {
      const messages = createMessages(20);

      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      // Verify structure
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('recentMessages');
      expect(result).toHaveProperty('originalTokens');
      expect(result).toHaveProperty('reducedTokens');

      // Verify content
      expect(result.summary).toBeTruthy();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.recentMessages).toHaveLength(5);

      // Verify messages
      const lastMessage = messages[messages.length - 1];
      const lastRecentMessage = result.recentMessages[result.recentMessages.length - 1];
      expect(lastRecentMessage.content).toBe(lastMessage.content);

      // Verify token reduction
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.reducedTokens).toBeGreaterThan(0);
      expect(result.reducedTokens).toBeLessThan(result.originalTokens);

      const reduction = HistorySummarizer.calculateReduction(
        result.originalTokens,
        result.reducedTokens
      );
      expect(reduction).toBeGreaterThanOrEqual(60); // Meet 60% minimum requirement
    });
  });

  describe('Role Distribution', () => {
    test('handles alternating user/assistant roles correctly', async () => {
      const messages = createMessages(10);

      // Verify test setup creates alternating roles
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');

      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      // Recent messages should preserve role pattern
      expect(result.recentMessages[0].role).toBe(messages[5].role);
      expect(result.recentMessages[1].role).toBe(messages[6].role);
    });
  });

  describe('Large Message Content', () => {
    test('handles messages with large content blocks', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'A'.repeat(1000) },
        { role: 'assistant', content: 'B'.repeat(1000) },
        { role: 'user', content: 'C'.repeat(1000) },
        { role: 'assistant', content: 'D'.repeat(1000) },
        { role: 'user', content: 'E'.repeat(1000) },
        { role: 'assistant', content: 'F'.repeat(1000) },
        { role: 'user', content: 'G'.repeat(1000) },
      ];

      const result = await HistorySummarizer.summarize(messages, mockClaudeRunner);

      expect(result.summary).toBeTruthy();
      expect(result.recentMessages).toHaveLength(5);
      expect(result.reducedTokens).toBeLessThan(result.originalTokens);
    });
  });
});
