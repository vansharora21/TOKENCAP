const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const DEFAULT_CONFIG = {
  outputPath: "TOKENCAP.md",
  profile: "balanced",
  maxFiles: 90,
  maxSourceBytes: 220000,
  maxFileBytes: 14000,
  maxTreeEntries: 220,
  maxTodos: 100,
  maxDiffBytes: 50000,
  includeGitDiff: true,
  includeFileContents: true,
  includePatterns: [],
  excludePatterns: [],
  redactSecrets: true
};

const PROFILE_OVERRIDES = {
  compact: {
    maxFiles: 45,
    maxSourceBytes: 90000,
    maxFileBytes: 8000,
    maxDiffBytes: 22000
  },
  balanced: {},
  deep: {
    maxFiles: 140,
    maxSourceBytes: 420000,
    maxFileBytes: 22000,
    maxDiffBytes: 90000
  },
  "gpt-4o": {
    maxFiles: 80,
    maxSourceBytes: 150000,
    maxFileBytes: 10000,
    maxDiffBytes: 40000
  },
  "claude-3-5-sonnet": {
    maxFiles: 120,
    maxSourceBytes: 250000,
    maxFileBytes: 15000,
    maxDiffBytes: 60000
  },
  "gemini-1.5-flash": {
    maxFiles: 200,
    maxSourceBytes: 600000,
    maxFileBytes: 30000,
    maxDiffBytes: 150000
  },
  "gemini-1.5-pro": {
    maxFiles: 400,
    maxSourceBytes: 1200000,
    maxFileBytes: 60000,
    maxDiffBytes: 300000
  },
  "llama-3-8b": {
    maxFiles: 25,
    maxSourceBytes: 40000,
    maxFileBytes: 4000,
    maxDiffBytes: 12000
  }
};

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".vscode-test",
  "__pycache__",
  ".pytest_cache",
  "target",
  "obj",
  "vendor"
]);

const DEFAULT_IGNORE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock"
]);

