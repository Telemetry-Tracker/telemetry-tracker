import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";

type IpRequest = { ip: string; headers: Record<string, string | string[] | undefined> };
type IpSource = "cf" | "railway" | "socket";

// Cloudflare published ranges, verified 2026-10-12:
// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
export const CLOUDFLARE_CIDRS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
] as const;

function ipv4Value(ip: string): bigint {
  return ip.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipValue(ip: string): { value: bigint; bits: number } {
  if (isIP(ip) === 4) return { value: ipv4Value(ip), bits: 32 };
  // isIP also accepts scoped IPv6; the scope is local routing metadata.
  let address = ip.split("%")[0];
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const tail = ipv4Value(address.slice(lastColon + 1));
    address = `${address.slice(0, lastColon)}:${(tail >> 16n).toString(16)}:${(tail & 65535n).toString(16)}`;
  }
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  const value = parts.reduce((acc, part) => (acc << 16n) | BigInt(`0x${part}`), 0n);
  if (value >> 32n === 65535n) return { value: value & 0xffffffffn, bits: 32 };
  return { value, bits: 128 };
}

function canonicalIp(ip: string): string {
  const { value, bits } = ipValue(ip);
  if (bits === 32) return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");
  return Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & 65535n).toString(16)).join(":");
}

function singleIp(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string" || isIP(raw.trim()) === 0) return undefined;
  return canonicalIp(raw.trim());
}

const cloudflareRanges = CLOUDFLARE_CIDRS.map((cidr) => {
  const [address, prefix] = cidr.split("/");
  return { ...ipValue(address), prefix: Number(prefix) };
});

export function isCloudflareIp(ip: string): boolean {
  if (!isIP(ip)) return false;
  const candidate = ipValue(ip);
  return cloudflareRanges.some(({ value, bits, prefix }) => bits === candidate.bits &&
    candidate.value >> BigInt(bits - prefix) === value >> BigInt(bits - prefix));
}

export function resolveClientIpDetails(request: IpRequest, env: NodeJS.ProcessEnv = process.env): { ip: string; source: IpSource } {
  const trustRailway = env.TRUST_RAILWAY_EDGE === "true" ||
    (env.TRUST_RAILWAY_EDGE === undefined && env.NODE_ENV === "production");
  const railwayIp = trustRailway ? singleIp(request.headers["x-real-ip"]) : undefined;
  const base = railwayIp ?? singleIp(request.ip) ?? request.ip;
  const source = railwayIp ? "railway" : "socket";
  const visitor = isCloudflareIp(base) ? singleIp(request.headers["cf-connecting-ip"]) : undefined;
  return visitor ? { ip: visitor, source: "cf" } : { ip: base, source };
}

export function resolveClientIp(request: IpRequest, env: NodeJS.ProcessEnv = process.env): string {
  return resolveClientIpDetails(request, env).ip;
}

export const clientIpKeyGenerator = (request: IpRequest): string => resolveClientIp(request);

/** Partition by the API key's public ID without logging or retaining its secret. */
export function ingestKeyGenerator(request: IpRequest): string {
  const auth = request.headers.authorization;
  const xKey = request.headers["x-api-key"];
  const token = typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim() : typeof xKey === "string" ? xKey.trim() : "";
  const publicId = /^tt_live_([a-f0-9]{32})_[a-f0-9]+$/i.exec(token)?.[1].toLowerCase();
  return JSON.stringify([clientIpKeyGenerator(request), publicId ?? ""]);
}

export function registerIpDiagnostics(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    if (process.env.IP_DIAGNOSTIC_LOG !== "true") return;
    const resolved = resolveClientIpDetails(request);
    request.log.info({
      socketIp: request.raw.socket.remoteAddress,
      xRealIp: request.headers["x-real-ip"],
      xForwardedFor: request.headers["x-forwarded-for"],
      cfConnectingIp: request.headers["cf-connecting-ip"],
      xEnvoyExternalAddress: request.headers["x-envoy-external-address"],
      resolvedIp: resolved.ip,
      source: resolved.source,
    }, "Client IP diagnostic");
  });
}
