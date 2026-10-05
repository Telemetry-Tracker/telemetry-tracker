import {
  EMAIL_COLORS,
  EMAIL_FONT_FAMILY,
  emailDocumentHead,
  emailSolidFill,
  escapeHtml,
  renderEmailBrandHeader,
  renderEmailPrimaryCta,
  renderEmailSecondaryCta,
} from "./email-chrome.js";

export { escapeHtml };

const COLORS = EMAIL_COLORS;

const GITHUB_REPO_DOCS_BASE =
  "https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main";

const ALLOWED_ABSOLUTE_SCHEMES = new Set(["http", "https", "mailto"]);

/** Whether a changelog href may become a clickable email link. */
export function isAllowedChangelogHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return true;
  return ALLOWED_ABSOLUTE_SCHEMES.has(schemeMatch[1]!.toLowerCase());
}

/** Resolve repo-relative CHANGELOG links for email clients. */
export function resolveChangelogLink(
  href: string,
  dashboardOrigin: string
): string | null {
  const trimmed = href.trim();
  if (!trimmed || !isAllowedChangelogHref(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  const hashIndex = trimmed.indexOf("#");
  const pathPart = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : trimmed.slice(hashIndex);
  const origin = dashboardOrigin.replace(/\/$/, "");

  if (pathPart.startsWith("/")) {
    return `${origin}${pathPart}${hash}`;
  }

  const path = pathPart.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
  if (path.endsWith(".md") || path.startsWith("docs/") || path.startsWith(".github/")) {
    return `${GITHUB_REPO_DOCS_BASE}/${path}${hash}`;
  }

  return `${origin}/${path}${hash}`;
}

/** Parse **bold** and [label](url) in changelog lines. */
export function parseInlineMarkdown(raw: string, dashboardOrigin: string): string {
  const tokenRe = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(raw)) !== null) {
    result += escapeHtml(raw.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      result += `<strong style="font-weight:600;color:${COLORS.foreground};">${escapeHtml(match[1])}</strong>`;
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const resolved = resolveChangelogLink(match[3], dashboardOrigin);
      if (resolved === null) {
        result += `<span style="color:${COLORS.muted};">${escapeHtml(match[2])}</span>`;
      } else {
        result += `<a href="${escapeHtml(resolved)}" style="color:${COLORS.brand};text-decoration:none;font-weight:500;">${escapeHtml(match[2])}</a>`;
      }
    }
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(raw.slice(lastIndex));
  return result;
}

function flushListItems(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul style="margin:0 0 16px;padding:0 0 0 18px;color:${COLORS.foreground};font-size:15px;line-height:1.55;">${items.join("")}</ul>`;
}

/** Convert a CHANGELOG section body to HTML fragments (lists, headings). */
export function changelogMarkdownToHtml(markdown: string, dashboardOrigin: string): string {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(flushListItems(listItems));
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") {
      flushList();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      const label = escapeHtml(trimmed.slice(4));
      blocks.push(
        `<p style="margin:24px 0 10px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.muted};">${label}</p>`
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      listItems.push(
        `<li style="margin:0 0 10px;color:${COLORS.foreground};">${parseInlineMarkdown(trimmed.slice(2), dashboardOrigin)}</li>`
      );
      continue;
    }

    flushList();
    blocks.push(
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${COLORS.foreground};">${parseInlineMarkdown(trimmed, dashboardOrigin)}</p>`
    );
  }

  flushList();
  return blocks.join("\n");
}

export function buildReleaseEmailBodyHtml(options: {
  version: string;
  sectionMarkdown: string;
  dashboardOrigin: string;
}): string {
  const { version, sectionMarkdown, dashboardOrigin } = options;
  const origin = dashboardOrigin.replace(/\/$/, "");
  const versionLabel = version === "Unreleased" ? "What's new" : `v${version}`;
  const headline =
    version === "Unreleased"
      ? "Here's what's new in Telemetry Tracker"
      : `Telemetry Tracker ${version} is here`;

  const content = changelogMarkdownToHtml(sectionMarkdown, origin);
  const releasesUrl = `${origin}/docs/releases`;
  const dashboardUrl = `${origin}/dashboard/overview`;

  const pageFill = emailSolidFill(COLORS.background);
  const cardFill = emailSolidFill(COLORS.card);

  return `<!DOCTYPE html>
<html lang="en">
${emailDocumentHead(headline)}
<body bgcolor="${COLORS.background}" style="margin:0;padding:0;${pageFill}color:${COLORS.foreground};font-family:${EMAIL_FONT_FAMILY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.background}" style="${pageFill}padding:32px 16px;">
    <tr>
      <td align="center" bgcolor="${COLORS.background}" style="${pageFill}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.card}" style="max-width:560px;${cardFill}border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
          ${renderEmailBrandHeader({
            badgeLabel: versionLabel,
            badgeBackground: COLORS.brandSoft,
            badgeColor: COLORS.brand,
          })}
          <tr>
            <td bgcolor="${COLORS.card}" style="padding:28px 28px 8px;${cardFill}color:${COLORS.foreground};">
              <p style="margin:0 0 8px;font-size:13px;color:${COLORS.muted};">Hi there,</p>
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:600;line-height:1.3;letter-spacing:-0.02em;color:${COLORS.foreground};">${escapeHtml(headline)}</h1>
              ${content}
            </td>
          </tr>
          <tr>
            <td bgcolor="${COLORS.card}" style="padding:8px 28px 28px;${cardFill}">
              <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="${COLORS.card}" style="${cardFill}">
                <tr>
                  <td bgcolor="${COLORS.card}" style="padding-right:10px;${cardFill}">
                    ${renderEmailPrimaryCta(releasesUrl, "Release notes")}
                  </td>
                  <td bgcolor="${COLORS.card}" style="${cardFill}">
                    ${renderEmailSecondaryCta(dashboardUrl, "Open dashboard")}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};max-width:560px;text-align:center;">
          You received this because you subscribed to Telemetry Tracker product updates.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function appendReleaseEmailFooter(html: string, unsubscribeUrl: string): string {
  const pageFill = emailSolidFill(COLORS.background);
  const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.background}" style="${pageFill}"><tr><td align="center" bgcolor="${COLORS.background}" style="${pageFill}"><p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};max-width:560px;text-align:center;">
  <a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a>
</p></td></tr></table>`;

  return html.replace("</body>", `${footer}</body>`);
}
