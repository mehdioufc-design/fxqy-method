import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [{ cleanExpiredKnownFiles }, { closeDatabase }] = await Promise.all([
    import("../worker/worker"),
    import("../lib/db"),
  ]);
  try {
    await cleanExpiredKnownFiles();
    console.log("Expired known files and stale job workspaces were checked safely.");
  } finally {
    closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Cleanup failed.");
  process.exitCode = 1;
});
