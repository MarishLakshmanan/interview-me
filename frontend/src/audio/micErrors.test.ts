import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitPermission,
  MicError,
  PERMISSION_GIVE_UP_MS,
  PERMISSION_NOTICE_MS,
  toMicError,
} from "./micErrors";

const named = (name: string) => Object.assign(new Error("x"), { name });

describe("toMicError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no-device"],
    ["OverconstrainedError", "no-device"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["SomethingElse", "unknown"],
  ])("maps %s to %s", (name, problem) => {
    expect(toMicError(named(name)).problem).toBe(problem);
  });

  it("keeps a MicError as it is", () => {
    const original = new MicError("insecure");
    expect(toMicError(original)).toBe(original);
  });

  it("handles a non-error value", () => {
    expect(toMicError("boom").problem).toBe("unknown");
  });

  it("gives each problem a distinct plain message with a way forward", () => {
    const problems = ["denied", "no-device", "busy", "insecure", "timeout", "unknown"] as const;
    const messages = problems.map((p) => new MicError(p).message);
    expect(new Set(messages).size).toBe(problems.length);
    expect(new MicError("denied").message).toMatch(/allow/i);
    expect(new MicError("insecure").message).toMatch(/localhost/);
    expect(new MicError("busy").message).toMatch(/another app/i);
    expect(new MicError("no-device").message).toMatch(/no microphone/i);
  });
});

describe("awaitPermission", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes the value through when the prompt is answered quickly", async () => {
    const onNotice = vi.fn();
    await expect(awaitPermission(Promise.resolve("stream"), onNotice)).resolves.toBe("stream");
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("says it is waiting, then gives up with a timeout error", async () => {
    const onNotice = vi.fn();
    const result = awaitPermission(new Promise<string>(() => {}), onNotice);
    const settled = expect(result).rejects.toMatchObject({ problem: "timeout" });
    await vi.advanceTimersByTimeAsync(PERMISSION_NOTICE_MS);
    expect(onNotice).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PERMISSION_GIVE_UP_MS);
    await settled;
  });

  it("hands a value that arrives after giving up to onLate", async () => {
    let resolve!: (v: string) => void;
    const slow = new Promise<string>((r) => (resolve = r));
    const onLate = vi.fn();
    const result = awaitPermission(slow, () => {}, onLate);
    const settled = expect(result).rejects.toBeInstanceOf(MicError);
    await vi.advanceTimersByTimeAsync(PERMISSION_GIVE_UP_MS);
    await settled;
    resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(onLate).toHaveBeenCalledWith("late");
  });

  it("converts a browser rejection into a MicError", async () => {
    await expect(awaitPermission(Promise.reject(named("NotAllowedError")), () => {})).rejects.toMatchObject({
      problem: "denied",
    });
  });
});
