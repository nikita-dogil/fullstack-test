// Server-side processing queue with de-duplication.
//
// Incoming write operations are pushed onto a single queue and processed
// strictly one-at-a-time (serialized), which removes any race between
// concurrent batches. Operations carry a `key`; while an operation is still
// pending in the queue, a second operation with the same key is dropped — this
// gives the "same value will not be processed twice" guarantee.

export class OperationQueue {
  constructor() {
    this._items = [];
    this._pendingKeys = new Set();
    this._processing = false;
  }

  /**
   * Enqueue an operation.
   * @param {string} key  dedup key — duplicates already in the queue are ignored
   * @param {() => any} run  the work to perform when the op is processed
   * @returns {boolean} true if enqueued, false if dropped as a duplicate
   */
  enqueue(key, run) {
    if (key != null && this._pendingKeys.has(key)) return false;
    if (key != null) this._pendingKeys.add(key);
    this._items.push({ key, run });
    this._drain();
    return true;
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._items.length > 0) {
        const { key, run } = this._items.shift();
        if (key != null) this._pendingKeys.delete(key);
        try {
          await run();
        } catch (err) {
          // A bad operation must not stall the queue.
          // eslint-disable-next-line no-console
          console.error('[queue] operation failed:', err);
        }
      }
    } finally {
      this._processing = false;
    }
  }

  get size() {
    return this._items.length;
  }
}
