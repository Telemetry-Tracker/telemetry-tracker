import { dashboardApiFetch } from "@/lib/dashboard-api";

const ALLOWED_ROOTS = new Set(["sessions", "events", "errors"]);
const SAFE_SEGMENT_RE = /^[a-z]+$/;
const RESOURCE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAllowedTelemetryPath(path: string[]): boolean {
  if (path.length === 1) {
    return SAFE_SEGMENT_RE.test(path[0]!) && ALLOWED_ROOTS.has(path[0]!);
  }
  if (path.length === 2) {
    return (
      SAFE_SEGMENT_RE.test(path[0]!) &&
      ALLOWED_ROOTS.has(path[0]!) &&
      path[1] === "analytics"
    );
  }
  if (path.length === 3) {
    return (
      path[0] === "errors" &&
      RESOURCE_ID_RE.test(path[1]!) &&
      path[2] === "export"
    );
  }
  return false;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await context.params;
  if (!isAllowedTelemetryPath(path)) {
    return new Response("Not found", { status: 404 });
  }

  const search = new URL(request.url).search;
  const apiPath = `/api/${path.join("/")}${search}`;
  const upstream = await dashboardApiFetch(apiPath);
  const body = await upstream.text();

  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
  };
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers["Content-Disposition"] = disposition;

  return new Response(body, {
    status: upstream.status,
    headers,
  });
}
