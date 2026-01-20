/**
 * Claude Runner - Spawns Claude Code CLI with session continuity
 *
 * Supports multi-chunk execution for handling large inputs:
 *
 * @example
 * // Single execution (backward compatible)
 * runClaude({ prompt: "Hello", sessionId: "abc123" })
 *
 * @example
 * // Multi-chunk execution
 * runClaude({
 *   prompt: "", // Can be empty when using chunks
 *   chunks: ["chunk1", "chunk2", "chunk3"],
 *   sessionId: "abc123"
 * })
 * // Returns: { output: "response1\n---\nresponse2\n---\nresponse3", sessionId: "abc123" }
 */

import { spawn } from 'child_process';
import { join } from 'path';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const CLAUDE_PATH = process.env.CLAUDE_CLI_PATH || 'claude';
const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface ClaudeRunOptions {
  prompt: string;
  sessionId?: string;
  userName?: string;
  chunks?: string[];
}

export interface ClaudeRunResult {
  success: boolean;
  output: string;
  sessionId?: string;
  error?: string;
}

/**
 * Parse the result text to extract the actual response.
 * Claude CLI with --output-format json returns structured data.
 */
function parseClaudeOutput(stdout: string): { result: string; sessionId?: string } {
  try {
    const parsed = JSON.parse(stdout);
    return {
      result: parsed.result || parsed.content || stdout,
      sessionId: parsed.session_id,
    };
  } catch {
    // Not JSON, return raw output
    return { result: stdout.trim() };
  }
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const { prompt, sessionId, userName, chunks } = options;

  // Multi-chunk execution: process chunks sequentially
  if (chunks && chunks.length > 0) {
    return runClaudeMultiChunk(options, chunks);
  }

  // Single execution (backward compatible)
  return runClaudeSingle(prompt, sessionId, userName);
}

/**
 * Execute multiple chunks sequentially, preserving session across chunks
 */
async function runClaudeMultiChunk(
  options: ClaudeRunOptions,
  chunks: string[]
): Promise<ClaudeRunResult> {
  const { sessionId: initialSessionId, userName } = options;

  const outputs: string[] = [];
  let currentSessionId = initialSessionId;
  let firstError: string | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkNumber = i + 1;
    const totalChunks = chunks.length;

    // Execute chunk with current session
    const result = await runClaudeSingle(
      chunk,
      currentSessionId,
      userName,
      chunkNumber,
      totalChunks
    );

    // Collect output
    if (result.success && result.output) {
      outputs.push(result.output);
    }

    // Update session ID for next chunk
    if (result.sessionId) {
      currentSessionId = result.sessionId;
    }

    // Handle errors mid-chunking
    if (!result.success) {
      firstError = result.error || `Chunk ${chunkNumber} failed`;

      // Return partial success with collected outputs + error
      return {
        success: false,
        output: outputs.length > 0
          ? outputs.join('\n---\n') + `\n\n[Error on chunk ${chunkNumber}/${totalChunks}]`
          : '',
        sessionId: currentSessionId,
        error: firstError,
      };
    }
  }

  // All chunks succeeded - aggregate outputs
  return {
    success: true,
    output: outputs.join('\n---\n'),
    sessionId: currentSessionId,
  };
}

/**
 * Execute a single Claude CLI invocation
 */
async function runClaudeSingle(
  prompt: string,
  sessionId?: string,
  userName?: string,
  chunkNumber?: number,
  totalChunks?: number
): Promise<ClaudeRunResult> {
  // Build CLI arguments
  const args: string[] = ['-p']; // Non-interactive print mode

  // Session continuation
  if (sessionId) {
    args.push('--continue', sessionId);
  }

  // Output format
  args.push('--output-format', 'json');

  // Auto-approve safe tools
  args.push('--allowedTools', 'Read,Grep,Glob,Edit,Write');

  // System prompt for context
  let systemNote = userName
    ? `User: ${userName} via Synology Chat. Be concise but helpful.`
    : 'User is interacting via Synology Chat. Be concise but helpful.';

  // Add chunk context if this is part of multi-chunk execution
  if (chunkNumber !== undefined && totalChunks !== undefined) {
    systemNote += ` [Chunk ${chunkNumber}/${totalChunks}]`;
  }

  args.push('--append-system-prompt', systemNote);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let extractedSessionId = sessionId;

    const proc = spawn(CLAUDE_PATH, args, {
      env: {
        ...process.env,
        PAI_DIR,
        CLAUDE_CODE_ENTRYPOINT: 'synology-chat',
      },
    });

    // Send prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Try to extract session ID from stderr
      const match = chunk.match(/Session ID: ([a-f0-9-]+)/i);
      if (match) {
        extractedSessionId = match[1];
      }
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        output: '',
        error: 'Execution timeout (5 minutes)',
      });
    }, EXECUTION_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        const { result, sessionId: parsedSessionId } = parseClaudeOutput(stdout);
        resolve({
          success: true,
          output: result,
          sessionId: parsedSessionId || extractedSessionId,
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Claude exited with code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output: '',
        error: error.message,
      });
    });
  });
}
