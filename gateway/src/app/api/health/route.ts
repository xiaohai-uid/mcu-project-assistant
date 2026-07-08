import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const gatewayStartTime = Date.now();

const SERVICE_URL_ENV_MAP: Record<string, string> = {
  requirement: "REQUIREMENT_SERVICE_URL",
  recommendation: "RECOMMENDATION_SERVICE_URL",
  websearch: "WEBSERVICE_URL",
  codegen: "CODEGEN_SERVICE_URL",
  schematic: "SCHEMATIC_SERVICE_URL",
};

async function checkService(name: string, url: string): Promise<{ status: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { status: res.ok ? "ok" : "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}

export const GET = withErrorHandler(async () => {
  const uptimeSeconds = Math.floor((Date.now() - gatewayStartTime) / 1000);

  const results = await Promise.all(
    Object.entries(SERVICE_URL_ENV_MAP).map(async ([name, envKey]) => {
      const url = process.env[envKey];
      if (!url) return [name, { status: "unreachable" }] as const;
      const result = await checkService(name, url);
      return [name, result] as const;
    })
  );

  const services: Record<string, { status: string }> = {};
  let allOk = true;
  for (const [name, result] of results) {
    services[name] = result;
    if (result.status !== "ok") allOk = false;
  }

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    version: "0.1.0",
    uptime_seconds: uptimeSeconds,
    services,
  });
});
