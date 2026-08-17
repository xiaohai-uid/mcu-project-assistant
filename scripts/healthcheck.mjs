const port = Number(process.env.MCU_PORT || 3000);
const headers = {};
const username = process.env.MCU_BASIC_AUTH_USER;
const password = process.env.MCU_BASIC_AUTH_PASSWORD;
if (username !== undefined && password !== undefined) {
  headers.Authorization = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
}

try {
  const response = await fetch("http://127.0.0.1:" + port + "/api/v1/health", { headers, signal: AbortSignal.timeout(4000) });
  if (!response.ok) process.exit(1);
} catch {
  process.exit(1);
}