const IMPORTANT_NAMES = new Set([
  ".tokencap.json",
  "package.json",
  "README.md",
  "START_HERE.md",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.js",
  "next.config.mjs"
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".clj",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".lua",
  ".md",
  ".mjs",
  ".php",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);

const VALID_PROFILES = new Set(Object.keys(PROFILE_OVERRIDES));

function makeCapsule(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const config = resolveConfig(root, options);
  validateConfig(config);
  const outputPath = path.resolve(root, config.outputPath);
  const now = new Date().toISOString();
  const git = getGitContext(root, config);
  const files = collectFiles(root, outputPath, config);
  const rankedFiles = rankFiles(files, git.changedPaths);
  const selectedFiles = selectFiles(rankedFiles, config.maxFiles, config.maxSourceBytes);
  const sourceBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const todoNotesList = collectTodoNotes(selectedFiles);
  const diffLength = git.stagedDiff.length + git.unstagedDiff.length;
  const tokenEstimate = estimateTokens(sourceBytes + diffLength);

  const capsule = [
    "# TokenCap Snapshot",
    "",
    metadataTable({
      Generated: now,
      Workspace: root,
      Profile: config.profile,
      "Selected files": selectedFiles.length,
      "Source bytes": sourceBytes,
      "Estimated tokens": tokenEstimate
    }),
    "",
    "## Read First",
    "",
    "This file is a compressed coding-session handoff. Read it before editing, then inspect the referenced files directly. Prefer the live repository over this snapshot when there is a conflict.",
    "",
    "## Handoff Summary",
    "",
    handoffSummary({ selectedFiles, git, config, sourceBytes, tokenEstimate, todoCount: todoNotesList.length }),
    "",
    "## Operating Rules For The Next Agent",
    "",
    "- Preserve user changes and do not revert unrelated work.",
    "- Start with changed files and files marked `high-signal` in the manifest.",
    "- Use the Git diff as intent, not as a complete source of truth.",
    "- Refresh this capsule after meaningful edits or before ending the session.",
    "",
    "## Git Snapshot",
    "",
    gitSnapshot(git),
    "",
    "## Project Map",
    "",
    "```text",
    treeSummary(files, config.maxTreeEntries),
    "```",
    "",
    "## File Manifest",
    "",
    fileManifest(selectedFiles),
    "",
    "## Changed Files",
    "",
    changedFiles(git.statusLines),
    "",
    "## Git Diff Snippets",
    "",
    gitDiffSection(git),
    "",
    "## TODO / FIXME / HACK Notes",
    "",
    todoNotes(todoNotesList, config),
    "",
    "## Selected File Context",
    "",
    config.includeFileContents ? fileSections(selectedFiles, config) : "File contents disabled by configuration."
  ].join("\n");

  fs.writeFileSync(outputPath, capsule, "utf8");
  return {
    outputPath,
    fileCount: selectedFiles.length,
    byteCount: Buffer.byteLength(capsule, "utf8"),
    estimatedTokens: estimateTokens(Buffer.byteLength(capsule, "utf8")),
    config
  };
}

function resolveConfig(root, options) {
  const fileConfig = readJson(path.join(root, ".tokencap.json"));
  const profile = options.profile || fileConfig.profile || DEFAULT_CONFIG.profile;
  const profileConfig = PROFILE_OVERRIDES[profile] || {};
  return {
    ...DEFAULT_CONFIG,
    ...profileConfig,
    ...fileConfig,
    ...definedOnly({
      outputPath: options.outputPath,
      profile,
      maxFiles: numberOrUndefined(options.maxFiles),
      maxSourceBytes: numberOrUndefined(options.maxBytes || options.maxSourceBytes),
      maxFileBytes: numberOrUndefined(options.maxFileBytes),
      maxDiffBytes: numberOrUndefined(options.maxDiffBytes),
      includeGitDiff: booleanOrUndefined(options.includeGitDiff),
      includeFileContents: booleanOrUndefined(options.includeFileContents)
    })
  };
}

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    errors.push("config must be an object");
  } else {
    if (!VALID_PROFILES.has(config.profile)) {
      errors.push(`profile must be one of ${[...VALID_PROFILES].join(", ")}`);
    }

    for (const key of ["maxFiles", "maxSourceBytes", "maxFileBytes", "maxTreeEntries", "maxDiffBytes"]) {
      if (!Number.isFinite(config[key]) || config[key] <= 0) {
        errors.push(`${key} must be a positive number`);
      }
    }

    if (!Number.isFinite(config.maxTodos) || config.maxTodos < 0) {
      errors.push("maxTodos must be zero or a positive number");
    }

    if (typeof config.outputPath !== "string" || config.outputPath.trim() === "") {
      errors.push("outputPath must be a non-empty string");
    }

    for (const key of ["includePatterns", "excludePatterns"]) {
      if (!Array.isArray(config[key]) || !config[key].every((value) => typeof value === "string")) {
        errors.push(`${key} must be an array of strings`);
      }
    }

    for (const key of ["includeGitDiff", "includeFileContents", "redactSecrets"]) {
      if (typeof config[key] !== "boolean") {
        errors.push(`${key} must be a boolean`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid TokenCap configuration: ${errors.join("; ")}`);
  }
}

function collectFiles(root, outputPath, config) {
  const results = [];
  walk(root);
  return results;

  function walk(dir) {
    const entries = safeReadDir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizePath(path.relative(root, fullPath));

      if (fullPath === outputPath) continue;
      if (entry.isDirectory()) {
        if (!shouldExcludeDirectory(entry.name, relativePath, config)) walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldExcludeFile(entry.name, relativePath, config)) continue;
      if (!isTextFile(fullPath)) continue;

      const stat = safeStat(fullPath);
      if (!stat || stat.size > Math.max(config.maxFileBytes * 3, 200000)) continue;
      results.push({ fullPath, relativePath, size: stat.size });
    }
  }
}

function shouldExcludeDirectory(name, relativePath, config) {
  if (DEFAULT_IGNORE_DIRS.has(name)) return true;
  return matchesAny(relativePath, config.excludePatterns);
}

function shouldExcludeFile(name, relativePath, config) {
  if (DEFAULT_IGNORE_FILES.has(name)) return true;
  if (relativePath === config.outputPath.replace(/\\/g, "/")) return true;
  if (config.includePatterns.length > 0 && !matchesAny(relativePath, config.includePatterns)) return true;
  return matchesAny(relativePath, config.excludePatterns);
}

function rankFiles(files, changedPaths) {
  return files
    .map((file) => {
      const base = path.basename(file.relativePath);
      const reasons = [];
      let score = 0;

      if (changedPaths.has(file.relativePath)) {
        score += 120;
        reasons.push("changed");
      }
      if (IMPORTANT_NAMES.has(base)) {
        score += 70;
        reasons.push("project-metadata");
      }
      if (file.relativePath.startsWith("src/") || file.relativePath.includes("/src/")) {
        score += 30;
        reasons.push("source");
      }
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file.relativePath) || file.relativePath.includes("/test")) {
        score += 18;
        reasons.push("test");
      }
      if (/README|START_HERE|CONTRIBUTING|ARCHITECTURE/i.test(base)) {
        score += 35;
        reasons.push("high-signal-doc");
      }
      score -= Math.floor(file.size / 12000);

      return { ...file, score, reasons: reasons.length ? reasons : ["context"] };
    })
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
}

function selectFiles(files, maxFiles, maxBytes) {
  const selected = [];
  let used = 0;
  for (const file of files) {
    if (selected.length >= maxFiles) break;
    if (used + file.size > maxBytes && selected.length > 0) continue;
    selected.push(file);
    used += file.size;
  }
  return selected;
}

function getGitContext(root, config) {
  const statusLines = gitLines(root, ["status", "--short"]);
  const changedPaths = new Set(statusLines.map(parseStatusPath).filter(Boolean));
  let stagedDiff = "";
  let unstagedDiff = "";
  if (config.includeGitDiff) {
    const rawStaged = gitText(root, ["diff", "--cached", "--no-ext-diff"]);
    const rawUnstaged = gitText(root, ["diff", "--no-ext-diff"]);
    stagedDiff = trimText(rawStaged, Math.floor(config.maxDiffBytes / 2));
    unstagedDiff = trimText(rawUnstaged, Math.floor(config.maxDiffBytes / 2));
  }
  return {
    branch: gitText(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unavailable",
    root: gitText(root, ["rev-parse", "--show-toplevel"]) || "unavailable",
    statusLines,
    changedPaths,
    recentCommits: gitLines(root, ["log", "--oneline", "-8"]),
    stagedDiff,
    unstagedDiff
  };
}

function gitDiffSection(git) {
  const sections = [];
  if (git.stagedDiff) {
    sections.push("### Staged Changes Diff\n\n```diff\n" + git.stagedDiff.trim() + "\n```");
  }
  if (git.unstagedDiff) {
    sections.push("### Unstaged Changes Diff\n\n```diff\n" + git.unstagedDiff.trim() + "\n```");
  }
  if (sections.length === 0) {
    return "No diff available, or Git is unavailable.";
  }
  return sections.join("\n\n");
}

function gitSnapshot(git) {
  return [
    metadataTable({
      Branch: git.branch,
      "Git root": git.root
    }),
    "",
    "Recent commits:",
    "```text",
    git.recentCommits.join("\n") || "unavailable",
    "```",
    "",
    "Status:",
    "```text",
    git.statusLines.join("\n") || "clean or unavailable",
    "```"
  ].join("\n");
}

function treeSummary(files, maxEntries) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join("/"));
    }
  }

  const lines = [];
  for (const dir of [...dirs].sort()) lines.push(`${dir}/`);
  for (const file of files.map((item) => item.relativePath).sort()) lines.push(file);
  const limited = lines.slice(0, maxEntries);
  if (lines.length > limited.length) limited.push(`... ${lines.length - limited.length} more entries omitted`);
  return limited.join("\n") || "No text files found.";
}

