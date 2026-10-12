/** Separate from ingest quota. Per-process limits, matching existing ingest
 * throttling; shared rate limiting is needed for strict multi-replica caps. */
export class CheckInRateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  consume(monitorId: string, projectId: string, now = Date.now()): boolean {
    // Expire buckets periodically; only authenticated monitor/project IDs enter.
    for (const [key, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(key);
    const keys = [[`m:${monitorId}`, 12], [`p:${projectId}`, 600]] as const;
    for (const [key, max] of keys) if ((this.buckets.get(key)?.count ?? 0) >= max) return false;
    for (const [key] of keys) {
      const bucket = this.buckets.get(key) ?? { count: 0, until: now + 60_000 };
      bucket.count++;
      this.buckets.set(key, bucket);
    }
    return true;
  }
}
export function isCheckInPreviewBot(agent: string): boolean {
  return /slackbot|discordbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|skypeuripreview|microsoftpreview|googlebot|bingbot|applebot|mattermost|iframely|embedly/i.test(agent);
}
