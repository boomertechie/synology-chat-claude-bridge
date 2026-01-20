/**
 * Context Estimator Tests
 *
 * Validates token estimation accuracy within ±10% margin
 * and context management functionality.
 */

import { describe, test, expect } from 'bun:test';
import {
  ContextEstimator,
  CONTEXT_SOFT_LIMIT,
  CONTEXT_HARD_LIMIT,
  CHARS_PER_TOKEN,
} from './context-estimator';
import type { SessionData } from '../types';

describe('ContextEstimator', () => {
  describe('Constants', () => {
    test('should define correct context limits', () => {
      expect(CONTEXT_SOFT_LIMIT).toBe(120000);
      expect(CONTEXT_HARD_LIMIT).toBe(180000);
      expect(CHARS_PER_TOKEN).toBe(4);
    });
  });

  describe('estimate()', () => {
    test('should return 0 for empty string', () => {
      expect(ContextEstimator.estimate('')).toBe(0);
    });

    test('should estimate tokens using 4:1 ratio', () => {
      const text = 'Hello world!'; // 12 chars
      const expected = Math.ceil(12 / 4); // 3 tokens
      expect(ContextEstimator.estimate(text)).toBe(expected);
    });

    test('should round up fractional tokens', () => {
      const text = 'Hi!'; // 3 chars
      const expected = Math.ceil(3 / 4); // 1 token (rounded up from 0.75)
      expect(ContextEstimator.estimate(text)).toBe(expected);
    });

    test('should handle large text correctly', () => {
      const text = 'a'.repeat(10000); // 10k chars
      const expected = Math.ceil(10000 / 4); // 2500 tokens
      expect(ContextEstimator.estimate(text)).toBe(expected);
    });

    test('should handle unicode characters', () => {
      const text = '你好世界'; // 4 unicode characters
      const charCount = text.length;
      const expected = Math.ceil(charCount / 4);
      expect(ContextEstimator.estimate(text)).toBe(expected);
    });

    test('should handle newlines and whitespace', () => {
      const text = 'Line 1\nLine 2\n  Line 3  '; // 24 chars including whitespace
      const expected = Math.ceil(24 / 4); // 6 tokens
      expect(ContextEstimator.estimate(text)).toBe(expected);
    });

    test('should be within ±10% margin for realistic text', () => {
      // Sample realistic prompt (~400 chars, should be ~100 tokens)
      const text = `
        Please analyze this code and suggest improvements.
        I'm particularly interested in performance optimizations
        and best practices for error handling. The code needs to
        handle concurrent requests efficiently and maintain good
        test coverage across all critical paths.
      `;

      const estimated = ContextEstimator.estimate(text);
      const charCount = text.length;
      const expectedTokens = charCount / 4;

      // Check within ±10% margin
      const lowerBound = expectedTokens * 0.9;
      const upperBound = expectedTokens * 1.1;

      expect(estimated).toBeGreaterThanOrEqual(Math.floor(lowerBound));
      expect(estimated).toBeLessThanOrEqual(Math.ceil(upperBound));
    });
  });

  describe('calculateTotal()', () => {
    test('should calculate total tokens for session with no context state', () => {
      const session: SessionData = {
        session_id: 'test-123',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 0,
        // No context_state
      };

      const newPrompt = 'Hello world!'; // 12 chars = 3 tokens
      const total = ContextEstimator.calculateTotal(session, newPrompt);

      expect(total).toBe(3);
    });

    test('should calculate total tokens for session with existing context', () => {
      const session: SessionData = {
        session_id: 'test-123',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 5,
        context_state: {
          estimated_tokens: 1000,
          needs_summarization: false,
        },
      };

      const newPrompt = 'a'.repeat(400); // 400 chars = 100 tokens
      const total = ContextEstimator.calculateTotal(session, newPrompt);

      expect(total).toBe(1100);
    });

    test('should handle empty new prompt', () => {
      const session: SessionData = {
        session_id: 'test-123',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 3,
        context_state: {
          estimated_tokens: 5000,
          needs_summarization: false,
        },
      };

      const total = ContextEstimator.calculateTotal(session, '');

      expect(total).toBe(5000);
    });

    test('should handle session approaching soft limit', () => {
      const session: SessionData = {
        session_id: 'test-123',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 50,
        context_state: {
          estimated_tokens: 119000,
          needs_summarization: false,
        },
      };

      const newPrompt = 'a'.repeat(4000); // 1000 tokens
      const total = ContextEstimator.calculateTotal(session, newPrompt);

      expect(total).toBe(120000);
    });
  });

  describe('needsSummarization()', () => {
    test('should return false when below soft limit', () => {
      expect(ContextEstimator.needsSummarization(100000)).toBe(false);
      expect(ContextEstimator.needsSummarization(119999)).toBe(false);
    });

    test('should return true when at soft limit', () => {
      expect(ContextEstimator.needsSummarization(120000)).toBe(true);
    });

    test('should return true when above soft limit', () => {
      expect(ContextEstimator.needsSummarization(120001)).toBe(true);
      expect(ContextEstimator.needsSummarization(150000)).toBe(true);
    });

    test('should return false for zero tokens', () => {
      expect(ContextEstimator.needsSummarization(0)).toBe(false);
    });
  });

  describe('exceedsHardLimit()', () => {
    test('should return false when below hard limit', () => {
      expect(ContextEstimator.exceedsHardLimit(150000)).toBe(false);
      expect(ContextEstimator.exceedsHardLimit(179999)).toBe(false);
    });

    test('should return true when at hard limit', () => {
      expect(ContextEstimator.exceedsHardLimit(180000)).toBe(true);
    });

    test('should return true when above hard limit', () => {
      expect(ContextEstimator.exceedsHardLimit(180001)).toBe(true);
      expect(ContextEstimator.exceedsHardLimit(200000)).toBe(true);
    });
  });

  describe('getUsagePercentage()', () => {
    test('should return 0% for zero tokens', () => {
      expect(ContextEstimator.getUsagePercentage(0)).toBe(0);
    });

    test('should return correct percentage for various token counts', () => {
      expect(ContextEstimator.getUsagePercentage(90000)).toBe(50); // 50%
      expect(ContextEstimator.getUsagePercentage(120000)).toBe(67); // 66.67% rounded to 67%
      expect(ContextEstimator.getUsagePercentage(180000)).toBe(100); // 100%
    });

    test('should handle percentages over 100%', () => {
      expect(ContextEstimator.getUsagePercentage(200000)).toBe(111);
      expect(ContextEstimator.getUsagePercentage(360000)).toBe(200);
    });

    test('should round to nearest integer', () => {
      expect(ContextEstimator.getUsagePercentage(1800)).toBe(1); // 1%
      expect(ContextEstimator.getUsagePercentage(900)).toBe(1); // 0.5% rounded to 1%
    });
  });

  describe('Integration scenarios', () => {
    test('should track session growth from start to summarization trigger', () => {
      const session: SessionData = {
        session_id: 'integration-test',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 0,
        context_state: {
          estimated_tokens: 0,
          needs_summarization: false,
        },
      };

      // Simulate adding messages until summarization needed
      const prompts = [
        'a'.repeat(40000), // 10,000 tokens
        'b'.repeat(40000), // 10,000 tokens
        'c'.repeat(40000), // 10,000 tokens
        'd'.repeat(40000), // 10,000 tokens
        'e'.repeat(40000), // 10,000 tokens
        'f'.repeat(40000), // 10,000 tokens
        'g'.repeat(40000), // 10,000 tokens
        'h'.repeat(40000), // 10,000 tokens
        'i'.repeat(40000), // 10,000 tokens
        'j'.repeat(40000), // 10,000 tokens
        'k'.repeat(40000), // 10,000 tokens
        'l'.repeat(40000), // 10,000 tokens (120,000 total)
      ];

      let totalTokens = 0;
      let summarizationTriggered = false;

      for (const prompt of prompts) {
        totalTokens = ContextEstimator.calculateTotal(session, prompt);

        if (ContextEstimator.needsSummarization(totalTokens)) {
          summarizationTriggered = true;
          break;
        }

        // Update session state
        session.context_state!.estimated_tokens = totalTokens;
        session.message_count++;
      }

      expect(summarizationTriggered).toBe(true);
      expect(totalTokens).toBeGreaterThanOrEqual(CONTEXT_SOFT_LIMIT);
    });

    test('should prevent exceeding hard limit', () => {
      const session: SessionData = {
        session_id: 'hard-limit-test',
        user_name: 'Test User',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 100,
        context_state: {
          estimated_tokens: 175000,
          needs_summarization: true,
          chunk_count: 2,
        },
      };

      const newPrompt = 'a'.repeat(24000); // 6,000 tokens
      const total = ContextEstimator.calculateTotal(session, newPrompt);

      expect(ContextEstimator.exceedsHardLimit(total)).toBe(true);
      expect(total).toBeGreaterThan(CONTEXT_HARD_LIMIT);
    });
  });
});
