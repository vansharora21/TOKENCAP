#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const chokidar = require("chokidar");
const { DEFAULT_CONFIG, makeCapsule, resolveConfig } = require("../src/capsule");

const args = process.argv.slice(2);
const command = args[0] || "make";
const options = parseOptions(args.slice(1));

main().catch((error) => {
  console.error(`TokenCap failed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (command === "make") {
    runMake(options);
  } else if (command === "watch") {
    runWatch(options);
  } else if (command === "init") {
    runInit(options);
  } else if (command === "config") {
    runConfig(options);
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

function runMake(options) {
  const result = makeCapsule({
    root: options.root,
    outputPath: options.out,
    profile: options.profile,
    maxFiles: options.maxFiles,
    maxBytes: options.maxBytes,
    maxFileBytes: options.maxFileBytes,
    maxDiffBytes: options.maxDiffBytes,
    includeGitDiff: options.diff,
    includeFileContents: options.contents
  });

  console.log(`TokenCap snapshot written: ${result.outputPath}`);
  console.log(`Included files: ${result.fileCount}`);
  console.log(`Snapshot bytes: ${result.byteCount}`);
  console.log(`Estimated tokens: ${result.estimatedTokens}`);
  console.log(`Profile: ${result.config.profile}`);
}

function runWatch(options) {
  const root = path.resolve(options.root || process.cwd());
  const debounceMs = Number(options.debounce || 30000);
  let timer = null;
  let running = false;
  const watcher = chokidar.watch(root, {
    ignored: (watchedPath) => shouldIgnore(watchedPath, options.out),
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  console.log(`Watching ${root}`);
  console.log(`Snapshot refresh debounce: ${debounceMs}ms`);
  runMake(options);

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (running) return;
      running = true;
      try {
        runMake(options);
      } catch (error) {
        console.error(error.message);
      } finally {
        running = false;
      }
    }, debounceMs);
  };

  watcher.on("all", (eventType, filename) => {
    if (!filename || shouldIgnore(filename, options.out)) return;
    schedule();
  });

  watcher.on("error", (error) => {
    console.error(`Watcher error: ${error.message}`);
  });
}

function runInit(options) {
  const root = path.resolve(options.root || process.cwd());
  const configPath = path.join(root, ".tokencap.json");
  if (fs.existsSync(configPath) && !options.force) {
    throw new Error(".tokencap.json already exists. Use --force to overwrite it.");
  }

  const config = {
    profile: "balanced",
    outputPath: "TOKENCAP.md",
    maxFiles: DEFAULT_CONFIG.maxFiles,
    maxSourceBytes: DEFAULT_CONFIG.maxSourceBytes,
    maxFileBytes: DEFAULT_CONFIG.maxFileBytes,
    includeGitDiff: true,
    includeFileContents: true,
    excludePatterns: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**"
    ],
    redactSecrets: true
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`Created ${configPath}`);
}

function runConfig(options) {
  const root = path.resolve(options.root || process.cwd());
  const config = resolveConfig(root, {
    outputPath: options.out,
    profile: options.profile,
    maxFiles: options.maxFiles,
    maxBytes: options.maxBytes,
    maxFileBytes: options.maxFileBytes,
    maxDiffBytes: options.maxDiffBytes,
    includeGitDiff: options.diff,
    includeFileContents: options.contents
  });
  console.log(JSON.stringify(config, null, 2));
}

function parseOptions(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const next = items[index + 1];
    if (item === "--root") {
      parsed.root = next;
      index += 1;
    } else if (item === "--out") {
      parsed.out = next;
      index += 1;
    } else if (item === "--profile") {
      parsed.profile = next;
      index += 1;
    } else if (item === "--max-files") {
      parsed.maxFiles = Number(next);
      index += 1;
    } else if (item === "--max-bytes") {
      parsed.maxBytes = Number(next);
      index += 1;
    } else if (item === "--max-file-bytes") {
      parsed.maxFileBytes = Number(next);
      index += 1;
    } else if (item === "--max-diff-bytes") {
      parsed.maxDiffBytes = Number(next);
      index += 1;
    } else if (item === "--debounce") {
      parsed.debounce = Number(next);
      index += 1;
    } else if (item === "--no-diff") {
      parsed.diff = false;
    } else if (item === "--no-contents") {
      parsed.contents = false;
    } else if (item === "--force") {
      parsed.force = true;
    }
  }
  return parsed;
}

function shouldIgnore(filename, outputPath) {
  const normalized = filename.replace(/\\/g, "/");
  const output = (outputPath || "TOKENCAP.md").replace(/\\/g, "/");
  return (
    normalized.includes("/.git/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/build/") ||
    normalized.includes("/coverage/") ||
    normalized.endsWith(output) ||
    normalized === output ||
    normalized.endsWith(".tokencap.json")
  );
}

function printHelp() {
  console.log(`
TokenCap

Usage:
  tokencap make [options]
  tokencap watch [options]
  tokencap init [--force]
  tokencap config [options]

Options:
  --root <path>             Workspace root. Default: current directory
  --out <path>              Snapshot output path. Default: TOKENCAP.md
  --profile <name>          compact, balanced, deep, gpt-4o, claude-3-5-sonnet, gemini-1.5-flash, gemini-1.5-pro, llama-3-8b
  --max-files <number>      Maximum files to include
  --max-bytes <number>      Source byte budget
  --max-file-bytes <number> Per-file content budget
  --max-diff-bytes <number> Git diff budget
  --debounce <ms>           Watch debounce. Default: 30000
  --no-diff                 Skip Git diff snippets
  --no-contents             Skip selected file contents
`);
}
