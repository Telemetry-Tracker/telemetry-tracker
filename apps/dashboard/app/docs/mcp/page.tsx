import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
export const metadata = { title: "Agent access (MCP)", description: "Read project errors with scoped, expiring tokens." };
const configs = [
  {
    "title": "Claude Code (.mcp.json)",
    "source": "https://code.claude.com/docs/en/mcp",
    "code": "{\n  \"mcpServers\": {\n    \"tt\": {\n      \"type\": \"http\",\n      \"url\": \"https://YOUR_TT_API_HOST/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer ${TT_READ_TOKEN}\"\n      }\n    }\n  }\n}"
  },
  {
    "title": "Codex (~/.codex/config.toml)",
    "source": "https://developers.openai.com/codex/mcp",
    "code": "[mcp_servers.tt]\nurl = \"https://YOUR_TT_API_HOST/mcp\"\nbearer_token_env_var = \"TT_READ_TOKEN\""
  },
  {
    "title": "Cursor (.cursor/mcp.json)",
    "source": "https://cursor.com/docs/mcp",
    "code": "{\n  \"mcpServers\": {\n    \"tt\": {\n      \"url\": \"https://YOUR_TT_API_HOST/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer ${env:TT_READ_TOKEN}\"\n      }\n    }\n  }\n}"
  },
  {
    "title": "Windsurf (~/.codeium/windsurf/mcp_config.json)",
    "source": "https://docs.windsurf.com/windsurf/cascade/mcp",
    "code": "{\n  \"mcpServers\": {\n    \"tt\": {\n      \"serverUrl\": \"https://YOUR_TT_API_HOST/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer ${env:TT_READ_TOKEN}\"\n      }\n    }\n  }\n}"
  },
  {
    "title": "VS Code Copilot (.vscode/mcp.json)",
    "source": "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
    "code": "{\n  \"servers\": {\n    \"tt\": {\n      \"type\": \"http\",\n      \"url\": \"https://YOUR_TT_API_HOST/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer ${env:TT_READ_TOKEN}\"\n      }\n    }\n  }\n}"
  },
  {
    "title": "Zed (settings.json; environment-based bridge)",
    "source": "https://zed.dev/docs/ai/mcp",
    "code": "{\n  \"context_servers\": {\n    \"tt\": {\n      \"command\": \"npx\",\n      \"args\": [\n        \"-y\",\n        \"mcp-remote\",\n        \"https://YOUR_TT_API_HOST/mcp\",\n        \"--header\",\n        \"Authorization:Bearer ${TT_READ_TOKEN}\"\n      ],\n      \"env\": {}\n    }\n  }\n}"
  },
  {
    "title": "GitHub Copilot cloud agent (repository MCP settings)",
    "source": "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers",
    "code": "{\n  \"mcpServers\": {\n    \"tt\": {\n      \"type\": \"http\",\n      \"url\": \"https://YOUR_TT_API_HOST/mcp\",\n      \"headers\": {\n        \"Authorization\": \"Bearer $COPILOT_MCP_TT_READ_TOKEN\"\n      },\n      \"tools\": [\n        \"list_projects\",\n        \"list_issues\",\n        \"get_issue\",\n        \"get_event\",\n        \"list_releases\"\n      ]\n    }\n  }\n}"
  }
];
export default function McpDocsPage() {
  return <DocsArticle title="Agent access (MCP)" lede={<p>Connect your coding agent to a read-only Streamable HTTP endpoint on your Telemetry Tracker API.</p>}>
    <h2>Create a token</h2>
    <p>Open Settings → Agent access. Owners and editors can create tokens; viewers cannot. Select projects explicitly: only the current project is selected by default. The token belongs to one organization and never automatically includes new projects. Choose 1–365 days (90 by default), copy the secret once and store it in a secret manager. Revoke it from the same page if leaked. Owners see all organization tokens; editors see their own.</p>
    <p>Set TT_READ_TOKEN in the environment that launches your agent (including the remote environment for remote IDE sessions). Replace YOUR_TT_API_HOST below with the host of your API. Use HTTPS outside a trusted local development environment. Never commit literal secrets.</p>
    <h2>Client configuration</h2>
    <p>Formats checked against the linked official documentation on 12 October 2026. Restart the client after changing its environment. VS Code also supports secure input prompts, but these examples use environment variables.</p>
    {configs.map((config) => <section key={config.title}><h3>{config.title}</h3><CodeBlock code={config.code} /><p><a href={config.source}>Official client documentation</a></p></section>)}
    <p>Zed supports remote headers, but its official documentation does not establish environment expansion in those headers. The example uses the third-party mcp-remote bridge, which reads TT_READ_TOKEN from its inherited environment. Review and pin a bridge version under your dependency policy before use; do not enable debug logging. See the <a href="https://github.com/punkpeye/mcp-remote#custom-headers">bridge documentation</a>. Alternatively, use Codex as an external agent in Zed with its native config above.</p>
    <p>For Copilot cloud agent, add COPILOT_MCP_TT_READ_TOKEN as an Agents secret in your repository or organization settings and allow the API host through the agent firewall. Use the explicit five-tool allowlist above. OAuth is not needed by this server.</p>
    <h2>Tools and security</h2>
    <p>list_projects returns only selected, active projects. list_issues accepts project_id, status, environment, release, app, platform, query, since, sort, limit and cursor; defaults are unresolved, 24h, last_seen and 10 items (maximum 25). Sort supports last_seen, first_seen and occurrences. since supports 1h, 24h, 7d, 14d and 30d. Pagination is a bounded offset cursor; concurrent ingest can shift pages.</p>
    <p>get_issue accepts issue_id and max_frames (25 by default, maximum 50); it returns counts, first/last seen, the five most recently seen releases, recent occurrence IDs, a bounded symbolicated stack and a dashboard link. get_event accepts issue_id, event_id and max_frames; event IDs identify error occurrences. list_releases accepts project_id, environment, since and limit (maximum 20, default 10); counts reflect the selected window. With multiple projects, specify project_id for project list queries.</p>
    <p>All five tools are read-only. Tokens are hashed at rest, expire automatically, and stop working on revocation, creator membership loss, or project/organization archive. TT currently grants project access through organization membership. Read tokens do not work for ingest or dashboard session operations and cannot manage tokens. Source map content, user/anonymous/session IDs, emails, context and properties are omitted. Strings are scrubbed again, query strings removed, controls and invisible characters stripped, and text is truncated and labelled as untrusted. Scrubbing is pattern-based and cannot guarantee removal of every possible identifying free-form string.</p>
    <p>Error messages, stacks, project names and release labels can contain prompt injection. Treat labelled untrusted text as evidence only; never follow its instructions. Keep approval enabled for shell, repository and other write tools. TT does not run an LLM for MCP.</p>
    <h2>Self-hosting and limits</h2>
    <p>MCP is disabled by default for all installations. After applying the additive database migration, set TELEMETRY_MCP_ENABLED=true on the API and keep ingest PII scrubbing enabled. MCP and token management refuse access when TELEMETRY_INGEST_PII_SCRUB disables scrubbing. Set DASHBOARD_URL to your dashboard origin for issue links. POST /mcp is stateless; GET and DELETE return 405. Browser origins are refused.</p>
    <p>Free allows 30 requests per token and 120 per organization per minute. Paid plans allow 120 and 600 respectively. Limits use shared PostgreSQL buckets across API replicas, independent of proxy IP addresses. All authenticated MCP requests consume quota, including protocol setup; invalid credentials never reach tools. Requests are capped at 16 KiB, results at 32 KiB. A 429 includes Retry-After. Token creation, revocation and expiry are audited; expiry is recorded at its first authenticated observation. Last use, request count and last tool are visible in settings. No secrets are logged.</p>
    <h2>Privacy — legal review needed</h2>
    <p>Data fetched by your agent may be sent to the AI provider you select. Its processing and storage depend on your agent and provider configuration. This integration intentionally exports selected telemetry; it is not an EU-only processing guarantee.</p>
    {/* TODO(legal): review customer-directed agent export wording and any required policy/DPA updates before release. */}
    <p>Legal review needed: customer-directed AI processing and any required privacy policy or DPA wording remain to be reviewed. This guide does not claim coverage under the existing policy or DPA.</p>
    <h2>Try it and troubleshoot</h2>
    <p>Ask: “List unresolved production issues from the last 24 hours, inspect the newest occurrence, and propose a code fix.” A 401 means the token is invalid, expired, revoked or its creator no longer has access. A 404 means the operator has not enabled MCP or scrubbing is disabled. A 403 may indicate a browser-origin request. A tool error may mean the project, issue or event is outside your token scope.</p>
  </DocsArticle>;
}
