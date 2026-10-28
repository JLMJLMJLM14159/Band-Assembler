// Snapshot-based undo and redo.

interface Entry<T> {
  state: T;
  /** Edits sharing a key in quick succession (typing into one field) undo as one step. */
  key?: string;
  at: number;
}

const GROUP_MS = 1500;

export class History<T> {
  private undoStack: Entry<T>[] = [];
  private redoStack: T[] = [];

  constructor(
    private capture: () => T,
    private restore: (state: T) => void,
    private limit = 200,
  ) {}

  /** Call before changing anything, so the change can be undone. */
  record(key?: string): void {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (key && last?.key === key && now - last.at < GROUP_MS) {
      last.at = now;
    } else {
      this.undoStack.push({ state: this.capture(), key, at: now });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /** Makes the next edit a new undo step even if it shares a key with the last one. */
  breakGroup(): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last) last.key = undefined;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(this.capture());
    this.restore(entry.state);
    return true;
  }

  redo(): boolean {
    const state = this.redoStack.pop();
    if (state === undefined) return false;
    this.undoStack.push({ state: this.capture(), at: 0 });
    this.restore(state);
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
