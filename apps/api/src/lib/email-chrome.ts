import { emailBrandLogoImgTag } from "./email-brand-logo.js";

/**
 * Light palette for transactional email. Clients that honor `color-scheme: light`
 * keep these values. Gmail iOS dark mode recolors solid `background-color` / `color`
 * pairs and does not recolor `linear-gradient()`, so fills here are solid only.
 */
export const EMAIL_COLORS = {
  background: "#f6f7fb",
  card: "#ffffff",
  foreground: "#1c1f28",
  muted: "#647089",
  border: "#e4e7ef",
  brand: "#4a5fe8",
  brandSoft: "#eef1ff",
  surface: "#f0f2f7",
  onForeground: "#ffffff",
  danger: "#c0392b",
  dangerSoft: "#fdecea",
  warning: "#b45309",
  warningSoft: "#fff7ed",
} as const;

export const EMAIL_FONT_FAMILY =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Solid CSS fill. Do not add a gradient — Gmail iOS will not recolor it. */
export function emailSolidFill(hex: string): string {
  return `background-color:${hex};`;
}

export function emailDocumentHead(title: string): string {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(title)}</title>
</head>`;
}

/**
 * Shared brand header for notification and release emails.
 * Wordmark colors are set on the same elements as a solid fill (same pattern as
 * the status badge) so Gmail dark mode adjusts text and background together.
 */
export function renderEmailBrandHeader(options: {
  badgeLabel: string;
  badgeBackground: string;
  badgeColor: string;
}): string {
  const surface = EMAIL_COLORS.surface;
  const foreground = EMAIL_COLORS.foreground;
  const muted = EMAIL_COLORS.muted;
  const fill = emailSolidFill(surface);
  const badgeFill = emailSolidFill(options.badgeBackground);

  return `<tr>
            <td bgcolor="${surface}" style="padding:24px 28px 20px;border-bottom:1px solid ${EMAIL_COLORS.border};${fill}color:${foreground};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${surface}" style="${fill}">
                <tr>
                  <td bgcolor="${surface}" style="vertical-align:middle;${fill}">
                    <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="${surface}" style="${fill}">
                      <tr>
                        <td bgcolor="${surface}" style="vertical-align:middle;padding-right:10px;${fill}">
                          ${emailBrandLogoImgTag(28)}
                        </td>
                        <td bgcolor="${surface}" style="vertical-align:middle;${fill}font-size:15px;font-weight:600;letter-spacing:-0.02em;color:${foreground};">
                          <span style="color:${foreground};${fill}">Telemetry</span><span style="color:${muted};${fill}"> / </span><span style="color:${foreground};${fill}">Tracker</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" bgcolor="${surface}" style="vertical-align:middle;${fill}">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;${badgeFill}color:${options.badgeColor};font-size:12px;font-weight:600;letter-spacing:0.02em;">${escapeHtml(options.badgeLabel)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/** Near-black pill. Solid fill so Gmail recolors the label with the button. */
export function renderEmailPrimaryCta(href: string, label: string): string {
  const fill = emailSolidFill(EMAIL_COLORS.foreground);
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 18px;border-radius:999px;${fill}color:${EMAIL_COLORS.onForeground};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>`;
}

/** Light outlined pill used beside the primary release-email action. */
export function renderEmailSecondaryCta(href: string, label: string): string {
  const fill = emailSolidFill(EMAIL_COLORS.card);
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 18px;border-radius:999px;border:1px solid ${EMAIL_COLORS.border};${fill}color:${EMAIL_COLORS.foreground};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>`;
}
