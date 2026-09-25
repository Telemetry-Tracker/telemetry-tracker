import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPostLoginRedirectPath, resolvePostLoginPath } from "@/lib/auth-href";
import { dashboardRangeCanonicalHref } from "@/lib/dashboard-range-redirect";

/** Keep in sync with `TELEMETRY_SESSION_COOKIE` in `lib/dashboard-project.ts`. */
const SESSION_COOKIE = "telemetry_session";

function hasValidSession(request: NextRequest): boolean {
  const session = request.cookies.get(SESSION_COOKIE);
  return Boolean(session?.value && /^[0-9a-f-]{36}$/i.test(session.value));
}

function redirectToLogin(request: NextRequest, next?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (isPostLoginRedirectPath(next)) {
    url.searchParams.set("next", next);
  }
  return NextResponse.redirect(url);
}

function legacySignInNextParam(
  request: NextRequest,
  explicitNext: string | null
): string | undefined {
  if (isPostLoginRedirectPath(explicitNext)) return explicitNext;
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/register" || pathname === "/") {
    return undefined;
  }
  const params = new URLSearchParams(request.nextUrl.searchParams);
  params.delete("signIn");
  params.delete("signUp");
  const qs = params.toString();
  const destination = qs ? `${pathname}?${qs}` : pathname;
  return isPostLoginRedirectPath(destination) ? destination : undefined;
}

function redirectLegacyAuthQueryParams(request: NextRequest) {
  const signUp = request.nextUrl.searchParams.get("signUp") === "1";
  const signIn = request.nextUrl.searchParams.get("signIn") === "1";
  if (!signUp && !signIn) return null;

  const invite = request.nextUrl.searchParams.get("invite");
  const next = request.nextUrl.searchParams.get("next");
  const url = request.nextUrl.clone();
  url.search = "";

  if (signUp) {
    url.pathname = "/register";
    if (invite) url.searchParams.set("invite", invite);
    return NextResponse.redirect(url);
  }

  url.pathname = "/login";
  const nextDest = legacySignInNextParam(request, next);
  if (nextDest) url.searchParams.set("next", nextDest);
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (host === "www.telemetry-tracker.com") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "telemetry-tracker.com";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  const legacy = redirectLegacyAuthQueryParams(request);
  if (legacy) return legacy;

  if (pathname === "/login" || pathname === "/register") {
    if (hasValidSession(request)) {
      const invite = request.nextUrl.searchParams.get("invite")?.trim();
      if (pathname === "/register" && invite) {
        return NextResponse.next();
      }
      const url = request.nextUrl.clone();
      if (pathname === "/login") {
        url.pathname = resolvePostLoginPath(request.nextUrl.searchParams.get("next"));
      } else {
        url.pathname = "/dashboard/overview";
      }
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD === "true") {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  if (hasValidSession(request)) {
    const canonical = dashboardRangeCanonicalHref(pathname, request.nextUrl.search);
    if (canonical) {
      const url = request.nextUrl.clone();
      const qIndex = canonical.indexOf("?");
      url.pathname = qIndex === -1 ? canonical : canonical.slice(0, qIndex);
      url.search = qIndex === -1 ? "" : canonical.slice(qIndex);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return redirectToLogin(
    request,
    request.nextUrl.pathname + request.nextUrl.search,
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
