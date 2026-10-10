import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadText } from "./download";

/** A fake document and URL that record the order things happen in. */
function fakeBrowser() {
  const events: string[] = [];
  const link: Record<string, unknown> = {
    click: () => events.push("click"),
  };
  vi.stubGlobal("document", {
    createElement: () => link,
    body: {
      appendChild: () => events.push("attach"),
      removeChild: () => events.push("detach"),
    },
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => events.push("revoke"),
  });
  return { events, link };
}

describe("downloadText", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("attaches the link before clicking it and removes it afterwards", () => {
    const { events } = fakeBrowser();

    downloadText("a.txt", "hello", "text/plain");

    expect(events.slice(0, 3)).toEqual(["attach", "click", "detach"]);
  });

  it("revokes the blob URL only after a delay, so the download can start first", () => {
    const { events, link } = fakeBrowser();

    downloadText("a.txt", "hello", "text/plain");
    expect(events).not.toContain("revoke");

    vi.runAllTimers();
    expect(events[events.length - 1]).toBe("revoke");
    expect(link.download).toBe("a.txt");
  });
});
