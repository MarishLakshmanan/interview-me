/** Hands out one "is this still the newest request?" check per request, so late replies can be dropped. */
export interface LatestRequest {
  /** Begin a new request; the returned check is true until another request begins or `cancel` is called. */
  begin: () => () => boolean;
  /** Make every request begun so far stale, for example when the screen is reset. */
  cancel: () => void;
}

/**
 * Make a guard against a slow reply landing after the page has moved on.
 *
 * @returns A guard whose `begin()` marks a new request as the only current one.
 */
export function createLatestRequest(): LatestRequest {
  let current = 0;
  return {
    begin() {
      const mine = ++current;
      return () => current === mine;
    },
    cancel() {
      current += 1;
    },
  };
}
