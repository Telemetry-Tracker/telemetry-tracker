import { API_BASE_URL } from "@/lib/api-url";
import { checkInAction } from "./actions";
import { CheckInsClient } from "./CheckInsClient";
export const dynamic = "force-dynamic";
export default async function CheckInsPage() {
  try {
    const data = await checkInAction("GET");
    return <CheckInsClient initial={{ ...data, apiBaseUrl: process.env.CHECKIN_PUBLIC_BASE_URL ?? API_BASE_URL }} />;
  } catch {
    return <p role="alert">Unable to load check-ins. Check your project selection and API connection.</p>;
  }
}
