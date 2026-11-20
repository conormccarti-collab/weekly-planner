import { env } from "@/lib/env";

/**
 * v4 Stage 7, brief section 10: a transactional email service, proposed as
 * Resend. Uses Resend's own test sender (`onboarding@resend.dev`) rather
 * than a verified custom domain, per the chosen setup — no npm dependency,
 * just their plain REST API.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Weekly Planner <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend send failed (${response.status}): ${body}`);
  }
}
