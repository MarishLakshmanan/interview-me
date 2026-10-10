import { describe, expect, it } from "vitest";
import type { AssessmentRequest } from "./assessment";
import { requestAssessment } from "./assessmentApi";

const request: AssessmentRequest = {
  briefing: { job_description: "jd", company_summary: "co", resume: "cv" },
  plan: [],
  lines: [],
  reached: 1,
};
const goodBody = {
  summary: "ok",
  questions: [
    { number: 1, text: "Q", kind: "technical", tests: "t", rating: "weak", right: [], wrong: ["x"], improve: ["y"], lines: [] },
  ],
  not_reached: [],
};
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("requestAssessment", () => {
  it("posts the request to /api/assessment exactly once", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(init!.body as string) });
      return new Response(JSON.stringify(goodBody), { status: 200 });
    };
    await requestAssessment(request, fake);
    expect(calls).toEqual([{ url: "/api/assessment", body: request }]);
  });

  it("returns the assessment on success", async () => {
    expect(await requestAssessment(request, reply(200, goodBody))).toEqual({ ok: true, assessment: goodBody });
  });

  it("passes on the readable message for a quota refusal, without a second call", async () => {
    let calls = 0;
    const result = await requestAssessment(request, async () => {
      calls++;
      return new Response(JSON.stringify({ error: "The daily request limit for the model has been reached." }), {
        status: 429,
      });
    });
    expect(result).toEqual({ ok: false, message: "The daily request limit for the model has been reached." });
    expect(calls).toBe(1);
  });

  it("gives a plain message when the backend is unreachable or the reply is odd", async () => {
    const down = await requestAssessment(request, async () => {
      throw new TypeError("Failed to fetch");
    });
    const odd = await requestAssessment(request, reply(200, { summary: 5 }));
    for (const r of [down, odd]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
  });
});
