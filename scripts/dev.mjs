#!/usr/bin/env node
/**
 * Dev launcher: watches src/assets/ and rebuilds src/assets.ts on every
 * change, then runs the server via `tsx watch`. The rebuild rewrites
 * assets.ts, which tsx already watches, so the server restarts automatically.
 */

import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const assetsDir = resolve(root, "src/assets");
const buildScript = resolve(here, "build-assets.mjs");

const rebuild = () => {
  const r = spawnSync(process.execPath, [buildScript], { stdio: "inherit" });
  if (r.status !== 0) console.error("assets: rebuild failed");
};

rebuild();

let queued = false;
let pending = false;
const schedule = () => {
  if (queued) {
    pending = true;
    return;
  }
  queued = true;
  setTimeout(() => {
    rebuild();
    queued = false;
    if (pending) {
      pending = false;
      schedule();
    }
  }, 80);
};

watch(assetsDir, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  schedule();
});

const server = spawn("tsx", ["watch", "src/bin/serve.ts"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

const stop = (sig) => {
  server.kill(sig);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
