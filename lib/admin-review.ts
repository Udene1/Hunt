import { prisma } from "./db";

export type ReviewIssue = {
  companyId?: string | null;
  type: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
  sourceUrl?: string | null;
  fingerprint: string;
  metadata?: Record<string, unknown>;
};

export async function createAdminReviewTasks(issues: ReviewIssue[]) {
  const created = [];
  for (const issue of issues) {
    const task = await prisma.adminReviewTask.upsert({
      where: { fingerprint: issue.fingerprint },
      update: {
        companyId: issue.companyId ?? undefined,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
        sourceUrl: issue.sourceUrl ?? null,
        metadata: issue.metadata,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
      },
      create: {
        companyId: issue.companyId ?? null,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
        sourceUrl: issue.sourceUrl ?? null,
        fingerprint: issue.fingerprint,
        metadata: issue.metadata,
      },
    });
    created.push(task);
  }
  return created;
}

export async function pushAdminReviewAlert(task: { id: string; title: string; detail: string; sourceUrl?: string | null }) {
  const publicKey = process.env.HUNT_ADMIN_VAPID_PUBLIC_KEY;
  const privateKey = process.env.HUNT_ADMIN_VAPID_PRIVATE_KEY;
  const subject = process.env.HUNT_ADMIN_VAPID_SUBJECT || "mailto:admin@hunt.local";
  if (!publicKey || !privateKey) return { sent: 0, configured: false };

  const webpushModule = await import("web-push");
  const webpush = (webpushModule as any).default || webpushModule;
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const subscriptions = await prisma.adminPushSubscription.findMany();
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({
          title: "Hunt needs admin review",
          body: task.title,
          detail: task.detail,
          taskId: task.id,
          sourceUrl: task.sourceUrl || null,
          url: "/admin/review-tasks",
        }),
      );
      sent++;
      await prisma.adminPushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await prisma.adminPushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
      }
    }
  }
  return { sent, configured: true };
}
