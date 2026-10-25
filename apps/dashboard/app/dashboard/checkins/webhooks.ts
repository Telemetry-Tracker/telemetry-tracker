"use server";
import { fetchProjectWebhooks } from "@/lib/project-webhooks";
export async function loadCheckInWebhooks() { return fetchProjectWebhooks(); }
