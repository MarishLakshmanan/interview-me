import { describe, expect, it } from "vitest";
import { DAILY_LIMIT_NOTE, requestPlan, type PlannedQuestion } from "./planApi";

const briefing = { jobDescription: "jd", companySummary: "co", resume: "cv" };
const question = (n: number): PlannedQuestion => ({ text: `Q${n}`, kind: "technical", tests: "x", good_answer: ["a"] });
const reply = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("requestPlan", () => {
  it("posts the briefing with the backend's field names", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fake = async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ questions: [question(1)] }), { status: 200 });
    };
    await requestPlan(briefing, fake);
    expect(seen!.url).toBe("/api/plan");
    expect(seen!.init?.method).toBe("POST");
    expect(JSON.parse(seen!.init!.body as string)).toEqual({
      job_description: "jd",
      company_summary: "co",
      resume: "cv",
    });
  });

  it("returns the plan on success", async () => {
    const result = await requestPlan(briefing, reply(200, { questions: [question(1), question(2)] }));
    expect(result).toEqual({ ok: true, plan: [question(1), question(2)] });
  });

  it("returns the backend's readable message on a refusal", async () => {
    const result = await requestPlan(briefing, reply(422, { error: "The job description is too short." }));
    expect(result).toEqual({ ok: false, message: "The job description is too short." });
  });

  it("passes on the quota message, and the daily-limit note speaks of a daily cap", async () => {
    const result = await requestPlan(briefing, reply(429, { error: "The daily request limit has been reached." }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("daily request limit");
    expect(DAILY_LIMIT_NOTE).toMatch(/day/i);
  });

  it("gives a plain message when the backend is unreachable", async () => {
    const result = await requestPlan(briefing, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not reach/i);
  });

  it("gives a plain message when the reply is not a plan", async () => {
    const odd = await requestPlan(briefing, reply(200, { questions: "nope" }));
    const html = await requestPlan(briefing, async () => new Response("<html>", { status: 502 }));
    for (const r of [odd, html]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
  });
});
