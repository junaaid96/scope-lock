import { createHmac } from "node:crypto";
import type { Env } from "../env.js";
import { usesAbly } from "../env.js";
import { logger } from "../logger.js";

export interface RealtimeDriver {
  readonly name: "ably" | "local";
  /** Publish a refresh hint. Never carries more than the viewer may access. */
  publish(channel: string, event: string, data: Record<string, unknown>): Promise<void>;
  /** Short-lived channel token issued only after an API authorization check. */
  createChannelToken(channel: string, userId: string, ttlSeconds?: number): Promise<{ token: string; expiresAt: string }>;
}

/** Local driver: events are durable in the outbox + pollable via REST; publish is a no-op log. */
class LocalRealtimeDriver implements RealtimeDriver {
  readonly name = "local" as const;
  constructor(private readonly env: Env) {}
  async publish(channel: string, event: string, _data: Record<string, unknown>): Promise<void> {
    logger.debug("Realtime (local driver): event recorded, clients poll", { channel, event });
  }
  async createChannelToken(channel: string, userId: string, ttlSeconds = 3600): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const mac = createHmac("sha256", this.env.AUTH_SECRET || "local-dev")
      .update(`${channel}:${userId}:${expiresAt}`)
      .digest("hex");
    return { token: Buffer.from(`${channel}:${userId}:${expiresAt}:${mac}`).toString("base64url"), expiresAt };
  }
}

class AblyRealtimeDriver implements RealtimeDriver {
  readonly name = "ably" as const;
  constructor(private readonly env: Env) {}
  private async rest(): Promise<typeof import("ably")> {
    return import("ably");
  }
  async publish(channel: string, event: string, data: Record<string, unknown>): Promise<void> {
    const ably = await this.rest();
    const client = new ably.Rest({ key: this.env.ABLY_API_KEY });
    await client.channels.get(channel).publish(event, data);
  }
  async createChannelToken(channel: string, userId: string, ttlSeconds = 3600): Promise<{ token: string; expiresAt: string }> {
    const ably = await this.rest();
    const client = new ably.Rest({ key: this.env.ABLY_API_KEY });
    const request = await client.auth.createTokenRequest({
      clientId: userId,
      ttl: ttlSeconds * 1000,
      capability: { [channel]: ["subscribe", "presence"] },
    });
    // Token requests are exchanged client-side for a token; returning the signed
    // request keeps the root key server-side while granting subscribe-only access.
    return {
      token: Buffer.from(JSON.stringify(request)).toString("base64url"),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
}

export function createRealtimeDriver(env: Env): RealtimeDriver {
  return usesAbly(env) ? new AblyRealtimeDriver(env) : new LocalRealtimeDriver(env);
}
