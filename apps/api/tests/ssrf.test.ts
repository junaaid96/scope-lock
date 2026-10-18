import { describe, expect, it } from "vitest";
import { assertSafeWebhookUrl, isAllowedIp, webhookSsrfPolicy, type SsrfPolicy } from "../src/lib/ssrf.js";

const TEST: SsrfPolicy = { allowHttp: true, allowLoopback: true };
const PROD: SsrfPolicy = { allowHttp: false, allowLoopback: false };

describe("isAllowedIp", () => {
  it("blocks private, link-local, and reserved IPv4 everywhere", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "8.8.8.8"]) {
      const expected = ip === "8.8.8.8";
      expect(isAllowedIp(ip, TEST), ip).toBe(expected);
      expect(isAllowedIp(ip, PROD), ip).toBe(expected);
    }
    for (const ip of ["100.64.0.1", "192.0.2.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isAllowedIp(ip, TEST), ip).toBe(false);
      expect(isAllowedIp(ip, PROD), ip).toBe(false);
    }
    // 172.15/172.32 edges are public; 172.16/12 is not.
    expect(isAllowedIp("172.15.255.255", PROD)).toBe(true);
    expect(isAllowedIp("172.32.0.1", PROD)).toBe(true);
  });

  it("allows loopback only outside production", () => {
    expect(isAllowedIp("127.0.0.1", TEST)).toBe(true);
    expect(isAllowedIp("127.0.0.1", PROD)).toBe(false);
    expect(isAllowedIp("::1", TEST)).toBe(true);
    expect(isAllowedIp("::1", PROD)).toBe(false);
  });

  it("blocks non-public IPv6", () => {
    for (const ip of ["fe80::1", "fc00::1", "fd00::1", "ff02::1", "::", "2001:db8::1", "64:ff9b::808:808", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "garbage"]) {
      expect(isAllowedIp(ip, TEST), ip).toBe(false);
    }
    expect(isAllowedIp("2606:4700:4700::1111", PROD)).toBe(true);
    expect(isAllowedIp("::ffff:8.8.8.8", PROD)).toBe(true);
    expect(isAllowedIp("::ffff:127.0.0.1", TEST)).toBe(true);
    expect(isAllowedIp("::ffff:127.0.0.1", PROD)).toBe(false);
  });
});

describe("webhookSsrfPolicy", () => {
  it("relaxes http and loopback outside production only", () => {
    expect(webhookSsrfPolicy("production")).toEqual({ allowHttp: false, allowLoopback: false });
    expect(webhookSsrfPolicy("development")).toEqual({ allowHttp: true, allowLoopback: true });
    expect(webhookSsrfPolicy("test")).toEqual({ allowHttp: true, allowLoopback: true });
  });
});

describe("assertSafeWebhookUrl", () => {
  it("accepts public https URLs", async () => {
    // Literal IP: no DNS involved.
    const url = await assertSafeWebhookUrl("https://8.8.8.8/hook", PROD);
    expect(url.hostname).toBe("8.8.8.8");
  });

  it("requires https in production", async () => {
    await expect(assertSafeWebhookUrl("http://8.8.8.8/hook", PROD)).rejects.toThrow(/https/);
    await expect(assertSafeWebhookUrl("http://8.8.8.8/hook", TEST)).resolves.toBeTruthy();
  });

  it("rejects credentials, bad schemes, and missing hosts", async () => {
    await expect(assertSafeWebhookUrl("https://user:pass@8.8.8.8/hook", PROD)).rejects.toThrow(/credentials/);
    await expect(assertSafeWebhookUrl("gopher://8.8.8.8/hook", PROD)).rejects.toThrow(/https/);
    await expect(assertSafeWebhookUrl("not a url", PROD)).rejects.toThrow(/valid URL/);
  });

  it("rejects disallowed literal addresses", async () => {
    await expect(assertSafeWebhookUrl("https://10.0.0.5/hook", TEST)).rejects.toThrow(/disallowed address/);
    await expect(assertSafeWebhookUrl("https://169.254.169.254/latest", PROD)).rejects.toThrow(/disallowed address/);
    await expect(assertSafeWebhookUrl("http://127.0.0.1:3000/hook", PROD)).rejects.toThrow(/https|disallowed/);
  });

  it("allows loopback receivers outside production", async () => {
    await expect(assertSafeWebhookUrl("http://127.0.0.1:3000/hook", TEST)).resolves.toBeTruthy();
    await expect(assertSafeWebhookUrl("http://localhost:3000/hook", TEST)).resolves.toBeTruthy();
  });

  it("rejects hosts that resolve to disallowed addresses", async () => {
    // localhost resolves without external DNS (hosts file).
    await expect(assertSafeWebhookUrl("https://localhost/hook", PROD)).rejects.toThrow(/disallowed/);
    await expect(assertSafeWebhookUrl("https://nonexistent.invalid/hook", TEST)).rejects.toThrow(/resolve|disallowed/);
  });
});
