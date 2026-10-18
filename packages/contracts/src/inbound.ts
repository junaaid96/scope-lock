import { z } from "zod";

/**
 * Provider-agnostic inbound-email webhook payload. Any mail provider works:
 * forward delivery events to POST /api/v1/webhooks/inbound-email in this
 * shape with an HMAC signature (see docs/OPERATIONS.md).
 */
export const InboundAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
  /** Base64 file bytes (providers without attachment hosting). */
  contentBase64: z.string().min(1).max(8 * 1024 * 1024).optional(),
});

export const InboundEmailSchema = z.object({
  /** Provider's stable message id (replay protection). */
  messageId: z.string().min(1).max(512),
  to: z.string().min(3).max(320),
  from: z.string().min(3).max(320),
  fromName: z.string().max(200).optional(),
  subject: z.string().max(300).default(""),
  textBody: z.string().max(100000).default(""),
  inReplyTo: z.string().max(512).optional(),
  headers: z
    .object({
      autoSubmitted: z.string().max(100).optional(),
      precedence: z.string().max(100).optional(),
      xAutoResponseSuppress: z.string().max(200).optional(),
    })
    .default({}),
  attachments: z.array(InboundAttachmentSchema).max(10).default([]),
});

export const CreateMailboxSchema = z.object({
  /** Staff-only label, never part of the address. */
  name: z.string().min(1).max(120),
});

export const SimulateInboundSchema = InboundEmailSchema.extend({
  projectId: z.string().min(1),
});
