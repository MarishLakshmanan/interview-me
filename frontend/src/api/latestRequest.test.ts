import { describe, expect, it } from "vitest";
import { createLatestRequest } from "./latestRequest";

describe("createLatestRequest", () => {
  it("treats a request as current until another one begins", () => {
    const guard = createLatestRequest();
    const first = guard.begin();
    expect(first()).toBe(true);
    const second = guard.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("makes a request stale when the page is reset", () => {
    const guard = createLatestRequest();
    const request = guard.begin();
    guard.cancel();
    expect(request()).toBe(false);
  });
});
