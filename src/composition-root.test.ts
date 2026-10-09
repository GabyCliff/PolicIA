import { describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

const SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
  ANTHROPIC_API_KEY: "sk-ant-secret-value",
  VOYAGE_API_KEY: "voyage-secret-value",
  JIRA_API_TOKEN: "jira-secret-value",
  GITHUB_TOKEN: "github-secret-value",
  GOOGLE_PRIVATE_KEY: "google-private-key-value",
  FLOCKTOOLS_API_TOKEN: "flocktools-secret-value",
  REMOTE_MCP_JIRA_TOKEN: "mcp-secret-value",
  CRON_SECRET: "cron-secret-value-0123456789",
};

async function loadContainer(env: Record<string, string>) {
  stubIsolatedEnv(env);
  vi.resetModules();
  const { getContainer } = await import("./composition-root");
  return getContainer();
}

describe("getContainer", () => {
  it("exposes only non-secret configuration", async () => {
    const container = await loadContainer({
      DEMO_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_APP_URL: "https://radar.example.com",
      ...SECRETS,
    });

    expect(Object.keys(container).sort()).toEqual([
      "appUrl",
      "clock",
      "mode",
      "model",
    ]);

    const serialized = JSON.stringify(container);
    for (const secret of Object.values(SECRETS)) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("selects demo mode by default", async () => {
    const container = await loadContainer({});
    expect(container.mode).toBe("demo");
    expect(container.model).toBe("claude-opus-5-5");
    expect(container.clock.now()).toBeInstanceOf(Date);
  });

  it("returns the same instance on repeated calls", async () => {
    stubIsolatedEnv({});
    vi.resetModules();
    const { getContainer } = await import("./composition-root");
    expect(getContainer()).toBe(getContainer());
  });
});
