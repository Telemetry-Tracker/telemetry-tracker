export type ProjectAlertEmailRole = "OWNER" | "EDITOR" | "VIEWER";

export type ProjectAlertEmailSettings = {
  enabled: boolean;
  roles: ProjectAlertEmailRole[];
  additionalEmails: string[];
};

export type ProjectAlertSettings = {
  errorSpike: {
    enabled: boolean;
    threshold: number;
    windowMinutes: number;
  };
  quota: {
    enabled: boolean;
    nearPercent: number;
  };
  email: ProjectAlertEmailSettings;
};

export type AlertEventRow = {
  id: string;
  rule: "CHECKIN_DOWN" | "CHECKIN_RECOVERED" | "ERROR_SPIKE" | "QUOTA_NEAR" | "QUOTA_EXCEEDED" | "ALERT_RULE";
  title: string;
  body: string;
  href: string | null;
  firedAt: string;
};

export const DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS: ProjectAlertEmailSettings = {
  enabled: true,
  roles: ["OWNER", "EDITOR"],
  additionalEmails: [],
};

export const DEFAULT_PROJECT_ALERT_SETTINGS: ProjectAlertSettings = {
  errorSpike: {
    enabled: true,
    threshold: 25,
    windowMinutes: 15,
  },
  quota: {
    enabled: true,
    nearPercent: 90,
  },
  email: { ...DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS },
};

function isEmailRole(value: unknown): value is ProjectAlertEmailRole {
  return value === "OWNER" || value === "EDITOR" || value === "VIEWER";
}

function parseEmailSettings(raw: unknown): ProjectAlertEmailSettings {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled !== "boolean" || !Array.isArray(o.roles)) {
    return { ...DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS };
  }
  const roles = o.roles.filter(isEmailRole);
  if (roles.length === 0) {
    return { ...DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS };
  }
  const additionalEmails = Array.isArray(o.additionalEmails)
    ? [
        ...new Set(
          o.additionalEmails
            .filter((e): e is string => typeof e === "string")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.includes("@"))
        ),
      ].slice(0, 10)
    : [];
  return {
    enabled: o.enabled,
    roles: [...new Set(roles)],
    additionalEmails,
  };
}

function isSettings(value: unknown): value is Omit<ProjectAlertSettings, "email"> & {
  email?: unknown;
} {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  const es = o.errorSpike;
  const q = o.quota;
  if (typeof es !== "object" || es === null || typeof q !== "object" || q === null) {
    return false;
  }
  const spike = es as Record<string, unknown>;
  const quota = q as Record<string, unknown>;
  return (
    typeof spike.enabled === "boolean" &&
    typeof spike.threshold === "number" &&
    typeof spike.windowMinutes === "number" &&
    typeof quota.enabled === "boolean" &&
    typeof quota.nearPercent === "number"
  );
}

export function parseProjectAlertSettings(raw: unknown): ProjectAlertSettings {
  if (!isSettings(raw)) return { ...DEFAULT_PROJECT_ALERT_SETTINGS, email: { ...DEFAULT_PROJECT_ALERT_EMAIL_SETTINGS } };
  return {
    errorSpike: raw.errorSpike,
    quota: raw.quota,
    email: parseEmailSettings(raw.email),
  };
}

export function alertSettingsEqual(a: ProjectAlertSettings, b: ProjectAlertSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatAdditionalEmailsInput(emails: string[]): string {
  return emails.join("\n");
}

export function parseAdditionalEmailsInput(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@") && e.length <= 254)
    ),
  ].slice(0, 10);
}

export function ruleLabel(rule: AlertEventRow["rule"]): string {
  switch (rule) {
    case "CHECKIN_DOWN":
      return "Check-in down";
    case "CHECKIN_RECOVERED":
      return "Check-in recovered";
    case "ERROR_SPIKE":
      return "Error spike";
    case "QUOTA_NEAR":
      return "Quota warning";
    case "QUOTA_EXCEEDED":
      return "Quota exceeded";
    case "ALERT_RULE":
      return "Alert rule";
    default:
      return rule;
  }
}
