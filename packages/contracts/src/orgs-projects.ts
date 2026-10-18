import { z } from "zod";
import {
  CurrencySchema,
  EmailSchema,
  HexColorSchema,
  HttpsUrlSchema,
  IdSchema,
  IsoDateSchema,
  MinorUnitsSchema,
  OrgRoleSchema,
  PlanSchema,
  ProjectRoleSchema,
  ProjectStatusSchema,
} from "./common.js";

// ---------- Auth ----------
export const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  email: EmailSchema,
  password: z.string().min(10).max(200),
  organizationName: z.string().min(1).max(120),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const PasswordResetRequestSchema = z.object({ email: EmailSchema });
export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(10).max(200),
});
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const MfaVerifySchema = z.object({ code: z.string().min(6).max(12) });
export const MfaDisableSchema = z.object({ password: z.string().min(1).max(200) });
export const MfaChallengeSchema = z.object({
  ticket: z.string().min(20).max(500),
  code: z.string().min(6).max(24),
});
export const DeleteAccountSchema = z.object({ password: z.string().min(1).max(200) });

// ---------- Organizations ----------
export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
});
export const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  plan: PlanSchema.optional(),
  aiEnabled: z.boolean().optional(),
  branding: z
    .object({
      displayName: z.string().min(1).max(120),
      logoUrl: HttpsUrlSchema.optional(),
      primaryColor: HexColorSchema.optional(),
    })
    .nullable()
    .optional(),
});
export const CreateInvitationSchema = z.object({
  email: EmailSchema,
  role: OrgRoleSchema,
  projectId: IdSchema.optional(),
  projectRole: ProjectRoleSchema.optional(),
});
export const InvitationTokenSchema = z.object({ token: z.string().min(20) });
export const UpdateMembershipSchema = z.object({ role: OrgRoleSchema });

// ---------- Clients ----------
export const ClientContactSchema = z.object({
  name: z.string().max(120).optional(),
  email: EmailSchema.optional(),
});
export const CreateClientSchema = z.object({
  organizationId: IdSchema,
  name: z.string().min(1).max(160),
  company: z.string().max(160).optional(),
  contacts: z.array(ClientContactSchema).max(25).default([]),
  notes: z.string().max(4000).optional(),
});
export const UpdateClientSchema = CreateClientSchema.omit({ organizationId: true }).partial();

// ---------- Projects ----------
export const ApprovalThresholdRuleSchema = z.object({
  /** Prices at or below this (minor units, project currency) use this mode; null = no ceiling. */
  uptoMinor: z.number().int().min(0).max(1000000000000).nullable(),
  mode: z.enum(["ANY", "ALL", "SEQUENTIAL"]),
});
export const ProjectSettingsSchema = z.object({
  aiEnabled: z.boolean().default(true),
  reminderHoursBeforeExpiry: z.array(z.number().int().min(1).max(720)).max(4).default([48, 24]),
  /** Amount thresholds for approval policy; ascending ceilings, evaluated in order. Empty = ANY always. */
  approvalPolicies: z.array(ApprovalThresholdRuleSchema).max(5).default([]),
});
export const CreateProjectSchema = z.object({
  organizationId: IdSchema,
  clientId: IdSchema,
  name: z.string().min(1).max(160),
  currency: CurrencySchema.default("USD"),
  startDate: IsoDateSchema.optional(),
  targetDate: IsoDateSchema.optional(),
  budgetMinor: MinorUnitsSchema.optional(),
  settings: ProjectSettingsSchema.partial().optional(),
});
export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  status: ProjectStatusSchema.optional(),
  currency: CurrencySchema.optional(),
  startDate: IsoDateSchema.nullable().optional(),
  targetDate: IsoDateSchema.nullable().optional(),
  budgetMinor: MinorUnitsSchema.nullable().optional(),
  settings: ProjectSettingsSchema.partial().optional(),
  externalIntegrationsEnabled: z.boolean().optional(),
});
export const AddProjectMemberSchema = z.object({
  userId: IdSchema.optional(),
  email: EmailSchema.optional(),
  role: ProjectRoleSchema,
});
export const UpdateProjectMemberSchema = z.object({ role: ProjectRoleSchema });
