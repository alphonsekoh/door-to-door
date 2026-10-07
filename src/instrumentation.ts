/*
 * Runs once when the server starts, so a missing or invalid config.yaml (or a
 * missing secret) stops it with a message naming the file and key, rather than
 * surfacing as a 500 on the first request an hour later.
 *
 * Only on the Node runtime, and never while building: `next build` must need
 * neither the file nor a database (D-13-4).
 */
export async function register(): Promise<void> {
  if (
    process.env["NEXT_RUNTIME"] !== "nodejs" ||
    process.env["NEXT_PHASE"] === "phase-production-build"
  ) {
    return;
  }
  const { verifyConfigOrExit } = await import("@/server/config");
  verifyConfigOrExit();
}
