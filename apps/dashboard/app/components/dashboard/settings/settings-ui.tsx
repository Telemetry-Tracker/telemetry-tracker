"use client";

import React from "react";
import Image from "next/image";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, ButtonHTMLAttributes } from "react";
import {
  settingsInputClassName,
} from "@/lib/input-classes";

export function Section({
  title,
  description,
  children,
  actions,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-card ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-[15px] tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/40 px-5 py-3 text-[12px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  optional,
  error,
  htmlFor,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-6">
      <div className="pt-1.5">
        <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px]">
          <span>{label}</span>
          {optional ? (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Optional
            </span>
          ) : null}
        </label>
        {hint ? <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0">
        {children}
        {error ? <p className="mt-1.5 text-[12px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}

export function SettingsInput(
  props: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
) {
  const { mono, className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`${settingsInputClassName} ${mono ? "font-mono" : ""} ${className}`}
    />
  );
}

export function SettingsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`${settingsInputClassName} resize-y py-2 ${className}`}
    />
  );
}

export function SettingsSelect({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${settingsInputClassName} ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-popover">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsBtn({
  variant = "default",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  variant?: "default" | "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent",
    default: "bg-surface text-foreground hover:bg-surface-elevated border border-border",
    outline: "bg-transparent text-foreground hover:bg-surface/60 border border-border",
    ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface/60 border border-transparent",
    danger: "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30",
  };
  const sizes: Record<string, string> = {
    sm: "h-7 px-2.5 text-[12px]",
    md: "h-8 px-3 text-[13px]",
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${styles[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function SettingsToggle({
  on,
  onChange,
  label,
  disabled,
  id,
  ...rest
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> &
  // A switch needs an accessible name: a visible label or aria-label / aria-labelledby (#627).
  (
    | { label: string }
    | { label?: undefined; "aria-label": string }
    | { label?: undefined; "aria-labelledby": string }
  )) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 text-[13px] ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      {...rest}
    >
      <span
        className={`relative h-[18px] w-[30px] rounded-full transition-colors ${on ? "bg-brand" : "bg-surface-elevated"}`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-all ${on ? "left-[14px]" : "left-0.5"}`}
        />
      </span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </button>
  );
}

export function SettingsPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "brand" | "muted";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "border-border bg-surface text-foreground",
    muted: "border-border bg-surface/60 text-muted-foreground",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    brand: "border-brand/30 bg-brand-soft text-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function SettingsAvatar({
  name,
  src,
  size = 32,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-full border border-border bg-surface object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="grid shrink-0 place-items-center rounded-full border border-border bg-surface font-medium text-foreground"
    >
      {initials}
    </span>
  );
}

export function UsageBar({
  used,
  total,
  unit,
  tone = "brand",
}: {
  used: number;
  total: number;
  unit?: string;
  tone?: "brand" | "warning" | "danger";
}) {
  const pct = Math.min(100, (used / total) * 100);
  const color =
    tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-brand";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="tabular text-muted-foreground">
          <span className="text-foreground">{used.toLocaleString()}</span>
          <span className="mx-1">/</span>
          {total.toLocaleString()} {unit}
        </span>
        <span className="tabular font-mono text-[11px] text-muted-foreground">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SettingsStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-xl tracking-tight tabular">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
