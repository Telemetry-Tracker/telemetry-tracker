"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createDashboardApiKey,
  fetchDashboardProjectAppStatus,
  registerDashboardProjectApp,
  type ProjectAppDto,
} from "@/app/dashboard/actions";
import {
  CONNECT_APP_FRAMEWORKS,
  connectAppHref,
  connectAppSnippets,
  frameworkDocsHref,
  frameworkLabel,
  resumeStepForApp,
  type ConnectAppFrameworkId,
  type ConnectWizardStep,
} from "@/lib/connect-app-setup";
import { searchInputClassName } from "@/lib/input-classes";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Step = ConnectWizardStep;

const STEPS: { id: Step; label: string }[] = [
  { id: "details", label: "Application" },
  { id: "key", label: "API key" },
  { id: "install", label: "Install SDK" },
  { id: "waiting", label: "Verify" },
];

const VERIFY_TIMEOUT_MS = 90_000;
const VERIFY_POLL_MS = 4_000;

type VerifyState = "idle" | "waiting" | "success" | "timeout" | "error";

function compatibleKeysForApp(
  keys: { publicId: string; name: string | null; allowedApp: string | null; revokedAt: string | null }[],
  appName: string
) {
  return keys.filter(
    (k) => !k.revokedAt && (k.allowedApp == null || k.allowedApp === appName)
  );
}

