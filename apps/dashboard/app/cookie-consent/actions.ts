"use server";

import {
  restoreCookieConsentChoiceIfUnset,
  setCookieConsentChoice,
} from "@/lib/cookie-consent-server";
import { isCookieConsentChoice, type CookieConsentChoice } from "@/lib/cookie-consent";

/** Explicit banner choice — always updates the server consent cookie. */
export async function syncCookieConsentAction(
  choice: CookieConsentChoice
): Promise<void> {
  if (!isCookieConsentChoice(choice)) return;
  await setCookieConsentChoice(choice);
}

/** Restore localStorage consent on the server only when no prior server choice exists. */
export async function restoreCookieConsentAction(
  choice: CookieConsentChoice
): Promise<void> {
  if (!isCookieConsentChoice(choice)) return;
  await restoreCookieConsentChoiceIfUnset(choice);
}
