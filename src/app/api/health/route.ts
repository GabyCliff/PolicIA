import { connection } from "next/server";

import { getContainer } from "@/composition-root";

/**
 * Liveness probe. Never returns secrets: only the runtime mode and model id.
 * Resolving the container also proves the app booted (in demo mode, that the
 * seeded scenario synced); a boot failure surfaces here as a 500.
 *
 * `connection()` opts this handler out of build-time prerendering (Cache
 * Components replaces the `dynamic = "force-dynamic"` segment config).
 */
export async function GET() {
  await connection();

  const { mode, model } = await getContainer();

  return Response.json(
    { status: "ok", mode, model },
    { headers: { "Cache-Control": "no-store" } },
  );
}
