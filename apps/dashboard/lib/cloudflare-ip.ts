import { isIP } from "node:net";

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
  return ip.split(".").reduce((value, part) => (value << BigInt(8)) | BigInt(part), BigInt(0));
}

function ipValue(ip: string): { value: bigint; bits: number } {
  if (isIP(ip) === 4) return { value: ipv4Value(ip), bits: 32 };
  // isIP also accepts scoped IPv6; the scope is local routing metadata.
  let address = ip.split("%")[0];
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const tail = ipv4Value(address.slice(lastColon + 1));
    address = `${address.slice(0, lastColon)}:${(tail >> BigInt(16)).toString(16)}:${(tail & BigInt(65535)).toString(16)}`;
  }
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  const value = parts.reduce((acc, part) => (acc << BigInt(16)) | BigInt(`0x${part}`), BigInt(0));
  if (value >> BigInt(32) === BigInt(65535)) return { value: value & BigInt("0xffffffff"), bits: 32 };
  return { value, bits: 128 };
}

function canonicalIp(ip: string): string {
  const { value, bits } = ipValue(ip);
  if (bits === 32) return [BigInt(24), BigInt(16), BigInt(8), BigInt(0)].map((shift) => String((value >> shift) & BigInt(255))).join(".");
  return Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & BigInt(65535)).toString(16)).join(":");
}

export function singleIp(raw: string | string[] | undefined): string | undefined {
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

