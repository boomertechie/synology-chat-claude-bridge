/**
 * Rate Limiter - Enforces Synology Chat rate limits
 *
 * Synology Chat requires 0.5-1 second between messages.
 */

export class RateLimiter {
  private lastRequest: Map<string, number> = new Map();
  private requestHistory: Map<string, number[]> = new Map();

  /**
   * Check if a request can proceed
   * @param key Rate limit key (e.g., 'global' or user_id)
   * @param minDelayMs Minimum delay between requests in ms
   * @returns true if request can proceed, false if rate limited
   */
  canProceed(key: string, minDelayMs: number = 500): boolean {
    const now = Date.now();
    const lastTime = this.lastRequest.get(key) || 0;
    return now - lastTime >= minDelayMs;
  }

  /**
   * Record a request
   */
  record(key: string): void {
    const now = Date.now();
    this.lastRequest.set(key, now);

    // Track request history for per-user limits
    const history = this.requestHistory.get(key) || [];
    history.push(now);

    // Keep only last minute of history
    const oneMinuteAgo = now - 60000;
    const filtered = history.filter((t) => t > oneMinuteAgo);
    this.requestHistory.set(key, filtered);
  }

  /**
   * Get requests in the last minute for a key
   */
  getRecentCount(key: string): number {
    const now = Date.now();
    const history = this.requestHistory.get(key) || [];
    const oneMinuteAgo = now - 60000;
    return history.filter((t) => t > oneMinuteAgo).length;
  }

  /**
   * Check per-user rate limit (max requests per minute)
   */
  isUserRateLimited(userId: string, maxPerMinute: number = 20): boolean {
    return this.getRecentCount(userId) >= maxPerMinute;
  }

  /**
   * Wait until rate limit allows (use for outgoing messages)
   */
  async throttle(key: string, minDelayMs: number = 500): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastRequest.get(key) || 0;
    const elapsed = now - lastTime;

    if (elapsed < minDelayMs) {
      await new Promise((r) => setTimeout(r, minDelayMs - elapsed));
    }

    this.record(key);
  }
}

export const rateLimiter = new RateLimiter();
