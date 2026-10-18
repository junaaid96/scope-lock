import { logger } from "../logger.js";
import { assertSafeWebhookUrl, webhookSsrfPolicy } from "./ssrf.js";

export interface SlackMessage {
  text: string;
}

export interface SlackDriver {
  readonly name: string;
  post(webhookUrl: string, msg: SlackMessage): Promise<void>;
}

/**
 * Incoming-webhook driver. The URL is admin-configured per org and sealed at
 * rest; it is SSRF-screened again on every send so a tampered row cannot turn
 * the worker into a proxy.
 */
class WebhookSlackDriver implements SlackDriver {
  readonly name = "webhook";
  constructor(private readonly nodeEnv: string) {}
  async post(webhookUrl: string, msg: SlackMessage): Promise<void> {
    await assertSafeWebhookUrl(webhookUrl, webhookSsrfPolicy(this.nodeEnv));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: msg.text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Slack responded ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Development driver: structured log only. Outbox still records delivery state. */
class LogSlackDriver implements SlackDriver {
  readonly name = "log";
  async post(webhookUrl: string, msg: SlackMessage): Promise<void> {
    logger.info("Slack (log driver)", { host: hostOf(webhookUrl), chars: msg.text.length });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export function createSlackDriver(env: { NODE_ENV: string }): SlackDriver {
  return env.NODE_ENV === "production" ? new WebhookSlackDriver(env.NODE_ENV) : new LogSlackDriver();
}
