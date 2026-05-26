const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-capsule-watcher-test-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "watcher-test" }, null, 2), "utf8");
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    "console.log('hello');\n",
    "utf8"
  );

  const binPath = path.resolve(__dirname, "../bin/tokencap.js");
  const capsulePath = path.join(root, "TEST_TOKENCAP.md");

  console.log("Spawning CLI watch mode in background...");
  const watcher = childProcess.spawn("node", [
    binPath,
    "watch",
    "--root", root,
    "--out", "TEST_TOKENCAP.md",
    "--debounce", "200"
  ]);

  let stdoutBuffer = "";
  watcher.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
  });

  watcher.stderr.on("data", (data) => {
    console.error("Watcher stderr:", data.toString());
  });

  // Wait for watch mode to initialize
  await new Promise((resolve) => setTimeout(resolve, 1500));

  assert.equal(fs.existsSync(capsulePath), true, "Initial snapshot should be created immediately when starting watch");
  const initialContent = fs.readFileSync(capsulePath, "utf8");
  assert.match(initialContent, /hello/, "Initial content should include src/index.js code");

  // Modify index.js to trigger regeneration
  console.log("Modifying watched file...");
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    "console.log('modified hello');\n",
    "utf8"
  );

  // Wait for stability threshold + debounce + processing time
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const updatedContent = fs.readFileSync(capsulePath, "utf8");
  assert.match(updatedContent, /modified hello/, "Regenerated snapshot should contain the file changes");

  console.log("Stopping watch process...");
  watcher.kill();

  // Clean up
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }

  console.log("watcher integration test passed successfully");
}

main().catch((error) => {
  console.error("Watcher integration test failed:", error);
  process.exit(1);
});
