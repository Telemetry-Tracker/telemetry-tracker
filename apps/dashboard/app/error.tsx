"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  ErrorPageShell,
  ErrorRetryIcon,
  errorPrimaryBtn,
  errorSecondaryBtn,
} from "@/app/components/error-pages/ErrorPageShell";
import { captureClientException } from "@/lib/sentry";

export default function AppError({
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
    <ErrorPageShell
      eyebrow="Runtime error"
      code="500"
      title="Something went sideways."
      description="An unexpected error interrupted this page. The incident has been logged — you can retry, or jump back to a stable route."
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
  );
}
