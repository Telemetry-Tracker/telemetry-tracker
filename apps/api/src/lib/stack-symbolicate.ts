import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { PrismaClient, SourceMapArtifact } from "@prisma/client";
import {
  getSourceMapArtifactContentById,
  listSourceMapArtifactRefsForRelease,
  MAX_SOURCE_MAP_CONTENT_LOADS_PER_DETAIL,
  MAX_SOURCE_MAP_BUNDLES_PER_RELEASE,
  normalizeBundleUrl,
  normalizeMapAppLabel,
  normalizeMapReleaseLabel,
  type SourceMapArtifactRef,
} from "./source-map-artifact.js";

export type ParsedStackFrame = {
  raw: string;
  /** File or URL from the frame, when parseable. */
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
};

const V8_WITH_FN =
  /^(\s*at\s+)(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const V8_NO_FN = /^(\s*at\s+)(.+?):(\d+):(\d+)\s*$/;
const FIREFOX = /^(\s*)(.+?)@(.+?):(\d+):(\d+)\s*$/;

export function parseStackFrame(line: string): ParsedStackFrame {
  const v8Fn = line.match(V8_WITH_FN);
  if (v8Fn) {
    return {
      raw: line,
      functionName: v8Fn[2],
      file: v8Fn[3].replace(/^address at /, ""),
      line: Number(v8Fn[4]),
      column: Number(v8Fn[5]),
    };
  }
  const v8NoFn = line.match(V8_NO_FN);
  if (v8NoFn) {
    return {
      raw: line,
      file: v8NoFn[2].replace(/^address at /, ""),
      line: Number(v8NoFn[3]),
      column: Number(v8NoFn[4]),
    };
  }
  const firefox = line.match(FIREFOX);
  if (firefox) {
    return {
      raw: line,
      functionName: firefox[2],
      file: firefox[3],
      line: Number(firefox[4]),
      column: Number(firefox[5]),
    };
  }
  return { raw: line };
}

export function frameMatchesBundle(frameFile: string, bundleUrl: string): boolean {
  const frame = normalizeBundleUrl(frameFile);
  const bundle = normalizeBundleUrl(bundleUrl);
  if (frame === bundle) return true;

  const isHttp = (value: string) => /^https?:\/\//i.test(value);
  if (isHttp(frame) && isHttp(bundle)) {
    try {
      const a = new URL(frame);
      const b = new URL(bundle);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch {
      return false;
    }
  }

  // Native URL hosts can themselves be the filename (assets://index.android.bundle).
  const basename = (value: string) => value.replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
    .split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
  const frameBase = basename(frame);
  return frameBase.length > 0 && frameBase === basename(bundle);
}

export function findMatchingArtifact(
  frameFile: string,
  artifacts: Pick<SourceMapArtifact, "bundle_url" | "content">[]
): Pick<SourceMapArtifact, "bundle_url" | "content"> | null {
  const matches = artifacts.filter((artifact) => frameMatchesBundle(frameFile, artifact.bundle_url));
  return matches.length === 1 ? matches[0] : null;
}

export function findMatchingArtifactRef(
  frameFile: string,
  refs: SourceMapArtifactRef[]
): SourceMapArtifactRef | null {
  const matches = refs.filter((ref) => frameMatchesBundle(frameFile, ref.bundle_url));
  return matches.length === 1 ? matches[0] : null;
}

function formatSymbolicatedLine(
  frame: ParsedStackFrame,
  source: string | null | undefined,
  line: number | null | undefined,
  column: number | null | undefined,
  name: string | null | undefined
): string {
  const loc =
    source != null && line != null
      ? `${source}:${line}${column != null ? `:${column}` : ""}`
      : null;
  if (!loc) return frame.raw;

  const fn = name ?? frame.functionName;
  const v8Fn = frame.raw.match(V8_WITH_FN);
  if (v8Fn) {
    const fnLabel = fn ?? "<anonymous>";
    return `${v8Fn[1]}${fnLabel} (${loc})`;
  }
  const v8NoFn = frame.raw.match(V8_NO_FN);
  if (v8NoFn) {
    return `${v8NoFn[1]}${loc}`;
  }
  const firefox = frame.raw.match(FIREFOX);
  if (firefox) {
    const fnLabel = fn ?? firefox[2];
    return `${firefox[1]}${fnLabel}@${loc}`;
  }
  return frame.raw;
}

/** Symbolicate a stack string using uploaded source maps. Returns input when nothing resolves. */
export function symbolicateStackTrace(
  stack: string,
  artifacts: Pick<SourceMapArtifact, "bundle_url" | "content">[]
): string {
  if (!stack.trim() || artifacts.length === 0) return stack;

  const lines = stack.split(/\r?\n/);
  let changed = false;
  const out = lines.map((line) => {
    const frame = parseStackFrame(line);
    if (frame.file == null || frame.line == null || frame.column == null) {
      return line;
    }
    const artifact = findMatchingArtifact(frame.file, artifacts);
    if (!artifact) return line;

    let map: TraceMap;
    try {
      map = new TraceMap(JSON.parse(artifact.content));
    } catch {
      return line;
    }

    const orig = originalPositionFor(map, {
      line: frame.line,
      column: Math.max(0, frame.column),
    });
    if (orig.source == null && orig.line == null) return line;

    const next = formatSymbolicatedLine(frame, orig.source, orig.line, orig.column, orig.name);
    if (next !== line) changed = true;
    return next;
  });

  return changed ? out.join("\n") : stack;
}

/** First resolvable frame line in a stack, symbolicated when a map exists. */
export function firstSymbolicatedFrameLine(
  stack: string,
  artifacts: Pick<SourceMapArtifact, "bundle_url" | "content">[]
): string | null {
  for (const line of stack.split(/\r?\n/)) {
    const frame = parseStackFrame(line);
    if (frame.file == null || frame.line == null || frame.column == null) continue;
    const symbolicated = symbolicateStackTrace(line, artifacts);
    if (symbolicated !== line) return symbolicated;
  }
  return null;
}

function createSymbolicateContext(
  prisma: PrismaClient,
  projectId: string,
  app: string
) {
  const refsByRelease = new Map<string, Promise<SourceMapArtifactRef[]>>();
  const contentById = new Map<string, Pick<SourceMapArtifact, "bundle_url" | "content">>();
  const contentPending = new Map<
    string,
    Promise<Pick<SourceMapArtifact, "bundle_url" | "content"> | null>
  >();
  let contentLoads = 0;

  async function refsForRelease(release: string): Promise<SourceMapArtifactRef[]> {
    let load = refsByRelease.get(release);
    if (!load) {
      load = listSourceMapArtifactRefsForRelease(prisma, projectId, app, release);
      refsByRelease.set(release, load);
    }
    return load;
  }

  /** Reserve and share in-flight content loads (singleflight) so concurrent occurrence work cannot exceed the cap or duplicate fetches. */
  function loadArtifactContent(
    ref: SourceMapArtifactRef
  ): Promise<Pick<SourceMapArtifact, "bundle_url" | "content"> | null> | null {
    const cached = contentById.get(ref.id);
    if (cached) return Promise.resolve(cached);

    const inFlight = contentPending.get(ref.id);
    if (inFlight) return inFlight;

    if (contentLoads >= MAX_SOURCE_MAP_CONTENT_LOADS_PER_DETAIL) {
      return null;
    }
    contentLoads += 1;

    const pending = getSourceMapArtifactContentById(prisma, ref.id).then((row) => {
      contentPending.delete(ref.id);
      if (row) contentById.set(ref.id, row);
      return row;
    });
    contentPending.set(ref.id, pending);
    return pending;
  }

  async function artifactsForStack(
    stack: string,
    release: string
  ): Promise<Pick<SourceMapArtifact, "bundle_url" | "content">[]> {
    const refs = await refsForRelease(release);
    // A capped list cannot prove basename uniqueness; refuse to guess.
    if (refs.length === 0 || refs.length >= MAX_SOURCE_MAP_BUNDLES_PER_RELEASE) return [];

    const artifacts: Pick<SourceMapArtifact, "bundle_url" | "content">[] = [];
    const seenIds = new Set<string>();

    for (const line of stack.split(/\r?\n/)) {
      const frame = parseStackFrame(line);
      if (frame.file == null) continue;

      const ref = findMatchingArtifactRef(frame.file, refs);
      if (!ref || seenIds.has(ref.id)) continue;
      seenIds.add(ref.id);

      const load = loadArtifactContent(ref);
      if (!load) break;
      const artifact = await load;
      if (!artifact) continue;
      artifacts.push(artifact);
    }

    return artifacts;
  }

  return { artifactsForStack, refsForRelease };
}

export async function symbolicateOccurrenceStack(
  prisma: PrismaClient,
  projectId: string,
  app: string,
  release: string | null | undefined,
  stack: string | null | undefined
): Promise<string | null> {
  const releaseLabel = normalizeMapReleaseLabel(release);
  const stackText = stack?.trim();
  if (!releaseLabel || !stackText) return null;

  const { artifactsForStack } = createSymbolicateContext(
    prisma,
    projectId,
    normalizeMapAppLabel(app)
  );
  const artifacts = await artifactsForStack(stackText, releaseLabel);
  if (artifacts.length === 0) return null;

  const symbolicated = symbolicateStackTrace(stackText, artifacts);
  return symbolicated === stackText ? null : symbolicated;
}

export type SymbolicationStatus = "symbolicated" | "no_maps" | "no_match";

type ErrorGroupWithOccurrences = {
  app: string;
  release?: string | null;
  top_stack?: string | null;
  occurrences_list: Array<{
    stack?: string | null;
    release?: string | null;
    symbolicated_stack?: string | null;
    symbolication_status?: SymbolicationStatus;
    [key: string]: unknown;
  }>;
  symbolicated_top_stack?: string | null;
  [key: string]: unknown;
};

export async function enrichErrorGroupWithSymbolicatedStacks<
  T extends ErrorGroupWithOccurrences,
>(prisma: PrismaClient, projectId: string, group: T): Promise<T> {
  const app = normalizeMapAppLabel(group.app);
  const { artifactsForStack, refsForRelease } = createSymbolicateContext(prisma, projectId, app);

  const newest = group.occurrences_list[0];
  let symbolicatedTop: string | null = null;
  if (newest?.stack?.trim()) {
    const newestRelease = normalizeMapReleaseLabel(newest.release ?? group.release);
    if (newestRelease) {
      const artifacts = await artifactsForStack(newest.stack, newestRelease);
      symbolicatedTop = firstSymbolicatedFrameLine(newest.stack, artifacts);
    }
  }

  const occurrences_list: T["occurrences_list"] = [];
  for (const occ of group.occurrences_list) {
    const release = normalizeMapReleaseLabel(occ.release ?? group.release);
    if (!occ.stack?.trim() || !release) {
      occurrences_list.push(occ);
      continue;
    }
    const refs = await refsForRelease(release);
    if (refs.length === 0) {
      occurrences_list.push({ ...occ, symbolication_status: "no_maps" });
      continue;
    }
    const artifacts = await artifactsForStack(occ.stack, release);
    const symbolicated = symbolicateStackTrace(occ.stack, artifacts);
    if (symbolicated === occ.stack) {
      occurrences_list.push({ ...occ, symbolication_status: "no_match" });
      continue;
    }
    occurrences_list.push({
      ...occ,
      symbolicated_stack: symbolicated,
      symbolication_status: "symbolicated",
    });
  }

  return {
    ...group,
    ...(symbolicatedTop ? { symbolicated_top_stack: symbolicatedTop } : {}),
    occurrences_list,
  };
}
