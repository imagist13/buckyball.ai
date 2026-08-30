/**
 * Serializes writes and terminal ownership for a ReadableStream controller.
 *
 * Route callbacks may still fire after the consumer cancels (child-process
 * close/error and buffered stdout are the common cases).  Once cancellation
 * or completion wins, every later enqueue/close becomes a harmless no-op.
 */
export class SingleOwnerStreamWriter<T> {
  private controller: ReadableStreamDefaultController<T> | null = null;
  private terminal = false;

  attach(controller: ReadableStreamDefaultController<T>): void {
    if (this.controller || this.terminal) {
      throw new Error('SingleOwnerStreamWriter can only be attached once');
    }
    this.controller = controller;
  }

  enqueue(value: T): boolean {
    if (this.terminal || !this.controller) return false;
    try {
      this.controller.enqueue(value);
      return true;
    } catch {
      // The Web Streams implementation can reject a write if cancellation
      // wins between our state check and controller.enqueue().
      this.markTerminal();
      return false;
    }
  }

  close(): boolean {
    if (this.terminal || !this.controller) return false;
    const controller = this.controller;
    this.markTerminal();
    try {
      controller.close();
      return true;
    } catch {
      return false;
    }
  }

  cancel(): boolean {
    if (this.terminal) return false;
    this.markTerminal();
    return true;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  private markTerminal(): void {
    this.terminal = true;
    this.controller = null;
  }
}
