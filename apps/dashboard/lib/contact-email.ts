export const CONTACT_EMAIL = "info@telemetry-tracker.com";

export const GMAIL_COMPOSE_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CONTACT_EMAIL)}`;

export function gmailComposeUrl(opts?: { subject?: string; body?: string }) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: CONTACT_EMAIL,
  });
  if (opts?.subject) params.set("su", opts.subject);
  if (opts?.body) params.set("body", opts.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
