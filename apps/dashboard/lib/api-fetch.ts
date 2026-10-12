/** Use only for requests to the fixed API origin. Forwarding credentials stay on the server. */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const outgoing = new Headers(init?.headers);
  outgoing.delete("x-tt-client-ip");
  outgoing.delete("x-tt-client-ip-secret");
  if (typeof window === "undefined") {
    const secret = process.env.AFFILIATE_CLIENT_IP_FORWARD_SECRET;
    if (secret) {
      const [{ headers }, { clientIpFromHeaders }] = await Promise.all([
        import("next/headers"),
        import("./request-client-ip"),
      ]);
      let ip: string | null | undefined;
      try {
        ip = clientIpFromHeaders(await headers());
      } catch {
        // Outside a request scope (build, static render, background work): send without forwarding.
        ip = undefined;
      }
      if (ip) {
        outgoing.set("x-tt-client-ip", ip);
        outgoing.set("x-tt-client-ip-secret", secret);
      }
    }
  }
  return fetch(input, { ...init, headers: outgoing });
}
