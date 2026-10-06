import { getCurrentUser } from "./auth";

export type EntitlementUser = {
  plan: string;
  pilotExpiresAt: Date | null;
};

export function monitoringEntitled(user: EntitlementUser | null) {
  if (!user) return false;
  if (user.plan === "paid") return true;
  if (user.plan === "pilot" && user.pilotExpiresAt && user.pilotExpiresAt > new Date()) return true;
  return false;
}

export async function requireMonitoringAccess() {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false as const, reason: "authentication_required" as const };
  if (!monitoringEntitled(user)) return { user, allowed: false as const, reason: "plan_required" as const };
  return { user, allowed: true as const };
}
