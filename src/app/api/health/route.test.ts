import { describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

// `connection()` requires a Next.js request scope; outside of one it throws.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

async function loadRoute(env: Record<string, string>) {
  stubIsolatedEnv(env);
  vi.resetModules();
  return import("./route");
}

describe("GET /api/health", () => {
  it("returns exactly status, mode, and model", async () => {
    const { GET } = await loadRoute({
      DEMO_MODE: "true",
      ANTHROPIC_API_KEY: "sk-ant-test-secret",
      CRON_SECRET: "cron-secret-0123456789",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["mode", "model", "status"]);
    expect(body).toEqual({
      status: "ok",
      mode: "demo",
      model: "claude-opus-5-5",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports live mode when DEMO_MODE=false", async () => {
    const { GET } = await loadRoute({
      DEMO_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    });

    const body = await (await GET()).json();
    expect(body.mode).toBe("live");
  });
});
