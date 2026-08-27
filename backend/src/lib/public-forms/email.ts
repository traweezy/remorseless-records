import { Resend } from "resend";

import { RESEND_API_KEY } from "../constants";

export const PUBLIC_FORM_EMAIL_TIMEOUT_MS = 5_000;

export type PublicFormEmail = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
};

export type PublicFormEmailRequest = {
  idempotencyKey: string;
  signal: AbortSignal;
};

export type PublicFormEmailSender = (
  email: PublicFormEmail,
  request: PublicFormEmailRequest,
) => Promise<void>;

export const createResendPublicFormEmailSender = (
  apiKey: string,
): PublicFormEmailSender => {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error("Cannot configure public-form email without an API key");
  }
  const resend = new Resend(normalizedApiKey);

  return async (email, request): Promise<void> => {
    const requestOptions = {
      idempotencyKey: request.idempotencyKey,
      signal: request.signal,
    };
    const result = await resend.emails.send(
      {
        from: email.from,
        to: [email.to],
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
      },
      requestOptions,
    );
    if (result.error) {
      throw new Error("Public-form email provider rejected the request");
    }
  };
};

export const publicFormEmailSender = RESEND_API_KEY?.trim()
  ? createResendPublicFormEmailSender(RESEND_API_KEY)
  : null;
