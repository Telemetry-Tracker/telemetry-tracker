import { describe, expect, it } from "vitest";
import {
  chargeInvoiceId,
  chargePaymentIntentId,
  invoicePaymentRefsFromPayload,
  resolveInvoicePaymentRefs,
} from "./affiliate-stripe-payments.js";

describe("classic Stripe payloads", () => {
  it("reads Invoice.charge and Charge.invoice", () => {
    expect(
      invoicePaymentRefsFromPayload({
        id: "in_classic",
        charge: "ch_classic",
        payment_intent: "pi_classic",
      })
    ).toEqual({ chargeId: "ch_classic", paymentIntentId: "pi_classic" });
    expect(chargeInvoiceId({ id: "ch_classic", invoice: "in_classic" })).toBe("in_classic");
    expect(chargePaymentIntentId({ id: "ch_classic", payment_intent: "pi_classic" })).toBe(
      "pi_classic"
    );
  });
});

describe("basil Stripe payloads", () => {
  it("reads payment_intent from invoice.payments and ignores missing invoice.charge", () => {
    const invoice = {
      id: "in_basil",
      payments: {
        data: [
          {
            status: "paid",
            payment: {
              type: "payment_intent",
              payment_intent: "pi_basil",
            },
          },
        ],
      },
    };
    expect(invoice.charge).toBeUndefined();
    expect(invoicePaymentRefsFromPayload(invoice)).toEqual({
      chargeId: null,
      paymentIntentId: "pi_basil",
    });
  });

  it("does not use Charge.invoice on basil refund/dispute charges", () => {
    const charge = { id: "ch_basil", payment_intent: "pi_basil" };
    expect(chargeInvoiceId(charge)).toBeNull();
    expect(chargePaymentIntentId(charge)).toBe("pi_basil");
  });

  it("lists invoicePayments when the webhook payload omits payments", async () => {
    const refs = await resolveInvoicePaymentRefs(
      { id: "in_list" },
      {
        invoicePayments: {
          list: async () => ({
            data: [
              {
                status: "paid",
                payment: { type: "payment_intent", payment_intent: "pi_listed" },
              },
            ],
          }),
        },
      }
    );
    expect(refs).toEqual({ chargeId: null, paymentIntentId: "pi_listed" });
  });

  it("throws when invoicePayments.list fails so the webhook can retry", async () => {
    await expect(
      resolveInvoicePaymentRefs(
        { id: "in_list_fail" },
        {
          invoicePayments: {
            list: async () => {
              throw new Error("stripe timeout");
            },
          },
        }
      )
    ).rejects.toThrow(/Failed to list Stripe invoicePayments for in_list_fail: stripe timeout/);
  });
});
