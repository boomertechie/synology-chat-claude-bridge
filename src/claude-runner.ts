/**
 * Claude Runner - Spawns Claude Code CLI with session continuity
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
  const { prompt, sessionId, userName } = options;

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
  const systemNote = userName
    ? `User: ${userName} via Synology Chat. Be concise but helpful.`
    : 'User is interacting via Synology Chat. Be concise but helpful.';
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
