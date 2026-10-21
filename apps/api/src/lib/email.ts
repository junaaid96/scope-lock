import type { Env } from "../env.js";
import { usesEmailApi } from "../env.js";
import { logger } from "../logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailDriver {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** Development driver: structured log only. Outbox still records delivery state. */
class LogEmailDriver implements EmailDriver {
  readonly name = "log";
  async send(msg: EmailMessage): Promise<void> {
    logger.info("Email (log driver)", { to: msg.to, subject: msg.subject, chars: msg.text.length });
  }
}

/**
 * Generic transactional HTTP driver. Configure EMAIL_API_KEY/EMAIL_FROM plus
 * EMAIL_HTTP_ENDPOINT for a provider with an HTTP API (Resend by default);
 * the payload shape follows the common {from,to,subject,text} convention
 * and is documented in docs/OPERATIONS.md.
 */
class HttpEmailDriver implements EmailDriver {
  readonly name = "http";
  constructor(private readonly env: Env) {}
  async send(msg: EmailMessage): Promise<void> {
    const endpoint = this.env.EMAIL_HTTP_ENDPOINT || "https://api.transactional.example/v1/send";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.env.EMAIL_API_KEY}`,
        },
        body: JSON.stringify({ from: this.env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createEmailDriver(env: Env): EmailDriver {
  return usesEmailApi(env) ? new HttpEmailDriver(env) : new LogEmailDriver();
}
