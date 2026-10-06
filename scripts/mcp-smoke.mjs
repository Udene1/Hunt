const base = process.env.HUNT_BASE_URL;
const token = process.env.HUNT_MCP_TOKEN;

if (!base || !token) {
  console.error("Set HUNT_BASE_URL and HUNT_MCP_TOKEN.");
  process.exit(1);
}

async function call(method, body) {
  const response = await fetch(`${base.replace(/\/$/, "")}/api/mcp`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(response.status, text.slice(0, 12000));
  if (!response.ok) process.exitCode = 1;
}

await call("POST", {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
});