function fileManifest(files) {
  if (files.length === 0) return "No files selected.";
  const rows = ["| File | Bytes | Score | Why |", "| --- | ---: | ---: | --- |"];
  for (const file of files) {
    rows.push(`| ${escapeTable(file.relativePath)} | ${file.size} | ${file.score} | ${escapeTable(file.reasons.join(", "))} |`);
  }
  return rows.join("\n");
}

function changedFiles(statusLines) {
  if (statusLines.length === 0) return "No Git changes found, or this is not a Git repository.";
  return statusLines.map((line) => `- ${line}`).join("\n");
}

function handoffSummary({ selectedFiles, git, config, sourceBytes, tokenEstimate, todoCount }) {
  const readOrder = selectedFiles.slice(0, 5).map((file) => file.relativePath).join(" > ") || "No files selected.";
  const primaryAnchors = selectedFiles.slice(0, 3).map((file) => file.relativePath).join(", ") || "No files selected.";
  const fileBudgetUsed = `${Math.round((selectedFiles.length / Math.max(config.maxFiles, 1)) * 100)}%`;
  const sourceBudgetUsed = `${Math.round((sourceBytes / Math.max(config.maxSourceBytes, 1)) * 100)}%`;

  return metadataTable({
    "Read order": readOrder,
    "Primary anchors": primaryAnchors,
    "Changed files": git.statusLines.length,
    "TODO notes": todoCount,
    "File budget used": fileBudgetUsed,
    "Source budget used": sourceBudgetUsed,
    "Token estimate": tokenEstimate,
    "Contents mode": config.includeFileContents ? "enabled" : "disabled"
  });
}

