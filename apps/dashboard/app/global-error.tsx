"use client";

import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { useEffect } from "react";
import {
  ErrorPageShell,
  ErrorRetryIcon,
  errorPrimaryBtn,
  errorSecondaryBtn,
} from "@/app/components/error-pages/ErrorPageShell";
import { captureClientException } from "@/lib/sentry";
import "./globals.css";

/**
 * Root-level error UI when the root layout fails. Must define html/body (replaces root layout).
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/global-error
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    captureClientException(error);
  }, [error]);

  const detail =
    process.env.NODE_ENV === "development" && error.message
      ? `${error.name ?? "Error"}: ${error.message}`
      : undefined;

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ErrorPageShell
          eyebrow="Something went wrong"
          code="500"
          title="Something went sideways."
          description="We couldn't load the app properly. Please try again in a moment, or go home and come back. If it keeps happening, contact support and we'll help."
          detail={detail}
          actions={
            <>
              <button type="button" onClick={() => reset()} className={errorPrimaryBtn}>
                Try again
                <ErrorRetryIcon />
              </button>
              <Link href="/" className={errorSecondaryBtn}>
                Go home
              </Link>
              <Link href="/contact" className={errorSecondaryBtn}>
                Contact support
              </Link>
            </>
          }
        />
      </body>
    </html>
  );
}
