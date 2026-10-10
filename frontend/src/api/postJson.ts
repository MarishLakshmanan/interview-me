export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PostResult = { ok: true; body: any } | { ok: false; message: string };

/**
 * Post JSON to the backend and read the reply, turning every failure into a message for the candidate.
 *
 * @param url The backend path, such as "/api/plan".
 * @param payload The value to send as the JSON body.
 * @param fallbackMessage What to say when the reply is an error without a readable message.
 * @param fetchFn The fetch to use; tests pass a fake. Defaults to the browser's fetch.
 * @returns The parsed JSON body on a 2xx reply, or a message. Never throws.
 */
export async function postJson(
  url: string,
  payload: unknown,
  fallbackMessage: string,
  fetchFn: FetchLike = (...args) => fetch(...args),
): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, message: "Could not reach the backend. Check that it is running, then try again." };
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy error page, say); handled below.
  }
  if (response.ok && body) return { ok: true, body };
  if (typeof body?.error === "string" && body.error.trim()) return { ok: false, message: body.error };
  return { ok: false, message: fallbackMessage };
}