function collectTodoNotes(files) {
  const notes = [];
  for (const file of files) {
    const text = safeReadText(file.fullPath);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\b(TODO|FIXME|HACK)\b/i.test(line)) {
        notes.push({
          relativePath: file.relativePath,
          lineNumber: index + 1,
          line: line.trim().slice(0, 220)
        });
      }
    });
  }
  return notes;
}

function todoNotes(notes, config) {
  return notes.slice(0, config.maxTodos).map((note) => `- ${note.relativePath}:${note.lineNumber} ${note.line}`).join("\n") || "No TODO/FIXME/HACK notes found in selected files.";
}

function fileSections(files, config) {
  if (files.length === 0) return "No files selected.";
  return files
    .map((file) => {
      const raw = safeReadText(file.fullPath);
      const text = config.redactSecrets ? redactSecrets(raw) : raw;
      const language = languageFor(file.fullPath);
      const isTruncated = Buffer.byteLength(text, "utf8") > config.maxFileBytes;
      const trimmed = trimText(text, config.maxFileBytes).trimEnd();
      const outline = isTruncated ? generateStructuralOutline(text, language) : "";
      return [
        `### ${file.relativePath}`,
        "",
        metadataTable({
          Bytes: file.size,
          Score: file.score,
          Why: file.reasons.join(", "),
          Status: isTruncated ? "Truncated (budget limit)" : "Full content"
        }),
        "",
        outline ? outline + "\n" : "",
        `\`\`\`${language}`,
        trimmed,
        "```"
      ].join("\n");
    })
    .join("\n\n");
}

