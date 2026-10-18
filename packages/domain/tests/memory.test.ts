import { describe, expect, it } from "vitest";
import { buildExcerpt, cosineSimilarity, scoreLexical, tokenizeQuery } from "../src/memory.js";

describe("tokenizeQuery", () => {
  it("normalizes, dedupes, and caps tokens", () => {
    expect(tokenizeQuery("Budget Budget overrun!")).toEqual(["budget", "overrun"]);
    expect(tokenizeQuery("a I to CHG-001")).toEqual(["to", "chg", "001"]);
    expect(tokenizeQuery("!!!")).toEqual([]);
    expect(tokenizeQuery(Array.from({ length: 30 }, (_, i) => `term${i}`).join(" "))).toHaveLength(20);
  });
});

describe("scoreLexical", () => {
  const doc = { title: "Budget increase approved", text: "The client accepted the revised hosting budget for Q3." };

  it("weighs title matches over text matches", () => {
    expect(scoreLexical("budget", doc)).toBeGreaterThan(scoreLexical("hosting", doc));
    expect(scoreLexical("hosting", doc)).toBeGreaterThan(0);
    expect(scoreLexical("unrelated", doc)).toBe(0);
    expect(scoreLexical("", doc)).toBe(0);
  });

  it("bonuses full coverage", () => {
    expect(scoreLexical("budget increase", doc)).toBeGreaterThan(scoreLexical("budget zebra", doc));
  });
});

describe("buildExcerpt", () => {
  it("returns short text whole", () => {
    expect(buildExcerpt("Short decision note.", "note")).toBe("Short decision note.");
  });

  it("windows around the first hit and stays verbatim", () => {
    const text = `Background context that runs long. The key phrase is budget approval here. ${"Trailing filler. ".repeat(30)}`;
    const excerpt = buildExcerpt(text, "budget approval", 60);
    expect(excerpt).toContain("budget");
    expect(excerpt.replace(/…/g, "").trim().length).toBeLessThanOrEqual(60);
    // Verbatim modulo ellipses: strip them and find the slice in the source.
    const compact = (s: string): string => s.replace(/\s+/g, " ").trim();
    expect(compact(text)).toContain(compact(excerpt.replace(/…/g, "")));
  });

  it("falls back to the leading slice without a hit", () => {
    const text = `${"No match here. ".repeat(30)}`;
    expect(buildExcerpt(text, "zebra", 40)).toBe(`${text.slice(0, 40).trimEnd()}…`);
  });
});

describe("cosineSimilarity", () => {
  it("scores identical vectors 1 and orthogonal 0", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });

  it("returns 0 when degenerate", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
