import { apiFetch } from "@/lib/api-fetch";
import { API_BASE_URL } from "@/lib/api-url";
import { getDashboardSessionId } from "@/lib/dashboard-project";

const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const { userId } = await context.params;
  const trimmed = userId.trim().toLowerCase();
  if (!USER_ID_RE.test(trimmed)) {
    return new Response("Invalid user id", { status: 400 });
  }

  const sessionId = await getDashboardSessionId();
  if (!sessionId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const version = new URL(request.url).searchParams.get("v");
  const path = version
    ? `/api/auth/avatars/${trimmed}?v=${encodeURIComponent(version)}`
    : `/api/auth/avatars/${trimmed}`;

  const upstream = await apiFetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${sessionId}` },
  });

  if (!upstream.ok) {
    return new Response(upstream.statusText || "Avatar not found", {
      status: upstream.status,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const cacheControl = upstream.headers.get("cache-control") ?? "private, max-age=3600";
  const body = await upstream.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
  });
}
