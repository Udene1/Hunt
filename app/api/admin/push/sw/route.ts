import { NextResponse } from "next/server";

const script = `self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "Hunt needs admin review", {
    body: data.body || "A Hunt review task needs attention.",
    tag: data.taskId || "hunt-admin-review",
    data: { url: data.url || "/admin/review-tasks", sourceUrl: data.sourceUrl || null },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification?.data?.url || "/admin/review-tasks";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if ("focus" in client) { client.focus(); return client.navigate(url); }
    return clients.openWindow(url);
  }));
});`;

export async function GET() {
  return new NextResponse(script, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
}
