import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { scrubPiiText } from "./pii-scrub.js";
import { fetchImpactMetricsForGroupId } from "./errors-list-query.js";
import { prisma } from "./db.js";
import type { McpAuth } from "./mcp-auth.js";

import { enrichErrorGroupWithSymbolicatedStacks } from "./stack-symbolicate.js";
import { issueDashboardUrl, MCP_INSTRUCTIONS, mcpResult, untrustedText } from "./mcp-output.js";

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const project_id = z.string().uuid().optional();
const filter = z.string().max(120).optional();
const window = z.enum(["1h", "24h", "7d", "14d", "30d"]).default("24h");
export function windowStart(since: string) {
  const ms: Record<string, number> = { "1h": 3600_000, "24h": 86400_000, "7d": 7 * 86400_000, "14d": 14 * 86400_000, "30d": 30 * 86400_000 };
  return new Date(Date.now() - ms[since]!);
}
const groupSelect = {
  id: true, project_id: true, message: true, app: true, environment: true, platform: true,
  release: true, occurrences: true, first_seen: true, last_seen: true, resolved_at: true,
} as const;
const eventSelect = { id: true, stack: true, release: true, platform: true, environment: true, sdk_version: true, created_at: true } as const;

export function scopedProject(auth: McpAuth, id?: string) {
  const chosen = id ?? (auth.projects.length === 1 ? auth.projects[0]!.id : undefined);
  if (!chosen || !auth.projects.some((p) => p.id === chosen)) throw new Error("Choose an authorized project_id");
  return chosen;
}
function issueSummary(group: {
  id: string; project_id: string; message: string; app: string; environment: string | null;
  platform: string | null; release: string | null; occurrences: number; first_seen: Date; last_seen: Date; resolved_at: Date | null;
}) {
  return {
    issue_id: group.id, project_id: group.project_id, title: untrustedText(group.message),
    app: untrustedText(group.app, 120), environment: untrustedText(group.environment, 120),
    release: untrustedText(group.release, 120), platform: untrustedText(group.platform, 120),
    occurrences_total: group.occurrences, first_seen: group.first_seen, last_seen: group.last_seen,
    status: group.resolved_at ? "resolved" : "unresolved", dashboard_url: issueDashboardUrl(group.id),
  };
}
export function buildMcpServer(auth: McpAuth) {
  const server = new McpServer({ name: "telemetry-tracker", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    // Re-check credential validity and current membership for every HTTP request in the route.
    await prisma.mcpReadToken.update({ where: { id: auth.token.id }, data: { last_tool: name } });
    try { return mcpResult(await fn()); }
    catch (error) {
      if (error instanceof Error && ["Choose an authorized project_id", "Issue not found", "Event not found", "Invalid cursor"].includes(error.message)) {
        return { isError: true, content: [{ type: "text" as const, text: error.message }] };
      }
      // Do not echo database errors, telemetry or credentials to clients.
      return { isError: true, content: [{ type: "text" as const, text: "Unable to read telemetry" }] };
    }
  };
  server.registerTool("list_projects", { description: "List explicitly authorized projects only.", inputSchema: {}, annotations }, () => run("list_projects", async () => auth.projects.map((p) => ({ project_id: p.id, name: untrustedText(p.name, 120), slug: untrustedText(p.slug, 120) }))));
  server.registerTool("list_issues", {
    description: "Read error groups seen within a bounded time window (default 24h), with cursor pagination.",
    inputSchema: { project_id, status: z.enum(["unresolved", "resolved", "all"]).default("unresolved"), environment: filter, release: filter, app: filter, platform: filter, query: z.string().max(200).optional(), since: window, sort: z.enum(["last_seen", "first_seen", "occurrences"]).default("last_seen"), limit: z.number().int().min(1).max(25).default(10), cursor: z.string().max(1000).optional() }, annotations,
  }, (args) => run("list_issues", async () => {
    const pid = scopedProject(auth, args.project_id);
    // Cursor is a bounded offset; queries retain scope and filters independently of cursor contents.
    const offset = args.cursor ? Number(args.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Invalid cursor");
    const occurrenceWhere: Prisma.ErrorOccurrenceWhereInput = {
      created_at: { gte: windowStart(args.since) },
      ...(args.release ? { release: args.release } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
    };
    const where: Prisma.ErrorGroupWhereInput = {
      project_id: pid, last_seen: { gte: windowStart(args.since) },
      ...(args.status === "all" ? {} : { resolved_at: args.status === "resolved" ? { not: null } : null }),
      ...(args.app ? { app: args.app } : {}), ...(args.environment ? { environment: args.environment } : {}),
      ...(args.release || args.platform ? { occurrences_list: { some: occurrenceWhere } } : {}),
      ...(args.query ? { message: { contains: args.query, mode: "insensitive" } } : {}),
    };
    const rows = await prisma.errorGroup.findMany({ where, select: { ...groupSelect, _count: { select: { occurrences_list: { where: occurrenceWhere } } } }, orderBy: [{ [args.sort]: "desc" }, { id: "desc" }], skip: offset, take: args.limit + 1 });
    return { items: rows.slice(0, args.limit).map((row) => ({ ...issueSummary(row), occurrences_in_window: row._count?.occurrences_list ?? 0 })), next_cursor: rows.length > args.limit && offset + args.limit <= 10000 ? String(offset + args.limit) : null };
  }));
  async function loadIssue(issueId: string) {
    const row = await prisma.errorGroup.findFirst({ where: { id: issueId, project_id: { in: auth.projects.map((p) => p.id) } }, select: groupSelect });
    if (!row) throw new Error("Issue not found");
    return row;
  }
  async function eventOutput(group: Awaited<ReturnType<typeof loadIssue>>, event: { id: string; stack: string | null; release: string | null; platform: string | null; environment: string | null; sdk_version: string | null; created_at: Date }, maxFrames: number) {
    // Bound symbolication work before loading maps; never serialize map content or context.
    const bounded = { ...event, stack: (event.stack ? scrubPiiText(event.stack).slice(0, 16000).split("\n").slice(0, maxFrames).join("\n") : null) ?? null };
    const enriched = await enrichErrorGroupWithSymbolicatedStacks(prisma, group.project_id, { app: group.app, release: group.release, occurrences_list: [bounded] });
    const occurrence = enriched.occurrences_list[0]! as typeof bounded & { symbolicated_stack?: string; symbolication_status?: string };
    return {
      event_id: event.id, issue_id: group.id, project_id: group.project_id, timestamp: event.created_at,
      release: untrustedText(event.release, 120), environment: untrustedText(event.environment, 120),
      platform: untrustedText(event.platform, 120), sdk_version: untrustedText(event.sdk_version, 120),
      stack: untrustedText(occurrence.symbolicated_stack ?? bounded.stack, 8000),
      stack_truncated: (event.stack?.length ?? 0) > 16000 || (event.stack?.split("\n").length ?? 0) > maxFrames,
      symbolication_status: occurrence.symbolication_status ?? "no_maps", dashboard_url: issueDashboardUrl(group.id),
    };
  }
  server.registerTool("get_issue", { description: "Read an issue, bounded symbolicated stack, counts and releases seen. No context or identities.", inputSchema: { issue_id: z.string().uuid(), max_frames: z.number().int().min(1).max(50).default(25) }, annotations }, (args) => run("get_issue", async () => {
    const group = await loadIssue(args.issue_id);
    const [events, count24h, releases, impact] = await Promise.all([
      prisma.errorOccurrence.findMany({ where: { error_group_id: group.id }, select: eventSelect, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 5 }),
      prisma.errorOccurrence.count({ where: { error_group_id: group.id, created_at: { gte: windowStart("24h") } } }),
      prisma.errorOccurrence.groupBy({ by: ["release"], where: { error_group_id: group.id }, _count: true, _min: { created_at: true }, _max: { created_at: true }, orderBy: { _max: { created_at: "desc" } }, take: 5 }),
      fetchImpactMetricsForGroupId(prisma, group.id),
    ]);
    return { ...issueSummary(group), ...impact, occurrences_24h: count24h, releases: releases.map((r) => ({ release: untrustedText(r.release, 120), occurrences: r._count, first_seen: r._min.created_at, last_seen: r._max.created_at })), recent_event_ids: events.map((e) => e.id), latest_event: events[0] ? await eventOutput(group, events[0], args.max_frames) : null };
  }));
  server.registerTool("get_event", { description: "Read one error occurrence belonging to an authorized issue.", inputSchema: { issue_id: z.string().uuid(), event_id: z.string().uuid(), max_frames: z.number().int().min(1).max(50).default(25) }, annotations }, (args) => run("get_event", async () => {
    const group = await loadIssue(args.issue_id);
    const event = await prisma.errorOccurrence.findFirst({ where: { id: args.event_id, error_group_id: group.id }, select: eventSelect });
    if (!event) throw new Error("Event not found");
    return eventOutput(group, event, args.max_frames);
  }));
  server.registerTool("list_releases", { description: "Read release labels and error occurrence counts in a bounded window (default 24h).", inputSchema: { project_id, environment: filter, since: window, limit: z.number().int().min(1).max(20).default(10) }, annotations }, (args) => run("list_releases", async () => {
    const pid = scopedProject(auth, args.project_id);
    const releases = await prisma.errorOccurrence.groupBy({ by: ["release"], where: { error_group: { project_id: pid }, created_at: { gte: windowStart(args.since) }, release: { not: null }, ...(args.environment ? { environment: args.environment } : {}) }, _count: true, _min: { created_at: true }, _max: { created_at: true }, orderBy: { _max: { created_at: "desc" } }, take: args.limit });
    return releases.map((r) => ({ project_id: pid, release: untrustedText(r.release, 120), error_occurrences: r._count, first_seen: r._min.created_at, last_seen: r._max.created_at }));
  }));
  return server;
}
