import Link from "next/link";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { ErrorState } from "@/app/components/ErrorState";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { ConnectApplicationClient } from "./ConnectApplicationClient";
import type { ProjectAppDto } from "@/app/dashboard/actions";

export const dynamic = "force-dynamic";

type AppsResponse = {
  apps: ProjectAppDto[];
};

type KeysResponse = {
  keys: {
    publicId: string;
    name: string | null;
    allowedApp?: string | null;
    revokedAt: string | null;
  }[];
};

type ConnectKeyRow = {
  publicId: string;
  name: string | null;
  allowedApp: string | null;
  revokedAt: string | null;
};

async function load(): Promise<
  | {
      ok: true;
      apps: ProjectAppDto[];
      keys: ConnectKeyRow[];
    }
  | { ok: false; message: string }
> {
  const [appsRes, keysRes] = await Promise.all([
    dashboardApiFetch("/api/project/apps"),
    dashboardApiFetch("/api/project/api-keys"),
  ]);
  if (!appsRes.ok) {
    const t = await appsRes.text();
    return { ok: false, message: `Could not load apps (${appsRes.status}): ${t.slice(0, 200)}` };
  }
  if (!keysRes.ok) {
    const t = await keysRes.text();
    return { ok: false, message: `Could not load keys (${keysRes.status}): ${t.slice(0, 200)}` };
  }
  const appsData = (await appsRes.json()) as AppsResponse;
  const keysData = (await keysRes.json()) as KeysResponse;
  return {
    ok: true,
    apps: appsData.apps ?? [],
    keys: (keysData.keys ?? []).map((k) => ({
      publicId: k.publicId,
      name: k.name,
      allowedApp: k.allowedApp ?? null,
      revokedAt: k.revokedAt,
    })),
  };
}

export default async function ConnectApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string }>;
}) {
  const params = await searchParams;
  const resumeApp = typeof params.app === "string" ? params.app.trim() : null;
  const loaded = await load();

  if (!loaded.ok) {
    return (
      <>
        <SettingsPageHeader
          title="Connect application"
          description="Register an SDK app on this project, create a key, and verify your first event."
        />
        <ErrorState message={loaded.message} />
      </>
    );
  }

  return (
    <>
      <SettingsPageHeader
        title="Connect application"
        description="Projects hold telemetry. Applications are SDK app labels inside a project. API keys authenticate ingest (optionally scoped to one app)."
      />
      <p className="mb-6 -mt-4 text-sm text-muted-foreground">
        <Link href="/dashboard/settings/keys" className="text-brand hover:underline">
          Manage API keys
        </Link>
        {" · "}
        <Link href="/docs/sdk" className="text-brand hover:underline">
          SDK docs
        </Link>
      </p>
      <ConnectApplicationClient
        initialApps={loaded.apps}
        initialKeys={loaded.keys}
        resumeApp={resumeApp}
        canCreate
      />
    </>
  );
}
