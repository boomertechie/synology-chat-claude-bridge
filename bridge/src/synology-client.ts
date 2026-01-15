/**
 * Synology Client - Send messages via Incoming Webhook
 */

import { rateLimiter } from './rate-limiter';

const MAX_MESSAGE_LENGTH = 3500;

export class SynologyClient {
  private webhookUrl: string;
  private messageQueue: string[] = [];
  private processing = false;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Send a message to Synology Chat
   * Handles chunking and rate limiting automatically
   */
  async sendMessage(text: string): Promise<void> {
    const chunks = this.chunkMessage(text);

    for (const chunk of chunks) {
      this.messageQueue.push(chunk);
    }

    if (!this.processing) {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;

      // Rate limit: 0.5s between messages
      await rateLimiter.throttle('synology_outgoing', 600); // 600ms to be safe

      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `payload=${encodeURIComponent(JSON.stringify({ text: message }))}`,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Synology API error: ${response.status} - ${errorText}`);
          // Don't re-queue on API errors, just log
        }
      } catch (error) {
        console.error('Failed to send message:', error);
        // Re-queue on network failure
        this.messageQueue.unshift(message);
        await new Promise((r) => setTimeout(r, 2000)); // Wait 2s before retry
      }
    }

    this.processing = false;
  }

  /**
   * Split long messages on paragraph boundaries
   */
  private chunkMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    const paragraphs = text.split('\n\n');
    let current = '';

    for (const para of paragraphs) {
      // If single paragraph is too long, split by lines
      if (para.length > MAX_MESSAGE_LENGTH) {
        if (current) {
          chunks.push(current.trim());
          current = '';
        }
        const lines = para.split('\n');
        for (const line of lines) {
          if ((current + line).length > MAX_MESSAGE_LENGTH) {
            if (current) chunks.push(current.trim());
            current = line;
          } else {
            current += (current ? '\n' : '') + line;
          }
        }
        continue;
      }

      if ((current + '\n\n' + para).length > MAX_MESSAGE_LENGTH) {
        if (current) chunks.push(current.trim());
        current = para;
      } else {
        current += (current ? '\n\n' : '') + para;
      }
    }

    if (current) chunks.push(current.trim());

    return chunks;
  }
}
