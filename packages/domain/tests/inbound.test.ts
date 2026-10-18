import { describe, expect, it } from "vitest";
import { isAutoReply, looksLikeAutoSubject, mailboxLocalPart, parseEmailAddress, stripQuotedReply } from "../src/inbound.js";

describe("inbound email helpers", () => {
  it("parses display-form and bare addresses", () => {
    expect(parseEmailAddress("Pat <Pat@Example.COM>")).toBe("pat@example.com");
    expect(parseEmailAddress("a@b.co")).toBe("a@b.co");
    expect(parseEmailAddress("not-an-address")).toBeNull();
    expect(parseEmailAddress("a@b")).toBeNull();
    expect(mailboxLocalPart("Chg-Ab12+tag@inbound.example")).toBe("chg-ab12");
  });

  it("strips quoted replies and signatures", () => {
    const body = [
      "Please add SSO to the dashboard.",
      "",
      "On Mon, 1 Jan 2026 at 10:00, Support <support@example.com> wrote:",
      "> What do you need?",
      "> ",
      "Thanks!",
      "-- ",
      "Pat Visitor",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Please add SSO to the dashboard.");
  });

  it("strips outlook-style forwarded headers", () => {
    const body = ["See below.", "-----Original Message-----", "From: x", "Old content here"].join("\n");
    expect(stripQuotedReply(body)).toBe("See below.");
  });

  it("detects auto-replies and loops", () => {
    expect(isAutoReply({ autoSubmitted: "auto-replied" }, [])).toBe(true);
    expect(isAutoReply({ autoSubmitted: "no" }, [])).toBe(false);
    expect(isAutoReply({ precedence: "bulk" }, [])).toBe(true);
    expect(isAutoReply({ xAutoResponseSuppress: "OOF" }, [])).toBe(true);
    expect(isAutoReply({ xAutoResponseSuppress: "All" }, [])).toBe(true);
    expect(isAutoReply({ from: "us@app.example" }, ["us@app.example"])).toBe(true);
    expect(isAutoReply({ from: "pat@example.com" }, ["us@app.example"])).toBe(false);
    expect(isAutoReply({}, [])).toBe(false);
  });

  it("flags auto subjects as a backstop", () => {
    expect(looksLikeAutoSubject("Out of office: back Monday")).toBe(true);
    expect(looksLikeAutoSubject("Undeliverable: foo")).toBe(true);
    expect(looksLikeAutoSubject("Re: booking calendar")).toBe(false);
  });
});
