"use client";
import { useState } from "react";
import Link from "next/link";
import { checkInAction } from "./actions";

type Config = {
  name: string; schedule_type: "INTERVAL" | "CRON"; interval_seconds: number | null;
  cron_expr: string | null; timezone: string; grace_seconds: number;
  max_runtime_seconds: number | null; destination_ids: string[];
};
type Monitor = Config & { id: string; status: string; last_ping_at: string | null; next_due_at: string | null; checkin_path?: string };
type History = { id: string; kind: string; received_at: string; duration_ms: number | null; exit_code: number | null };
type Data = { monitors: Monitor[]; canEdit: boolean; evaluator: string; apiBaseUrl: string };
const empty: Config = { name: "", schedule_type: "INTERVAL", interval_seconds: 300, cron_expr: "*/5 * * * *", timezone: "UTC", grace_seconds: 300, max_runtime_seconds: null, destination_ids: ["project-email"] };
const inputClass = "rounded border border-border bg-background px-3 py-2";
const buttonClass = "rounded border border-border px-3 py-2 hover:bg-muted disabled:opacity-50";
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export function CheckInsClient({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [config, setConfig] = useState<Config>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [history, setHistory] = useState<{ name: string; rows: History[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [webhooks, setWebhooks] = useState<{ id: string; label: string | null; provider: string }[]>([]);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function refresh() { const updated = await checkInAction("GET"); setData(current => ({ ...updated, apiBaseUrl: current.apiBaseUrl })); }
  function showUrl(m: Monitor) {
    if (m.checkin_path) setUrl(`${data.apiBaseUrl.replace(/\/$/, "")}${m.checkin_path}`);
  }
  async function openForm(m?: Monitor) {
    setEditing(m?.id ?? null);
    setConfig(m ? { name: m.name, schedule_type: m.schedule_type, interval_seconds: m.interval_seconds, cron_expr: m.cron_expr, timezone: m.timezone, grace_seconds: m.grace_seconds, max_runtime_seconds: m.max_runtime_seconds, destination_ids: m.destination_ids } : empty);
    setForm(true);
    const { loadCheckInWebhooks } = await import("./webhooks");
    setWebhooks(await loadCheckInWebhooks());
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Check-ins</h1>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => run(refresh)}>Refresh</button>
        {data.canEdit && <button className={buttonClass} disabled={busy} onClick={() => run(() => openForm())}>Create monitor</button>}</div></div>
    <p>Monitor cron jobs and background tasks. <Link className="underline" href="/docs/checkins">Setup and recipes</Link></p>
    {data.evaluator !== "ok" && <p role="alert" className="rounded border border-amber-500 p-4">The evaluator is unavailable or stale. Missed runs and runtime timeouts cannot be detected reliably. Run the evaluator every five minutes.</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {url && <div className="space-y-2 rounded border border-border p-4"><p>Store this URL as a CI secret or environment variable. Anyone with it can send check-ins.</p>
      <input className={`${inputClass} w-full`} aria-label="Secret check-in URL" readOnly value={url} />
      <button className={buttonClass} onClick={() => run(async () => { await navigator.clipboard.writeText(url); })}>Copy URL</button>{" "}
      <button className={buttonClass} onClick={() => setUrl("")}>Hide</button></div>}
    {form && <form className="grid gap-4 rounded border border-border p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); run(async () => { await checkInAction(editing ? "PATCH" : "POST", editing ?? "", "", config); setForm(false); await refresh(); }); }}>
      <label className="grid gap-1">Name<input className={inputClass} required maxLength={120} value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} /></label>
      <label className="grid gap-1">Schedule type<select className={inputClass} value={config.schedule_type} onChange={e => setConfig({ ...config, schedule_type: e.target.value as Config["schedule_type"] })}><option value="INTERVAL">Interval</option><option value="CRON">Cron</option></select></label>
      {config.schedule_type === "INTERVAL" ? <label className="grid gap-1">Interval (seconds, minimum 300)<input className={inputClass} type="number" min={300} required value={config.interval_seconds ?? 300} onChange={e => setConfig({ ...config, interval_seconds: Number(e.target.value) })} /></label> : <>
        <label className="grid gap-1">Cron (five fields)<input className={inputClass} required value={config.cron_expr ?? ""} onChange={e => setConfig({ ...config, cron_expr: e.target.value })} /></label>
        <label className="grid gap-1">IANA time zone<input className={inputClass} required value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })} /></label></>}
      <label className="grid gap-1">Grace (seconds)<input className={inputClass} type="number" min={60} max={86400} required value={config.grace_seconds} onChange={e => setConfig({ ...config, grace_seconds: Number(e.target.value) })} /></label>
      <label className="grid gap-1">Maximum runtime (seconds, optional)<input className={inputClass} type="number" min={1} max={604800} value={config.max_runtime_seconds ?? ""} onChange={e => setConfig({ ...config, max_runtime_seconds: e.target.value ? Number(e.target.value) : null })} /></label>
      <fieldset className="space-y-2"><legend>Alert channels</legend>{[{ id: "project-email", label: "Project email", provider: "EMAIL" }, ...webhooks].map(channel => <label key={channel.id} className="flex gap-2"><input type="checkbox" checked={config.destination_ids.includes(channel.id)} onChange={e => setConfig({ ...config, destination_ids: e.target.checked ? [...config.destination_ids, channel.id] : config.destination_ids.filter(id => id !== channel.id) })} />{channel.label ?? channel.provider}</label>)}<Link className="block underline" href="/dashboard/alerts">Manage webhook channels</Link><p>In-app notifications are always recorded.</p></fieldset>
      <div className="flex items-end gap-2"><button className={buttonClass} disabled={busy}>Save</button><button type="button" className={buttonClass} onClick={() => setForm(false)}>Cancel</button></div>
    </form>}
    {!data.monitors.length && <p>No monitors yet. New monitors start detecting misses after their first check-in.</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Name", "Status", "Schedule", "Last check-in", "Next expected", "Actions"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>
      {data.monitors.map(m => <tr key={m.id} className="border-t border-border"><td className="p-3">{m.name}</td><td className="p-3">{m.status}</td><td className="p-3">{m.schedule_type === "CRON" ? `${m.cron_expr} (${m.timezone})` : `Every ${m.interval_seconds} seconds`}</td><td className="p-3">{date(m.last_ping_at)}</td><td className="p-3">{date(m.next_due_at)}</td><td className="flex flex-wrap gap-2 p-3">
        <button className={buttonClass} disabled={busy} onClick={() => run(async () => { const result = await checkInAction("GET", m.id, "checkins"); setHistory({ name: m.name, rows: result.checkins }); })}>History</button>
        {data.canEdit && <><button className={buttonClass} onClick={() => showUrl(m)}>URL</button><button className={buttonClass} disabled={busy} onClick={() => run(() => openForm(m))}>Edit</button>
          <button className={buttonClass} disabled={busy} onClick={() => run(async () => { await checkInAction("POST", m.id, m.status === "PAUSED" ? "resume" : "pause"); await refresh(); })}>{m.status === "PAUSED" ? "Resume" : "Pause"}</button>
          <button className={buttonClass} disabled={busy} onClick={() => { if (window.confirm("Rotate this URL? The old URL stops working immediately.")) run(async () => { const updated = await checkInAction("POST", m.id, "rotate-token"); showUrl(updated); await refresh(); }); }}>Rotate URL</button>
          <button className={buttonClass} disabled={busy} onClick={() => { if (window.confirm("Delete this monitor?")) run(async () => { await checkInAction("DELETE", m.id); setUrl(""); await refresh(); }); }}>Delete</button></>}
      </td></tr>)}
    </tbody></table></div>
    {history && <section className="space-y-2"><h2 className="text-lg font-semibold">Recent check-ins: {history.name}</h2><button className={buttonClass} onClick={() => setHistory(null)}>Close</button>{history.rows.length ? <ul>{history.rows.map(row => <li key={row.id} className="border-b border-border py-2">{date(row.received_at)} · {row.kind}{row.duration_ms !== null ? ` · ${row.duration_ms} ms` : ""}{row.exit_code !== null ? ` · exit ${row.exit_code}` : ""}</li>)}</ul> : <p>No check-ins yet.</p>}</section>}
  </div>;
}