function generateStructuralOutline(text, language) {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const outline = [];
  
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;
    
    // Class / Struct / Interface / Impl / Enum / Namespace
    const classMatch = line.match(/\b(class|struct|interface|impl|enum|namespace)\s+([a-zA-Z0-9_$]+)/);
    if (classMatch) {
      outline.push(`  - \`${classMatch[1]} ${classMatch[2]}\` (line ${idx + 1})`);
      continue;
    }
    
    // JS/TS functions
    const functionMatch = line.match(/\bfunction\s+([a-zA-Z0-9_$]+)\s*\(/) || 
                          line.match(/\bconst\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/) ||
                          line.match(/\b(export\s+)?(async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/);
    if (functionMatch) {
      const name = functionMatch[3] || functionMatch[1];
      if (!/^(if|for|while|switch|catch|function|class|return)$/.test(name)) {
        outline.push(`  - \`fn ${name}\` (line ${idx + 1})`);
        continue;
      }
    }

    // Python / Ruby
    if (language === "py" || language === "rb" || language === "python") {
      const pyMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/) || line.match(/^\s*class\s+([a-zA-Z0-9_]+)/);
      if (pyMatch) {
        outline.push(`  - \`def ${pyMatch[1]}\` (line ${idx + 1})`);
        continue;
      }
    }
    
    // Rust
    if (language === "rs" || language === "rust") {
      const rustMatch = line.match(/\bfn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (rustMatch) {
        outline.push(`  - \`fn ${rustMatch[1]}\` (line ${idx + 1})`);
        continue;
      }
    }
    
    // Go
    if (language === "go") {
      const goMatch = line.match(/\bfunc\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
      if (goMatch) {
        outline.push(`  - \`func ${goMatch[1]}\` (line ${idx + 1})`);
        continue;
      }
    }
  }
  
  if (outline.length === 0) return "";
  return "**Structural Outline:**\n" + outline.slice(0, 30).join("\n") + (outline.length > 30 ? `\n  - ... and ${outline.length - 30} more definitions` : "") + "\n";
}

function parseStatusPath(line) {
  const raw = line.slice(3).trim();
  if (!raw) return "";
  const renamed = raw.split(" -> ");
  return normalizePath(renamed[renamed.length - 1]);
}

function redactSecrets(text) {
  if (!text) return "";
  return text
    .replace(/(api[_-]?key|token|secret|password|passwd|pwd)(\s*[:=]\s*)(["']?)[^"'\s]+/gi, "$1$2$3[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{20,}/gi, "$1[REDACTED]")
    .replace(/(sk-[a-zA-Z0-9_-]{12,})/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\b(ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]");
}

function trimText(text, maxBytes) {
  if (!text) return "";
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  return `${buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "")}\n\n/* ...truncated for capsule budget... */`;
}

function languageFor(filePath) {
  const ext = path.extname(filePath).slice(1);
  if (ext === "ps1") return "powershell";
  if (ext === "md") return "markdown";
  if (ext === "yml") return "yaml";
  return ext;
}

function isTextFile(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith(".env")) return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => matchPattern(relativePath, pattern));
}

function matchPattern(relativePath, pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (normalized.endsWith("/**")) return relativePath.startsWith(normalized.slice(0, -3));
  if (normalized.startsWith("**/")) return relativePath.endsWith(normalized.slice(3));
  if (normalized.includes("*")) {
    const regex = new RegExp(`^${escapeRegex(normalized).replace(/\\\*/g, ".*")}$`);
    return regex.test(relativePath);
  }
  return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
}

function metadataTable(values) {
  const rows = ["| Field | Value |", "| --- | --- |"];
  for (const [key, value] of Object.entries(values)) rows.push(`| ${escapeTable(key)} | ${escapeTable(String(value))} |`);
  return rows.join("\n");
}

function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function gitText(root, args) {
  const lines = gitLines(root, args);
  return lines.join("\n").trim();
}

function gitLines(root, args) {
  try {
    const output = childProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 6000
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanOrUndefined(value) {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function definedOnly(values) {
  return Object.fromEntries(Object.entries(values).filter((entry) => entry[1] !== undefined));
}

function escapeRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTable(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

module.exports = {
  DEFAULT_CONFIG,
  makeCapsule,
  resolveConfig
};
