"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  createDashboardApiKey,
  fetchDashboardProjectAppStatus,
  registerDashboardProjectApp,
  type ProjectAppDto,
} from "@/app/dashboard/actions";
import {
  CONNECT_APP_FRAMEWORKS,
  connectAppSnippets,
  frameworkDocsHref,
  frameworkLabel,
  type ConnectAppFrameworkId,
} from "@/lib/connect-app-setup";
import { searchInputClassName } from "@/lib/input-classes";
import { cn } from "@/lib/utils";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Step = "details" | "key" | "install" | "waiting";

const STEPS: { id: Step; label: string }[] = [
  { id: "details", label: "Application" },
  { id: "key", label: "API key" },
  { id: "install", label: "Install SDK" },
  { id: "waiting", label: "Verify" },
];

export function ConnectApplicationClient({
  initialApps,
  initialKeys,
  resumeApp,
  canCreate,
}: {
  initialApps: ProjectAppDto[];
  initialKeys: { publicId: string; name: string | null; allowedApp: string | null; revokedAt: string | null }[];
  resumeApp: string | null;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const resumed = resumeApp
    ? initialApps.find((a) => a.name === resumeApp) ?? null
    : null;

  const [step, setStep] = useState<Step>(resumed ? (resumed.connected ? "waiting" : "install") : "details");
  const [name, setName] = useState(resumed?.name ?? "");
  const [framework, setFramework] = useState<ConnectAppFrameworkId | "">(
    (resumed?.framework as ConnectAppFrameworkId) || "nextjs"
  );
  const [app, setApp] = useState<ProjectAppDto | null>(resumed);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [useExistingKey, setUseExistingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const activeKeys = useMemo(
    () => initialKeys.filter((k) => !k.revokedAt),
    [initialKeys]
  );

  const snippets = useMemo(
    () =>
      connectAppSnippets(framework || app?.framework, {
        appName: app?.name || name.trim() || "my-app",
        apiKey,
      }),
    [apiKey, app?.framework, app?.name, framework, name]
  );

  const onRegister = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter an application name (this becomes the SDK app value).");
      return;
    }
    if (!framework) {
      setError("Choose a framework so we can show the right setup steps.");
      return;
    }
    startTransition(async () => {
      const result = await registerDashboardProjectApp({
        name: trimmed,
        framework,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApp(result.app);
      setStep(activeKeys.length > 0 ? "key" : "key");
      router.refresh();
    });
  };

  const onCreateKey = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", `${app?.name || name.trim() || "app"} ingest`);
      if (app?.name) formData.set("allowedApp", app.name);
      const result = await createDashboardApiKey(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApiKey(result.key);
      setUseExistingKey(false);
      setStep("install");
      router.refresh();
    });
  };

  const onSkipKey = () => {
    setUseExistingKey(true);
    setApiKey(null);
    setStep("install");
  };

  const refreshStatus = useCallback(async () => {
    if (!app?.name) return;
    const result = await fetchDashboardProjectAppStatus(app.name);
    if (result.ok) {
      setApp(result.app);
      if (result.app.connected) {
        setPolling(false);
        toast.success("First telemetry received — you’re connected.");
        router.refresh();
      }
    }
  }, [app?.name, router]);

  useEffect(() => {
    if (step !== "waiting" || !app?.name || app.connected) return;
    setPolling(true);
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 4000);
    void refreshStatus();
    return () => window.clearInterval(id);
  }, [app?.connected, app?.name, refreshStatus, step]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ol className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-full border px-2.5 py-1",
                active && "border-brand text-foreground",
                done && "border-border text-foreground/80",
                !active && !done && "border-border/60"
              )}
            >
              {i + 1}. {s.label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {step === "details" ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">Connect an application</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An <strong className="font-medium text-foreground">application</strong> is the SDK{" "}
            <code className="text-foreground">app</code> label (e.g. <code className="text-foreground">web</code>,{" "}
            <code className="text-foreground">api</code>). It belongs to the project selected in the header.
            You do not need to send telemetry first — register it here, then install the SDK.
          </p>

          <label className="mt-5 block text-sm font-medium text-foreground">
            Application name
            <input
              className={cn("mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2", searchInputClassName)}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-next-app"
              maxLength={128}
              autoFocus
            />
          </label>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Use the same string in your SDK <code className="text-foreground">app</code> /{" "}
            <code className="text-foreground">TELEMETRY_APP</code> config.
          </p>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-foreground">Framework</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CONNECT_APP_FRAMEWORKS.map((f) => (
                <label
                  key={f.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    framework === f.id ? "border-brand bg-brand/5" : "border-border hover:bg-surface"
                  )}
                >
                  <input
                    type="radio"
                    name="framework"
                    value={f.id}
                    checked={framework === f.id}
                    onChange={() => setFramework(f.id)}
                    className="accent-[var(--brand)]"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>

          {!canCreate ? (
            <p className="mt-4 text-sm text-muted-foreground">
              You need Editor or Owner permission to connect applications.
            </p>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={onRegister}
              className="mt-5 inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60"
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continue
            </button>
          )}

          {initialApps.length > 0 ? (
            <div className="mt-8 border-t border-border pt-5">
              <h3 className="text-sm font-medium text-foreground">Existing applications</h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {initialApps.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{a.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {frameworkLabel(a.framework)} · {a.connected ? "Connected" : "Waiting for first event"}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/apps/connect?app=${encodeURIComponent(a.name)}`}
                      className="shrink-0 text-[13px] text-brand hover:underline"
                    >
                      Setup
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "key" && app ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">API key for {app.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keys authenticate ingest for this <strong className="font-medium text-foreground">project</strong>.
            Creating a key is not the same as creating an application — you already registered{" "}
            <code className="text-foreground">{app.name}</code>.
          </p>

          {activeKeys.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              This project already has {activeKeys.length} active key
              {activeKeys.length === 1 ? "" : "s"}. You can reuse one or create a key scoped to this app.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No active keys yet. Create one to finish SDK setup (shown once).
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !canCreate}
              onClick={onCreateKey}
              className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60"
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create key for this app
            </button>
            {activeKeys.length > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={onSkipKey}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                I already have a key
              </button>
            ) : null}
            <Link href="/dashboard/settings/keys" className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              Manage keys
            </Link>
          </div>
        </section>
      ) : null}

      {(step === "install" || step === "waiting") && app ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">
            Install {frameworkLabel(framework || app.framework)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use app name <code className="text-foreground">{app.name}</code>. Full guide:{" "}
            <Link
              href={frameworkDocsHref(framework || app.framework)}
              className="text-brand hover:underline"
              target="_blank"
            >
              {frameworkDocsHref(framework || app.framework)}
            </Link>
          </p>

          {apiKey ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">Copy your new key now — it won’t be shown again.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px]">
                  {apiKey}
                </code>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm"
                  onClick={() => void copyText("API key", apiKey)}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
            </div>
          ) : useExistingKey ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Paste an existing project API key into your env file. Manage keys under{" "}
              <Link href="/dashboard/settings/keys" className="text-brand hover:underline">
                Settings → API keys
              </Link>
              .
            </p>
          ) : null}

          {(
            [
              ["Install", snippets.install],
              ["Configure", snippets.configure],
              ["Send a test event", snippets.verify],
            ] as const
          ).map(([label, code]) => (
            <div key={label} className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">{label}</h3>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => void copyText(label, code)}
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground">
                {code}
              </pre>
            </div>
          ))}

          <div className="mt-5 flex flex-wrap gap-2">
            {step === "install" ? (
              <button
                type="button"
                onClick={() => setStep("waiting")}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
              >
                I’ve installed the SDK — wait for first event
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setStep("details")}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
            >
              Back
            </button>
          </div>
        </section>
      ) : null}

      {step === "waiting" && app ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">Waiting for first telemetry</h2>
          {app.connected ? (
            <div className="mt-3 flex items-start gap-2 text-sm text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <p>
                  <strong>{app.name}</strong> is connected
                  {app.firstEventAt
                    ? ` (first event ${new Date(app.firstEventAt).toLocaleString()})`
                    : ""}
                  .
                </p>
                <Link
                  href={`/dashboard/overview?app=${encodeURIComponent(app.name)}`}
                  className="mt-2 inline-block text-brand hover:underline"
                >
                  Open overview for this app
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                {polling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Listening for events, sessions, or errors with{" "}
                <code className="text-foreground">app={app.name}</code>…
              </p>
              <p className="mt-2">
                Send <code className="text-foreground">trackEvent(&quot;app_connected&quot;)</code> from your
                app, then wait a few seconds. This page polls automatically.
              </p>
              <button
                type="button"
                className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm"
                onClick={() => void refreshStatus()}
              >
                Check now
              </button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
