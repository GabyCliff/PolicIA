import "server-only";

import {
  InMemoryRadarRepository,
  buildDemoDataset,
  createDemoSources,
} from "@/adapters/demo";
import { systemClock } from "@/adapters/system-clock";
import {
  createUnavailableRepository,
  createUnavailableSources,
} from "@/adapters/unavailable";
import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import { getEnv, type Env } from "@/shared/config/env";
import { toIsoDate } from "@/shared/domain";
import type { Clock, RadarRepository, SourcePorts } from "@/shared/ports";

/**
 * Composition root.
 *
 * This is the ONLY module allowed to choose between demo and live adapters.
 * Routes, use cases, and UI receive ports from here and never import
 * `@/adapters/*` directly (enforced by ESLint `no-restricted-imports`).
 *
 * The container never exposes secrets: API keys and tokens are consumed here
 * when adapters are constructed, and only non-secret config and ports leave
 * this module.
 *
 * Live mode (phase 9, decision D-030): this process-wide container will hold
 * the service-role repository for cron, sync, and admin jobs only.
 * User-facing reads will use a request-scoped repository built from the SSR
 * cookie client, so Postgres RLS applies to every user query.
 */

export type AppMode = "demo" | "live";

/** Non-secret runtime configuration, available synchronously and without IO. */
export interface AppConfig {
  mode: AppMode;
  /** Anthropic model id used for explanations, reports, and chat. */
  model: string;
  /** Public base URL of the deployment, when configured. */
  appUrl: string | undefined;
}

export interface Container extends AppConfig {
  clock: Clock;
  repo: RadarRepository;
  sources: SourcePorts;
}

function toAppConfig(env: Env): AppConfig {
  return {
    mode: env.DEMO_MODE ? "demo" : "live",
    model: env.ANTHROPIC_MODEL,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  };
}

/**
 * Mode, model, and URL without building the container. Use it where only
 * configuration is needed (e.g. the header badge), so static rendering never
 * reads the clock or boots the demo data.
 */
export function getAppConfig(): AppConfig {
  return toAppConfig(getEnv());
}

/**
 * Demo boot: build the scenario anchored to today, then run it through the
 * real sync pipeline (sources -> sync use case -> repository), exactly like a
 * live cron sync would. Repository ids are deterministic, so every instance
 * booted on the same day agrees on alert ids.
 */
async function buildDemoContainer(config: AppConfig, clock: Clock): Promise<Container> {
  const dataset = buildDemoDataset(clock.now());
  const repo = new InMemoryRadarRepository({
    ids: "deterministic",
    now: () => clock.now(),
  });
  const sources = createDemoSources(dataset);

  for (const project of dataset.projects) {
    await repo.projects.upsert(project);
  }

  const sync = await syncProjects({ repo, clock, ...sources });
  if (sync.status !== "ok") {
    const failures = sync.runs
      .filter((run) => run.status !== "ok")
      .map((run) => run.error ?? `${run.source}: ${run.status}`)
      .join("; ");
    throw new Error(`Demo data failed to sync: ${failures}`);
  }

  return { ...config, clock, repo, sources };
}

async function buildContainer(config: AppConfig, clock: Clock): Promise<Container> {
  if (config.mode === "demo") {
    return buildDemoContainer(config, clock);
  }

  // Live mode: Supabase repository and REST source adapters land in phase 9.
  // Until then every data access rejects with a LiveModeUnavailableError.
  return {
    ...config,
    clock,
    repo: createUnavailableRepository(),
    sources: createUnavailableSources(),
  };
}

/**
 * Cached on `globalThis` so every module instance in the process (React
 * Server Components and route handlers can load separate copies of this
 * module) shares one container.
 */
const CONTAINER_CACHE = Symbol.for("radar.composition-root.container");

interface CachedContainer {
  key: string;
  promise: Promise<Container>;
}

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_CACHE]?: CachedContainer;
};

/**
 * Demo data is anchored to the UTC day, so the demo container is keyed by
 * that day and rebuilt after midnight; live mode is keyed by config only.
 */
function cacheKey(config: AppConfig, clock: Clock): string {
  const day = config.mode === "demo" ? toIsoDate(clock.now()) : "";
  return JSON.stringify([config.mode, config.model, config.appUrl ?? "", day]);
}

/**
 * Returns the process-wide container, built on first access and rebuilt
 * when the demo day changes. A failed build is not cached, so the next call
 * retries.
 */
export function getContainer(): Promise<Container> {
  const store = globalThis as GlobalWithContainer;
  const clock = systemClock;

  let config: AppConfig;
  try {
    config = toAppConfig(getEnv());
  } catch (error) {
    return Promise.reject(error);
  }

  const key = cacheKey(config, clock);
  const cached = store[CONTAINER_CACHE];
  if (cached?.key === key) return cached.promise;

  const entry: CachedContainer = {
    key,
    promise: buildContainer(config, clock).catch((error: unknown) => {
      if (store[CONTAINER_CACHE] === entry) delete store[CONTAINER_CACHE];
      throw error;
    }),
  };
  store[CONTAINER_CACHE] = entry;
  return entry.promise;
}

/** Drops the cached container (tests, and an admin "reload demo" later). */
export function resetContainer(): void {
  delete (globalThis as GlobalWithContainer)[CONTAINER_CACHE];
}
