#!/usr/bin/env node
/**
 * CLI to download a Luciq public bug report (logs + screenshot).
 *
 * Usage:
 *   luciq-fetch <url-or-token> [-o OUTPUT_DIR] [--no-screenshot]
 *                              [--logs name,name,...] [--quiet|-q]
 *
 * Examples:
 *   npx tsx src/cli.ts https://dashboard.luciq.ai/bugs/<TOKEN>
 *   npx tsx src/cli.ts <TOKEN> -o ./out
 *   npx tsx src/cli.ts <token> --logs instabug_log,network_log
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  LOG_TYPES,
  LuciqError,
  bugAsset,
  fetchBug,
  fetchLog,
  fetchScreenshot,
} from "./client.js";

interface Cli {
  target: string;
  outputDir?: string;
  noScreenshot: boolean;
  logs?: string[];
  quiet: boolean;
}

function parseCli(argv: string[]): Cli | null {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "output-dir": { type: "string", short: "o" },
      "no-screenshot": { type: "boolean", default: false },
      logs: { type: "string" },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length === 0) {
    process.stderr.write(
      "Usage: luciq-fetch <url-or-token> [-o DIR] [--no-screenshot] [--logs name,name,…] [-q]\n" +
        `Log types: ${LOG_TYPES.join(",")}\n`,
    );
    return null;
  }
  return {
    target: positionals[0]!,
    outputDir: values["output-dir"],
    noScreenshot: Boolean(values["no-screenshot"]),
    logs: values.logs
      ? values.logs.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    quiet: Boolean(values.quiet),
  };
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  if (!cli) return 1;

  const log = cli.quiet ? () => {} : (msg: string) => console.log(msg);

  let bug;
  try {
    bug = await fetchBug(cli.target);
  } catch (e) {
    const msg = e instanceof LuciqError ? e.message : (e as Error).message;
    process.stderr.write(`error: ${msg}\n`);
    return 2;
  }

  const out = resolve(cli.outputDir ?? `bug-${bug.number}`);
  await mkdir(out, { recursive: true });
  log(`Bug #${bug.number} — ${JSON.stringify(bug.title)} [${bug.app_slug}]`);
  log(`Output: ${out}`);

  await writeFile(
    resolve(out, "bug.json"),
    JSON.stringify(bug.raw, null, 2),
    "utf-8",
  );
  log("  wrote bug.json");

  const requested = cli.logs ?? [...LOG_TYPES];
  const logsDir = resolve(out, "logs");
  await mkdir(logsDir, { recursive: true });

  for (const name of requested) {
    if (!(LOG_TYPES as readonly string[]).includes(name)) {
      log(`  skip unknown log type: ${name}`);
      continue;
    }
    const asset = bugAsset(bug, name);
    if (!asset || asset.is_empty) {
      log(`  skip ${name} (empty)`);
      continue;
    }
    let data: unknown;
    try {
      data = await fetchLog(bug, name);
    } catch (e) {
      log(`  skip ${name}: ${(e as Error).message}`);
      continue;
    }
    let path: string;
    let bytes: string;
    if (typeof data === "object" && data !== null) {
      path = resolve(logsDir, `${name}.json`);
      bytes = JSON.stringify(data, null, 2);
    } else {
      path = resolve(logsDir, `${name}.txt`);
      bytes = String(data);
    }
    await writeFile(path, bytes, "utf-8");
    log(`  wrote logs/${name}${path.endsWith(".txt") ? ".txt" : ".json"} (${bytes.length} bytes)`);
  }

  if (!cli.noScreenshot && bugAsset(bug, "screenshot")) {
    try {
      const jpg = await fetchScreenshot(bug, "original");
      const shotPath = resolve(out, "screenshot.jpg");
      await writeFile(shotPath, jpg);
      log(`  wrote screenshot.jpg (${jpg.length} bytes)`);
    } catch (e) {
      log(`  screenshot: ${(e as Error).message}`);
    }
  }

  return 0;
}

main().then((code) => process.exit(code));
