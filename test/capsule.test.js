const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeCapsule } = require("../src/capsule");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-capsule-test-"));
fs.mkdirSync(path.join(root, "src"));
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "sample" }, null, 2), "utf8");
fs.writeFileSync(
  path.join(root, "src", "index.js"),
  "const apiKey = 'sk-testsecretvalue1234567890';\n// TODO: improve this\nconsole.log(apiKey);\n",
  "utf8"
);

const result = makeCapsule({
  root,
  outputPath: "TOKENCAP.md",
  maxFiles: 10,
  maxBytes: 50000
});

const capsule = fs.readFileSync(result.outputPath, "utf8");

assert.match(capsule, /# TokenCap Snapshot/);
assert.match(capsule, /## Handoff Summary/);
assert.match(capsule, /\| Read order \| package\.json > src\/index\.js \|/);
assert.match(capsule, /\| TODO notes \| 1 \|/);
assert.match(capsule, /## File Manifest/);
assert.match(capsule, /src\/index\.js/);
assert.match(capsule, /\[REDACTED\]/);
assert.doesNotMatch(capsule, /sk-testsecretvalue1234567890/);
assert.match(capsule, /TODO: improve this/);
assert.equal(result.fileCount >= 2, true);

console.log("capsule smoke test passed");
