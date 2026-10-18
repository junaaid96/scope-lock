import type { Env } from "./env.js";
import type { EmailDriver } from "./lib/email.js";
import type { RealtimeDriver } from "./lib/realtime.js";
import type { SlackDriver } from "./lib/slack.js";
import type { SmsDriver } from "./lib/sms.js";
import type { StorageDriver } from "./lib/storage.js";
import type { Store } from "./store/index.js";

/** Dependencies shared by every API module. */
export interface AppContext {
  store: Store;
  env: Env;
  email: EmailDriver;
  storage: StorageDriver;
  realtime: RealtimeDriver;
  slack: SlackDriver;
  sms: SmsDriver;
  whatsapp: SmsDriver;
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  status: string;
  mfaEnabled?: boolean;
  createdAt: string;
}): unknown {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    mfaEnabled: user.mfaEnabled ?? false,
    createdAt: user.createdAt,
  };
}
