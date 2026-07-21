import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [{ runDiagnostics }, { closeDatabase }] = await Promise.all([
    import("../lib/diagnostics"),
    import("../lib/db"),
  ]);
  try {
    console.log(JSON.stringify(await runDiagnostics(), null, 2));
  } finally {
    closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Diagnostics failed.");
  process.exitCode = 1;
});
