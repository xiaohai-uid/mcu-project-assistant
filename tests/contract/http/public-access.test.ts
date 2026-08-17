import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

function makeApp(publicMode = true): ReturnType<typeof createApp> {
  const db = openDatabase(":memory:");
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  const tasks = createInProcessTasks({ persistence, events });
  const device = createCompanionLocalDevice();
  const deps: AppDeps = {
    persistence,
    workspaceDir: "C:/mcu-public-access-test/workspace",
    content: createWorkspaceFilesContent("C:/mcu-public-access-test/workspace"),
    events,
    tasks,
    compiler: createMockCompiler(),
    device,
    ai: createMockAiProvider({ slow: false }),
    frontendDist: resolve(process.cwd(), "tests", "fixtures", "http-frontend"),
    publicMode,
    basicAuth: { username: "pilot", password: "a-secure-internal-test-password" },
  };
  return createApp(deps);
}

describe("public internal-test access boundary", () => {
  it("exposes only a data-free platform health probe without authentication", async () => {
    const app = makeApp();

    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("serves the browser shell without triggering a native Basic Auth challenge", async () => {
    const app = makeApp();

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("MCU browser fixture");
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it("creates a browser session through the normal web login contract", async () => {
    const app = makeApp();

    const unauthenticated = await request(app).get("/api/v1/auth/session");
    expect(unauthenticated.status).toBe(200);
    expect(unauthenticated.body).toEqual({ authenticated: false });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "pilot", password: "a-secure-internal-test-password" });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({ authenticated: true });
    const sessionCookie = login.headers["set-cookie"]?.[0] ?? "";
    expect(sessionCookie).toContain("mcu_session=");

    const authenticated = await request(app)
      .get("/api/v1/health")
      .set("Cookie", sessionCookie);

    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toEqual({ status: "ok" });
  });

  it("rejects a wrong web login without issuing a native auth challenge", async () => {
    const app = makeApp();

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "pilot", password: "wrong-password-for-preview" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "invalid_credentials", message: "Invalid credentials" } });
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it("requires Basic authentication before exposing the API", async () => {
    const app = makeApp();

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Basic realm=\"MCU Project Assistant\"");
    expect(response.body).toEqual({ error: { code: "authentication_required", message: "Authentication required" } });
  });

  it("accepts valid credentials and keeps same-host browser requests trusted", async () => {
    const app = makeApp();

    const response = await request(app)
      .get("/api/v1/health")
      .set("Authorization", "Basic " + Buffer.from("pilot:a-secure-internal-test-password").toString("base64"))
      .set("Host", "pilot.trycloudflare.com")
      .set("Origin", "https://pilot.trycloudflare.com");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["access-control-allow-origin"]).toBe("https://pilot.trycloudflare.com");
  });

  it("rejects a credentialed cross-site browser request", async () => {
    const app = makeApp();

    const response = await request(app)
      .get("/api/v1/health")
      .set("Authorization", "Basic " + Buffer.from("pilot:a-secure-internal-test-password").toString("base64"))
      .set("Host", "pilot.trycloudflare.com")
      .set("Origin", "https://evil.example");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "untrusted_origin", message: "Request origin is not trusted" } });
  });
});
