import { PreferencesSettingsClient } from "./PreferencesSettingsClient";
import { fetchDashboardPreferences } from "@/lib/dashboard-preferences";

export default async function PreferencesSettingsPage() {
  const preferences = await fetchDashboardPreferences();
  return <PreferencesSettingsClient initialPreferences={preferences} />;
}
