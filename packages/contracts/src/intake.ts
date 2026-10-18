import { z } from "zod";
import { IsoDateSchema } from "./common.js";

export const CreateIntakeLinkSchema = z.object({
  /** Staff-only label, never shown on the public form. */
  name: z.string().min(1).max(120),
  expiresAt: IsoDateSchema.nullable().optional(),
});

export const IntakeSubmitSchema = z.object({
  title: z.string().min(4).max(200),
  description: z.string().min(20).max(8000),
  submitterName: z.string().max(120).optional(),
  submitterEmail: z.string().email().max(254).optional().or(z.literal("")),
  /** Honeypot: real forms leave it empty; bots fill it and get silently dropped. */
  website: z.string().max(200).optional().default(""),
});
