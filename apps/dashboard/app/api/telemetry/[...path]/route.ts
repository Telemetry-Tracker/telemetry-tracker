import { dashboardApiFetch } from "@/lib/dashboard-api";
import { isAllowedTelemetryProxyPath } from "@/lib/telemetry-proxy-path";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await context.params;
  if (!isAllowedTelemetryProxyPath(path)) {
    return new Response("Not found", { status: 404 });
  }

  const search = new URL(request.url).search;
  const apiPath = `/api/${path.join("/")}${search}`;
  const upstream = await dashboardApiFetch(apiPath);
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
