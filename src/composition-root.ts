import "server-only";

import { systemClock } from "@/adapters/system-clock";
import { getEnv, type Env } from "@/shared/config/env";
import type { Clock } from "@/shared/ports/clock";

/**
 * Composition root.
 *
 * This is the ONLY module allowed to choose between demo and live adapters.
 * Routes, use cases, and UI receive ports from here and never import
 * `@/adapters/*` directly (enforced by ESLint `no-restricted-imports`).
 *
 * The container never exposes secrets: API keys and tokens are consumed inside
 * `buildContainer` when adapters are constructed, and only non-secret config
 * leaves this module.
 */

export type AppMode = "demo" | "live";

export interface Container {
  mode: AppMode;
  /** Anthropic model id used for explanations, reports, and chat. */
  model: string;
  /** Public base URL of the deployment, when configured. */
  appUrl: string | undefined;
  clock: Clock;
}

function buildContainer(env: Env): Container {
  const mode: AppMode = env.DEMO_MODE ? "demo" : "live";

  // TODO(phase 2+): register port implementations here, selected by `mode`.
  // Secrets from `env` are passed to adapter constructors only, never exposed:
  //   - demo: in-memory repositories + fakes seeded relative to `clock.now()`
  //   - live: Supabase repositories, Jira/GitHub/Calendar/Flocktools REST
  //     adapters, Anthropic LLM adapter, Voyage (or hashing) embedder
  return {
    mode,
    model: env.ANTHROPIC_MODEL,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    clock: systemClock,
  };
}

let container: Container | undefined;

/** Returns the process-wide container, built lazily on first access. */
export function getContainer(): Container {
  container ??= buildContainer(getEnv());
  return container;
}
