import { describe, expect, it, vi } from "vitest";
import { History } from "../src/history";

function setup() {
  const state = { value: 0 };
  const history = new History(() => state.value, (v) => (state.value = v));
  const set = (v: number, key?: string) => {
    history.record(key);
    state.value = v;
  };
  return { state, history, set };
}

describe("history", () => {
  it("undoes and redoes in order", () => {
    const { state, history, set } = setup();
    set(1);
    set(2);
    expect(history.undo()).toBe(true);
    expect(state.value).toBe(1);
    expect(history.undo()).toBe(true);
    expect(state.value).toBe(0);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(state.value).toBe(2);
    expect(history.redo()).toBe(false);
  });

  it("drops the redo list after a new edit", () => {
    const { state, history, set } = setup();
    set(1);
    history.undo();
    set(5);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(state.value).toBe(0);
  });

  it("groups quick edits with the same key into one step", () => {
    const { state, history, set } = setup();
    set(1, "typing");
    set(2, "typing");
    set(3, "typing");
    history.undo();
    expect(state.value).toBe(0);
  });

  it("starts a new step after a pause or a group break", () => {
    vi.useFakeTimers();
    const { state, history, set } = setup();
    set(1, "typing");
    vi.advanceTimersByTime(5000);
    set(2, "typing");
    history.breakGroup();
    set(3, "typing");
    history.undo();
    expect(state.value).toBe(2);
    history.undo();
    expect(state.value).toBe(1);
    vi.useRealTimers();
  });
});