export function ConnectApplicationClient({
  initialApps,
  initialKeys,
  resumeApp,
  viewOnly,
  canCreate,
}: {
  initialApps: ProjectAppDto[];
  initialKeys: { publicId: string; name: string | null; allowedApp: string | null; revokedAt: string | null }[];
  resumeApp: string | null;
  viewOnly: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const resumed = resumeApp
    ? initialApps.find((a) => a.name === resumeApp) ?? null
    : null;

  const activeKeys = useMemo(
    () => initialKeys.filter((k) => !k.revokedAt),
    [initialKeys]
  );

  const initialStep: Step = resumed
    ? resumeStepForApp({
        connected: resumed.connected,
        hasActiveKey: compatibleKeysForApp(activeKeys, resumed.name).length > 0,
        viewOnly: viewOnly || resumed.connected,
      })
    : "details";

  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState(resumed?.name ?? "");
  const [framework, setFramework] = useState<ConnectAppFrameworkId | "">(
    (resumed?.framework as ConnectAppFrameworkId) || "nextjs"
  );
  const [app, setApp] = useState<ProjectAppDto | null>(resumed);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [useExistingKey, setUseExistingKey] = useState(
    Boolean(resumed && compatibleKeysForApp(activeKeys, resumed.name).length > 0)
  );
  const [error, setError] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState>(
    resumed?.connected ? "success" : "idle"
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [fullExampleOpen, setFullExampleOpen] = useState(false);
  const mountedRef = useRef(true);
  const verifyStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep resume in sync when server props change (e.g. after refresh).
  useEffect(() => {
    if (!resumeApp) return;
    const match = initialApps.find((a) => a.name === resumeApp) ?? null;
    if (!match) return;
    setApp(match);
    setName(match.name);
    if (match.framework) setFramework(match.framework as ConnectAppFrameworkId);
    if (match.connected) setVerifyState("success");
  }, [initialApps, resumeApp]);

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
      const hasKey = compatibleKeysForApp(activeKeys, result.app.name).length > 0;
      setUseExistingKey(hasKey);
      setStep(hasKey ? "install" : "key");
      router.replace(connectAppHref(result.app.name));
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
    if (!app?.name || !mountedRef.current) return;
    const result = await fetchDashboardProjectAppStatus(app.name);
    if (!mountedRef.current) return;
    if (!result.ok) {
      setVerifyState("error");
      setVerifyError(result.error);
      return;
    }
    setApp(result.app);
    setVerifyError(null);
    if (result.app.connected) {
      setVerifyState("success");
      toast.success("First telemetry received — you’re connected.");
      router.refresh();
    }
  }, [app?.name, router]);

  useEffect(() => {
    if (step !== "waiting" || !app?.name || app.connected) return;
    setVerifyState("waiting");
    verifyStartedAtRef.current = Date.now();
    let cancelled = false;

    const tick = async () => {
      if (cancelled || !mountedRef.current) return;
      const started = verifyStartedAtRef.current ?? Date.now();
      if (Date.now() - started >= VERIFY_TIMEOUT_MS) {
        setVerifyState((prev) => (prev === "success" ? prev : "timeout"));
        return;
      }
      await refreshStatus();
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, VERIFY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [app?.connected, app?.name, refreshStatus, step]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  const showingResumeBanner = Boolean(resumed && step !== "details");
  const isViewGuide = viewOnly || Boolean(app?.connected);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {showingResumeBanner && app ? (
        <div className="rounded-xl border border-border bg-surface/40 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">
            {isViewGuide ? "Setup instructions" : "Continue setup"} for{" "}
            <code className="text-foreground">{app.name}</code>
          </p>
          <p className="mt-1 text-muted-foreground">
            {frameworkLabel(app.framework)}
            {app.connected
              ? " · Connected — you can revisit these steps anytime."
              : " · Waiting for first telemetry — we won’t create another application."}
          </p>
          {!isViewGuide ? (
            <Link
              href={connectAppHref()}
              className="mt-2 inline-block text-[13px] text-muted-foreground hover:text-foreground"
            >
              Or connect a different application
            </Link>
          ) : null}
        </div>
      ) : null}

      <ol className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
          const skippedDetails = Boolean(resumed) && s.id === "details";
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-full border px-2.5 py-1",
                active && "border-brand text-foreground",
                (done || skippedDetails) && "border-border text-foreground/80",
                !active && !done && !skippedDetails && "border-border/60"
              )}
            >
              {i + 1}. {s.label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {step === "details" ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">Connect an application</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An <strong className="font-medium text-foreground">application</strong> is the SDK{" "}
            <code className="text-foreground">app</code> label. It belongs to the project in the
            header. Register it here before sending telemetry.
          </p>

          <label className="mt-5 block text-sm font-medium text-foreground">
            Application name
            <input
              className={cn(
                "mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2",
                searchInputClassName
              )}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-next-app"
              maxLength={128}
              autoFocus
            />
          </label>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Use the same string in your SDK <code className="text-foreground">app</code> config.
          </p>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-foreground">Framework</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CONNECT_APP_FRAMEWORKS.map((f) => (
                <label
                  key={f.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    framework === f.id
                      ? "border-brand bg-brand/5"
                      : "border-border hover:bg-surface"
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
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{a.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {frameworkLabel(a.framework)} ·{" "}
                        {a.connected ? "Connected" : "Waiting for first event"}
                      </p>
                    </div>
                    <Link
                      href={connectAppHref(a.name, a.connected)}
                      className="shrink-0 text-[13px] text-brand hover:underline"
                    >
                      {a.connected ? "View setup" : "Continue setup"}
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
            Keys authenticate ingest for this project. Creating a key is not creating another
            application — <code className="text-foreground">{app.name}</code> is already registered.
          </p>

          {compatibleKeysForApp(activeKeys, app.name).length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Compatible key(s) already exist for this project. Reuse one or create a key scoped to
              this app.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No compatible key yet. Create one to finish SDK setup (shown once).
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
            {compatibleKeysForApp(activeKeys, app.name).length > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={onSkipKey}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                Use existing key
              </button>
            ) : null}
            <Link
              href="/dashboard/settings/keys"
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Manage keys
            </Link>
          </div>
          <button
            type="button"
            className="mt-4 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setStep("install")}
          >
            Skip to install instructions →
          </button>
        </section>
      ) : null}

      {(step === "install" || step === "waiting") && app ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">
            {isViewGuide ? "Setup instructions" : "Install"}{" "}
            {frameworkLabel(framework || app.framework)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            App name must be <code className="text-foreground">{app.name}</code>. Docs:{" "}
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
              <p className="font-medium text-foreground">
                Copy your new key now — it won’t be shown again.
              </p>
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
          ) : useExistingKey || isViewGuide ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Use a project API key from{" "}
              <Link href="/dashboard/settings/keys" className="text-brand hover:underline">
                Settings → API keys
              </Link>
              .
            </p>
          ) : null}

          {(
            [
              ["1. Install", snippets.install],
              ["2. Environment", snippets.env],
              ["3. Initialize SDK", snippets.init],
              ["4. Send a test event", snippets.verify],
            ] as const
          ).map(([label, code]) => (
            <SnippetBlock key={label} label={label} code={code} onCopy={copyText} />
          ))}

          {snippets.fullExample ? (
            <div className="mt-4">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                aria-expanded={fullExampleOpen}
                onClick={() => setFullExampleOpen((o) => !o)}
              >
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", fullExampleOpen && "rotate-180")}
                />
                Full example
              </button>
              {fullExampleOpen ? (
                <SnippetBlock
                  label="Full example"
                  code={snippets.fullExample}
                  onCopy={copyText}
                  className="mt-2"
                />
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {step === "install" && !app.connected ? (
              <button
                type="button"
                onClick={() => {
                  setVerifyState("waiting");
                  setStep("waiting");
                }}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
              >
                I’ve installed the SDK — wait for first event
              </button>
            ) : null}
            {app.connected ? (
              <Link
                href={`/dashboard/overview?app=${encodeURIComponent(app.name)}`}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
              >
                Back to overview
              </Link>
            ) : null}
            {!resumed ? (
              <button
                type="button"
                onClick={() => setStep(step === "install" ? "key" : "details")}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep("key")}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                API key options
              </button>
            )}
          </div>
        </section>
      ) : null}

      {step === "waiting" && app ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-base font-medium text-foreground">Verify connection</h2>

          {verifyState === "success" || app.connected ? (
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
          ) : null}

          {verifyState === "waiting" && !app.connected ? (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2 text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for first telemetry with{" "}
                <code className="text-foreground">app={app.name}</code>…
              </p>
              <p className="mt-2">
                Send <code className="text-foreground">trackEvent(&quot;app_connected&quot;)</code>{" "}
                from your app. You can leave this page and reopen setup anytime — we won’t ask you to
                create the application again.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                  onClick={() => void refreshStatus()}
                >
                  Check now
                </button>
                <Link
                  href={`/dashboard/overview?app=${encodeURIComponent(app.name)}`}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Leave and resume later
                </Link>
              </div>
            </div>
          ) : null}

          {verifyState === "timeout" && !app.connected ? (
            <div className="mt-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-muted-foreground">
                <p className="text-foreground">Still waiting for the first event.</p>
                <p className="mt-1">
                  Confirm the SDK <code className="text-foreground">app</code> value is{" "}
                  <code className="text-foreground">{app.name}</code>, the API key is for this
                  project, and ingest URL is correct. Then try again — no need to recreate the app.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground"
                    onClick={() => {
                      verifyStartedAtRef.current = Date.now();
                      setVerifyState("waiting");
                      void refreshStatus();
                    }}
                  >
                    Keep waiting
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                    onClick={() => setStep("install")}
                  >
                    Review install steps
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {verifyState === "error" ? (
            <div className="mt-3 text-sm text-destructive" role="alert">
              <p>{verifyError || "Could not check connection status."}</p>
              <button
                type="button"
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
                onClick={() => {
                  setVerifyState("waiting");
                  void refreshStatus();
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function SnippetBlock({
  label,
  code,
  onCopy,
  className,
}: {
  label: string;
  code: string;
  onCopy: (label: string, code: string) => void | Promise<void>;
  className?: string;
}) {
  return (
    <div className={cn("mt-4", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          onClick={() => void onCopy(label, code)}
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  );
}
