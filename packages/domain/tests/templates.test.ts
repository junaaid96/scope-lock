import { describe, expect, it } from "vitest";
import { applyTemplate, splitCriteria } from "../src/templates.js";

describe("applyTemplate", () => {
  it("trims, dedupes, caps, and drops untitled items", () => {
    const payload = applyTemplate({
      assumptions: ["  Uptime 99%  ", "", "Uptime 99%"],
      exclusions: ["", "  Data migration  "],
      items: [
        { title: "  Login  ", description: "  SSO login  ", acceptanceCriteria: [" a ", "", "a"], category: " Auth ", priority: "HIGH" },
        { title: "   ", description: "untitled", acceptanceCriteria: [] },
      ],
    });
    expect(payload.assumptions).toEqual(["Uptime 99%"]);
    expect(payload.exclusions).toEqual(["Data migration"]);
    expect(payload.items).toEqual([
      { title: "Login", description: "SSO login", acceptanceCriteria: ["a"], category: "Auth", priority: "HIGH" },
    ]);
  });

  it("caps runaway templates", () => {
    const many = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const payload = applyTemplate({
      assumptions: many,
      exclusions: many,
      items: many.map((title) => ({ title, description: "d", acceptanceCriteria: [] })),
    });
    expect(payload.assumptions).toHaveLength(50);
    expect(payload.exclusions).toHaveLength(50);
    expect(payload.items).toHaveLength(100);
  });
});

describe("splitCriteria", () => {
  it("splits pipes, trims, dedupes, caps", () => {
    expect(splitCriteria("a | b |a| ")).toEqual(["a", "b"]);
    expect(splitCriteria(undefined)).toEqual([]);
    expect(splitCriteria("")).toEqual([]);
    expect(splitCriteria(Array.from({ length: 60 }, (_, i) => `c${i}`).join("|"))).toHaveLength(50);
  });
});
