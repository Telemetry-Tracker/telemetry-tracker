/**
 * Basil-safe Stripe invoice ↔ payment linking.
 *
 * API 2025-03-31.basil removed Invoice.charge / Invoice.payment_intent and Charge.invoice.
 * InvoicePayment (invoice.payments / invoicePayments.list) maps an invoice to a PaymentIntent
 * and/or Charge. Charge.payment_intent remains on refund and dispute objects.
 */
import type Stripe from "stripe";

export type InvoicePaymentLister = {
  invoicePayments: {
    list: (params: { invoice: string; limit?: number }) => Promise<{ data: unknown[] }>;
  };
};

export type InvoicePaymentRefs = {
  chargeId: string | null;
  paymentIntentId: string | null;
};

export type InvoicePaymentsLike = {
  id?: string | null;
  charge?: string | { id?: string | null } | null;
  payment_intent?: string | { id?: string | null } | null;
  payments?: {
    data?: unknown[] | null;
  } | unknown[] | null;
};

export function stripeObjectId(
  value: string | { id?: string | null } | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

/** Stripe v22 Charge types omit `invoice`; older webhook payloads still include it. */
export function chargeInvoiceId(charge: unknown): string | null {
  if (!charge || typeof charge !== "object") return null;
  return stripeObjectId((charge as { invoice?: string | { id?: string | null } | null }).invoice);
}

/** Present on Charge (and often Dispute) in both classic and basil payloads. */
export function chargePaymentIntentId(charge: unknown): string | null {
  if (!charge || typeof charge !== "object") return null;
  return stripeObjectId(
    (charge as { payment_intent?: string | { id?: string | null } | null }).payment_intent
  );
}

export function chargeCustomerId(charge: unknown): string | null {
  if (!charge || typeof charge !== "object") return null;
  return stripeObjectId((charge as { customer?: string | { id?: string | null } | null }).customer);
}

function refsFromPaymentField(payment: unknown): InvoicePaymentRefs {
  if (!payment || typeof payment !== "object") {
    return { chargeId: null, paymentIntentId: null };
  }
  const row = payment as {
    payment_intent?: string | { id?: string | null; latest_charge?: string | { id?: string | null } | null } | null;
    charge?: string | { id?: string | null } | null;
    type?: string | null;
  };
  const paymentIntentId = stripeObjectId(row.payment_intent);
  let chargeId = stripeObjectId(row.charge);
  if (
    !chargeId &&
    row.payment_intent &&
    typeof row.payment_intent === "object" &&
    "latest_charge" in row.payment_intent
  ) {
    chargeId = stripeObjectId(row.payment_intent.latest_charge);
  }
  return { chargeId, paymentIntentId };
}

function invoicePaymentList(invoice: InvoicePaymentsLike): unknown[] {
  const payments = invoice.payments;
  if (Array.isArray(payments)) return payments;
  if (payments && typeof payments === "object" && "data" in payments) {
    const data = (payments as { data?: unknown[] | null }).data;
    return Array.isArray(data) ? data : [];
  }
  return [];
}

function mergeRefs(into: InvoicePaymentRefs, from: InvoicePaymentRefs): InvoicePaymentRefs {
  return {
    chargeId: into.chargeId ?? from.chargeId,
    paymentIntentId: into.paymentIntentId ?? from.paymentIntentId,
  };
}

function refsFromInvoicePaymentRows(rows: unknown[]): InvoicePaymentRefs {
  let refs: InvoicePaymentRefs = { chargeId: null, paymentIntentId: null };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const status = (row as { status?: string | null }).status;
    if (status && status !== "paid") continue;
    const nested = (row as { payment?: unknown }).payment ?? row;
    refs = mergeRefs(refs, refsFromPaymentField(nested));
    if (refs.chargeId && refs.paymentIntentId) break;
  }
  return refs;
}

/** Sync extract from the webhook/invoice payload (classic + basil). */
export function invoicePaymentRefsFromPayload(invoice: InvoicePaymentsLike): InvoicePaymentRefs {
  const fromRows = refsFromInvoicePaymentRows(invoicePaymentList(invoice));
  return {
    chargeId: stripeObjectId(invoice.charge) ?? fromRows.chargeId,
    paymentIntentId: stripeObjectId(invoice.payment_intent) ?? fromRows.paymentIntentId,
  };
}

export async function resolveInvoicePaymentRefs(
  invoice: InvoicePaymentsLike,
  stripe?: InvoicePaymentLister | Stripe | null
): Promise<InvoicePaymentRefs> {
  let refs = invoicePaymentRefsFromPayload(invoice);
  if (refs.chargeId && refs.paymentIntentId) return refs;

  const invoiceId = invoice.id?.trim();
  const lister = stripe as InvoicePaymentLister | null | undefined;
  if (!invoiceId || !lister?.invoicePayments?.list) return refs;

  try {
    const listed = await lister.invoicePayments.list({ invoice: invoiceId, limit: 10 });
    refs = mergeRefs(refs, refsFromInvoicePaymentRows(listed.data ?? []));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to list Stripe invoicePayments for ${invoiceId}: ${detail}`);
  }
  return refs;
}
