"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(Array.from(raw, (char) => char.charCodeAt(0)));
}

export default function AdminReviewTasksPage() {
  const [token, setToken] = useState("");
  const [tasks, setTasks] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function load(currentToken = token) {
    if (!currentToken) return;
    const response = await fetch("/api/admin/review-tasks", { headers: { Authorization: "Bearer " + currentToken } });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error || "Could not load review tasks."); return; }
    setTasks(data.tasks || []);
  }

  async function enablePush() {
    if (!token) { setMessage("Enter the admin bearer token first."); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setMessage("This browser does not support web push.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setMessage("Notification permission was not granted."); return; }
    const registration = await navigator.serviceWorker.register("/api/admin/push/sw");
    const keyResponse = await fetch("/api/admin/push/vapid-public-key", { headers: { Authorization: "Bearer " + token } });
    const keyData = await keyResponse.json();
    if (!keyResponse.ok) { setMessage(keyData.error || "Admin push is not configured."); return; }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    });
    const response = await fetch("/api/admin/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(subscription.toJSON()),
    });
    const data = await response.json();
    setMessage(response.ok ? "Admin push notifications are enabled on this device." : (data.error || "Could not save push subscription."));
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("hunt_admin_token") || "";
    if (saved) { setToken(saved); load(saved); }
  }, []);

  function saveToken(value: string) {
    setToken(value);
    sessionStorage.setItem("hunt_admin_token", value);
  }

  async function resolve(id: string) {
    const response = await fetch("/api/admin/review-tasks", {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    if (response.ok) await load();
  }

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Hunt Admin Review</h1>
      <p>Financial documents that Hunt cannot safely extract appear here. Never treat an extraction failure as a financial value.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="Admin bearer token"
          type="password"
          style={{ flex: 1, padding: 10 }}
        />
        <button onClick={() => load()} style={{ padding: "10px 14px" }}>Load</button>
        <button onClick={enablePush} style={{ padding: "10px 14px" }}>Enable push</button>
      </div>
      {message && <p>{message}</p>}
      <section>
        {tasks.length === 0 ? <p>No open review tasks.</p> : tasks.map((task) => (
          <article key={task.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <strong>{task.title}</strong>
            <p>{task.detail}</p>
            <p><b>Company:</b> {task.company?.name || "Unknown"}</p>
            {task.sourceUrl && <p><a href={task.sourceUrl} target="_blank" rel="noreferrer">Open original source document</a></p>}
            <button onClick={() => resolve(task.id)} style={{ padding: "8px 12px" }}>Mark resolved</button>
          </article>
        ))}
      </section>
    </main>
  );
}
