const logger = require('./logger');

/**
 * Serial FIFO queue with a fixed delay between job starts.
 * Used to avoid hitting GHL rate limits when many installs fire at once
 * (e.g. agency installing the app on 50+ locations simultaneously).
 */
class ThrottleQueue {
  constructor({ name = 'queue', delayMs = 300 } = {}) {
    this.name = name;
    this.delayMs = delayMs;
    this.queue = [];
    this.running = false;
  }

  push(jobFn) {
    this.queue.push(jobFn);
    if (!this.running) this._drain();
  }

  async _drain() {
    this.running = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        await job();
      } catch (err) {
        logger.error(`[${this.name}] queue job failed:`, err.message);
      }
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
    }
    this.running = false;
  }

  size() {
    return this.queue.length;
  }
}

module.exports = ThrottleQueue;
