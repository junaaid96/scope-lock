import type { Env } from "../env.js";
import { usesSmsApi, usesWhatsappApi } from "../env.js";
import { logger } from "../logger.js";

export type SmsKind = "SMS" | "WHATSAPP";

export interface SmsMessage {
  to: string;
  body: string;
  kind: SmsKind;
}

export interface SmsDriver {
  readonly name: string;
  send(msg: SmsMessage): Promise<void>;
}

/** Development driver: structured log only. Outbox still records delivery state. */
class LogSmsDriver implements SmsDriver {
  readonly name = "log";
  async send(msg: SmsMessage): Promise<void> {
    logger.info("SMS (log driver)", { to: msg.to, kind: msg.kind, chars: msg.body.length });
  }
}

/**
 * Generic provider HTTP driver. Configure SMS_API_URL/SMS_API_KEY (or the
 * WHATSAPP_* pair) for a provider with an HTTP API; the payload follows the
 * common {to,body} convention and is documented in docs/OPERATIONS.md.
 */
class HttpSmsDriver implements SmsDriver {
  readonly name = "http";
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}
  async send(msg: SmsMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ to: msg.to, body: msg.body, kind: msg.kind.toLowerCase() }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${msg.kind} provider responded ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createSmsDriver(env: Env): SmsDriver {
  return usesSmsApi(env) ? new HttpSmsDriver(env.SMS_API_URL, env.SMS_API_KEY) : new LogSmsDriver();
}

export function createWhatsappDriver(env: Env): SmsDriver {
  return usesWhatsappApi(env) ? new HttpSmsDriver(env.WHATSAPP_API_URL, env.WHATSAPP_API_KEY) : new LogSmsDriver();
}
