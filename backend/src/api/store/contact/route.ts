import { randomUUID } from "node:crypto";

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import { RESEND_FROM_EMAIL } from "../../../lib/constants";
import { sendApiProblem } from "../../../lib/http/correlation";
import {
  verifyPublicFormProof,
  type PublicFormPurpose,
} from "../../../lib/public-forms/auth";
import {
  PUBLIC_FORM_EMAIL_TIMEOUT_MS,
  publicFormEmailSender,
  type PublicFormEmailSender,
} from "../../../lib/public-forms/email";

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    reason: z.enum(["booking", "press", "collab", "other"]),
    message: z.string().trim().min(10).max(5000),
    honeypot: z.string().optional(),
  })
  .strict();

const PURPOSE: PublicFormPurpose = "contact";
const TIMESTAMP_HEADER = "x-rr-form-timestamp";
const PROOF_HEADER = "x-rr-form-proof";

type ContactPostDependencies = {
  createSubmissionId: () => string;
  fromEmail: string | undefined;
  nowSeconds: () => number;
  previousSecret?: string | undefined;
  secret: string | undefined;
  sendEmail: PublicFormEmailSender | null;
};

const header = (req: MedusaRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === "string" ? value.trim() : undefined;
};

const rawBody = (req: MedusaRequest): string | null => {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  return typeof req.rawBody === "string" ? req.rawBody : null;
};

const problem = (
  req: MedusaRequest,
  res: MedusaResponse,
  input: {
    code: string;
    detail: string;
    extensions?: Record<string, unknown>;
    status: number;
    title: string;
  },
): void => {
  sendApiProblem(req, res, { ...input, instance: req.path });
};

export const createContactPost =
  ({
    createSubmissionId,
    fromEmail,
    nowSeconds,
    previousSecret,
    secret,
    sendEmail,
  }: ContactPostDependencies) =>
  async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
    const normalizedSecret = secret?.trim();
    if (!normalizedSecret || normalizedSecret.length < 32) {
      problem(req, res, {
        status: 503,
        code: "contact_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      });
      return;
    }

    const body = rawBody(req);
    const proof = header(req, PROOF_HEADER);
    const timestampValue = header(req, TIMESTAMP_HEADER);
    const timestamp = timestampValue ? Number(timestampValue) : Number.NaN;
    if (
      body === null ||
      !proof ||
      !verifyPublicFormProof({
        body,
        purpose: PURPOSE,
        secret: normalizedSecret,
        previousSecret,
        timestamp,
        proof,
        nowSeconds: nowSeconds(),
      })
    ) {
      problem(req, res, {
        status: 401,
        code: "contact_unauthorized",
        title: "Contact request is unauthorized",
        detail: "The contact request proof is missing or invalid.",
      });
      return;
    }

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const errors = Object.entries(
        z.flattenError(parsed.error).fieldErrors,
      ).flatMap(([field, messages]) =>
        Array.isArray(messages)
          ? messages.map((message) => ({ field, message }))
          : [],
      );
      problem(req, res, {
        status: 400,
        code: "invalid_contact_request",
        title: "Invalid contact request",
        detail: "The contact request is invalid.",
        extensions: { errors },
      });
      return;
    }

    if (parsed.data.honeypot?.trim().length) {
      res.status(200).json({ ok: true });
      return;
    }

    const normalizedFromEmail = fromEmail?.trim();
    if (!normalizedFromEmail || !sendEmail) {
      problem(req, res, {
        status: 503,
        code: "contact_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      });
      return;
    }

    const submissionId = createSubmissionId();
    const { name, email, reason, message } = parsed.data;
    try {
      await sendEmail(
        {
          from: normalizedFromEmail,
          to: normalizedFromEmail,
          replyTo: email,
          subject: `[Contact] ${reason.toUpperCase()}`,
          text: `From: ${name} <${email}>\nReason: ${reason}\n\n${message}`,
        },
        {
          idempotencyKey: `contact-${submissionId}`,
          signal: AbortSignal.timeout(PUBLIC_FORM_EMAIL_TIMEOUT_MS),
        },
      );
    } catch {
      problem(req, res, {
        status: 503,
        code: "contact_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      });
      return;
    }

    res.status(200).json({ ok: true });
  };

export const POST = createContactPost({
  createSubmissionId: randomUUID,
  fromEmail: RESEND_FROM_EMAIL,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  previousSecret: process.env.PUBLIC_FORM_BFF_SECRET_PREVIOUS,
  secret: process.env.PUBLIC_FORM_BFF_SECRET,
  sendEmail: publicFormEmailSender,
});
