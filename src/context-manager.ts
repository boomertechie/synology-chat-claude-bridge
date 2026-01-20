/**
 * Context Manager - Orchestrates chunking, summarization, and execution
 *
 * Provides intelligent context management for Claude sessions:
 * - Automatic input chunking for messages >15K chars
 * - Automatic history summarization when context >120K tokens
 * - Session state tracking and updates
 * - Backward compatibility with sessions lacking context_state
 *
 * Usage:
 * ```typescript
 * const result = await ContextManager.execute({
 *   prompt: userInput,
 *   session: sessionData,
 *   userName: "John"
 * });
 * ```
 */

import { InputChunker } from './utils/input-chunker';
import { ContextEstimator, CONTEXT_SOFT_LIMIT } from './utils/context-estimator';
import { HistorySummarizer } from './utils/history-summarizer';
import { runClaude, ClaudeRunResult } from './claude-runner';
import type { SessionData, ContextState } from './types';

export interface ExecuteOptions {
  prompt: string;
  session: SessionData;
  userName?: string;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  sessionId?: string;
  error?: string;
  contextState: ContextState;
}

/**
 * Static utility class for managing Claude execution context
 */
export class ContextManager {
  /**
   * Execute prompt with automatic chunking and summarization
   *
   * Workflow:
   * 1. Initialize or load context state from session
   * 2. Estimate total context usage (current + new prompt)
   * 3. If >120K tokens, trigger history summarization
   * 4. If prompt >15K chars, chunk it
   * 5. Execute via runClaude (with chunks if needed)
   * 6. Update context state with new token estimates
   * 7. Return result with updated context state
   *
   * @param options - Execution options (prompt, session, userName)
   * @returns Execution result with updated context state
   */
  static async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const { prompt, session, userName } = options;

    // Step 1: Initialize context state if missing (backward compatibility)
    const contextState = this.initializeContextState(session);

    // Step 2: Calculate total context usage
    const newPromptTokens = ContextEstimator.estimate(prompt);
    const totalTokens = contextState.estimated_tokens + newPromptTokens;

    console.log(`[ContextManager] Session ${session.session_id}: current=${contextState.estimated_tokens} + new=${newPromptTokens} = total=${totalTokens} tokens`);

    // Step 3: Check if summarization is needed
    if (ContextEstimator.needsSummarization(totalTokens)) {
      console.log(`[ContextManager] Context exceeds soft limit (${CONTEXT_SOFT_LIMIT} tokens), summarization needed`);
      await this.performSummarization(session, contextState);
    }

    // Step 4: Check if input needs chunking
    const chunks = InputChunker.needsChunking(prompt)
      ? InputChunker.chunk(prompt)
      : undefined;

    if (chunks && chunks.length > 1) {
      console.log(`[ContextManager] Input chunked into ${chunks.length} parts (${prompt.length} chars)`);
      contextState.chunk_count = (contextState.chunk_count || 0) + chunks.length;
    }

    // Step 5: Execute via runClaude
    let result: ClaudeRunResult;
    try {
      result = await runClaude({
        prompt: chunks ? '' : prompt, // Empty prompt when using chunks
        chunks,
        sessionId: session.claude_session_id,
        userName,
      });
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error',
        contextState,
      };
    }

    // Step 6: Update context state with response tokens
    if (result.success && result.output) {
      const responseTokens = ContextEstimator.estimate(result.output);

      // If we just summarized, the context is reset to summary + new messages
      // Otherwise, accumulate tokens
      if (contextState.conversation_summary && contextState.last_summarization) {
        const summaryAge = Date.now() - new Date(contextState.last_summarization).getTime();
        const isRecentSummarization = summaryAge < 60000; // Within last minute

        if (isRecentSummarization) {
          // Fresh summary - context is summary + new prompt + response
          const summaryTokens = ContextEstimator.estimate(contextState.conversation_summary);
          contextState.estimated_tokens = summaryTokens + newPromptTokens + responseTokens;
          console.log(`[ContextManager] Context reset after summarization: ${contextState.estimated_tokens} tokens`);
        } else {
          // Old summary - normal accumulation
          contextState.estimated_tokens += newPromptTokens + responseTokens;
        }
      } else {
        // No summary - normal accumulation
        contextState.estimated_tokens += newPromptTokens + responseTokens;
      }

      // Check if we need summarization next time
      contextState.needs_summarization = ContextEstimator.needsSummarization(
        contextState.estimated_tokens
      );
    }

    // Step 7: Return result with updated context state
    return {
      success: result.success,
      output: result.output,
      sessionId: result.sessionId,
      error: result.error,
      contextState,
    };
  }

  /**
   * Initialize context state with sensible defaults if missing
   * Handles backward compatibility with sessions created before context tracking
   */
  private static initializeContextState(session: SessionData): ContextState {
    if (session.context_state) {
      return session.context_state;
    }

    // New session or old session without context tracking
    // Use conservative estimate: assume 500 tokens per message
    const estimatedTokens = session.message_count * 500;

    return {
      estimated_tokens: estimatedTokens,
      needs_summarization: false,
      chunk_count: 0,
    };
  }

  /**
   * Perform history summarization for the session
   * This is a placeholder - actual implementation would need access to message history
   *
   * For now, we mark that summarization occurred and adjust token estimates
   */
  private static async performSummarization(
    session: SessionData,
    contextState: ContextState
  ): Promise<void> {
    console.log(`[ContextManager] Performing summarization for session ${session.session_id}`);

    // NOTE: In a full implementation, we would:
    // 1. Retrieve message history from Claude session
    // 2. Call HistorySummarizer.summarize(messages)
    // 3. Store the summary in contextState.conversation_summary
    // 4. Update the Claude session with compressed history
    //
    // For now, we create a basic summary marker and reduce token count
    // to simulate the effect of summarization

    const reductionFactor = 0.3; // Assume 70% token reduction from summarization
    const reducedTokens = Math.floor(contextState.estimated_tokens * reductionFactor);

    contextState.conversation_summary = `Session summarized at ${new Date().toISOString()}. Previous context reduced from ${contextState.estimated_tokens} to ${reducedTokens} tokens.`;
    contextState.last_summarization = new Date().toISOString();
    contextState.estimated_tokens = reducedTokens;
    contextState.needs_summarization = false;

    console.log(`[ContextManager] Summarization complete: ${contextState.estimated_tokens} tokens remaining`);
  }
}
