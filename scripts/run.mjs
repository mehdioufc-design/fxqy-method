import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import nextEnv from "@next/env";

const mode = process.argv[2] === "start" ? "start" : "dev";
const root = process.cwd();
nextEnv.loadEnvConfig(root, mode === "dev");
const host = process.env.APP_HOST || "127.0.0.1";
const port = process.env.APP_PORT || "3000";
const allowNetwork = process.env.ALLOW_NETWORK_BIND === "true";

const hostPattern = /^(?:127(?:\.\d{1,3}){3}|localhost|::1|0\.0\.0\.0|[a-zA-Z0-9.-]+)$/;
const portNumber = Number(port);

if (!hostPattern.test(host) || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
  throw new Error("APP_HOST or APP_PORT is invalid.");
}

if (!["127.0.0.1", "localhost", "::1"].includes(host) && !allowNetwork) {
  throw new Error(
    "Refusing a non-localhost bind. Set ALLOW_NETWORK_BIND=true only behind a private firewall or authenticated TLS reverse proxy.",
  );
}

const nextCli = resolve(root, "node_modules", "next", "dist", "bin", "next");
const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const workerEntry = resolve(root, "worker", "worker.ts");

for (const requiredPath of [nextCli, tsxCli, workerEntry]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Required runtime file is missing: ${requiredPath}`);
  }
}

const common = {
  cwd: root,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: "inherit",
  windowsHide: true,
};

const web = spawn(process.execPath, [nextCli, mode, "-H", host, "-p", String(portNumber)], common);
const worker = spawn(process.execPath, [tsxCli, workerEntry], common);
const children = [web, worker];
let shuttingDown = false;

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(1), 5_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    shutdown();
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const result = code ?? (signal ? 1 : 0);
    for (const peer of children) {
      if (peer !== child && !peer.killed) peer.kill("SIGTERM");
    }
    process.exit(result);
  });
}
