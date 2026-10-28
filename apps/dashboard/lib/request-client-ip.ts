/** Railway edge identity; only Cloudflare peers may supply a visitor IP. Never trust XFF. */
import { isCloudflareIp, singleIp } from "./cloudflare-ip";

export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const edge = singleIp(headers.get("x-real-ip") ?? undefined);
  if (!edge) return null;
  return (isCloudflareIp(edge) ? singleIp(headers.get("cf-connecting-ip") ?? undefined) : undefined) ?? edge;
}
