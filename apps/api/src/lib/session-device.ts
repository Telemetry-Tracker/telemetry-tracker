/** Best-effort browser/OS hints from a User-Agent string (no UA parser dependency). */

export type SessionDeviceHints = {
  userAgent?: string;
  deviceBrowser?: string;
  deviceOs?: string;
};

function parseBrowser(ua: string): string | undefined {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  return undefined;
}

function parseOs(ua: string): string | undefined {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/(iPhone|iPad|iPod)/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux/i.test(ua)) return "Linux";
  return undefined;
}

export function sessionDeviceFromUserAgent(raw: string | undefined): SessionDeviceHints {
  if (!raw || typeof raw !== "string") return {};
  const userAgent = raw.slice(0, 512);
  return {
    userAgent,
    deviceBrowser: parseBrowser(userAgent),
    deviceOs: parseOs(userAgent),
  };
}
