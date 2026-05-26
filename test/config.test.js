const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeCapsule } = require("../src/capsule");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-capsule-config-test-"));
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "sample" }, null, 2), "utf8");
fs.writeFileSync(
  path.join(root, ".tokencap.json"),
  JSON.stringify({ profile: "broken", maxFiles: 0, includePatterns: "nope" }, null, 2),
  "utf8"
);

assert.throws(
  () => makeCapsule({ root, outputPath: "TOKENCAP.md" }),
  /Invalid TokenCap configuration:/
);

console.log("config validation test passed");