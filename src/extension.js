const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { DEFAULT_CONFIG, makeCapsule } = require("./capsule");

let autoCapture = true;
let pendingTimer = null;
let statusBarItem = null;
let lastRunSummary = null;

function activate(context) {
  autoCapture = getConfig().get("autoCapture", true);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "tokencap.showMenu";
  context.subscriptions.push(statusBarItem);
  updateStatusBar("Ready");

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencap.showMenu", async () => {
      const items = [
        { label: "Make Snapshot Now", description: "Regenerate the TokenCap snapshot", command: "tokencap.make" },
        { label: "Open TokenCap Snapshot", description: "Open TOKENCAP.md", command: "tokencap.open" },
        { label: "Toggle Auto Capture", description: `Turn auto capture ${autoCapture ? "OFF" : "ON"}`, command: "tokencap.toggleAuto" },
        { label: "Create Config File", description: "Generate .tokencap.json", command: "tokencap.initConfig" }
      ];
      
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a TokenCap command"
      });
      
      if (selection) {
        vscode.commands.executeCommand(selection.command);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencap.make", async () => {
      await runCommand("Generating snapshot", () => makeForWorkspace(true));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencap.open", async () => {
      await runCommand("Opening snapshot", openCapsule);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencap.initConfig", async () => {
      await runCommand("Creating config", initConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencap.toggleAuto", async () => {
      autoCapture = !autoCapture;
      vscode.window.showInformationMessage(`TokenCap auto capture: ${autoCapture ? "on" : "off"}`);
      updateStatusBar(autoCapture ? "Auto capture enabled" : "Auto capture disabled");
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!autoCapture || document.uri.scheme !== "file") return;
      if (document.fileName.endsWith(getOutputPath())) return;
      if (document.fileName.endsWith(".tokencap.json")) return;
      updateStatusBar("Change detected; refresh queued");
      scheduleMake();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("tokencap")) {
        autoCapture = getConfig().get("autoCapture", true);
        updateStatusBar("Configuration updated");
      }
    })
  );
}

function deactivate() {
  clearTimeout(pendingTimer);
  if (statusBarItem) statusBarItem.dispose();
}

function scheduleMake() {
  const debounceMs = getConfig().get("debounceMs", 30000);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    makeForWorkspace(false).catch((error) => {
      updateStatusBar(`Failed: ${error.message}`);
      vscode.window.showWarningMessage(`TokenCap failed: ${error.message}`);
    });
  }, debounceMs);
}

async function makeForWorkspace(showMessage) {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace folder before creating a snapshot.");
    return null;
  }

  const settings = getConfig();
  const result = makeCapsule({
    root: workspaceFolder.uri.fsPath,
    outputPath: settings.get("outputPath", DEFAULT_CONFIG.outputPath),
    profile: settings.get("profile", DEFAULT_CONFIG.profile),
    maxFiles: settings.get("maxFiles", DEFAULT_CONFIG.maxFiles),
    maxBytes: settings.get("maxSourceBytes", DEFAULT_CONFIG.maxSourceBytes),
    maxFileBytes: settings.get("maxFileBytes", DEFAULT_CONFIG.maxFileBytes),
    maxDiffBytes: settings.get("maxDiffBytes", DEFAULT_CONFIG.maxDiffBytes),
    includeGitDiff: settings.get("includeGitDiff", DEFAULT_CONFIG.includeGitDiff),
    includeFileContents: settings.get("includeFileContents", DEFAULT_CONFIG.includeFileContents)
  });
  lastRunSummary = {
    at: new Date(),
    fileCount: result.fileCount,
    estimatedTokens: result.estimatedTokens
  };
  updateStatusBar(`Updated ${formatTime(lastRunSummary.at)}`);

  if (showMessage) {
    const open = "Open";
    const choice = await vscode.window.showInformationMessage(
      `TokenCap snapshot written: ${result.fileCount} files, about ${result.estimatedTokens} tokens.`,
      open
    );
    if (choice === open) await openDocument(result.outputPath);
  }

  return result;
}

async function openCapsule() {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace folder before opening a snapshot.");
    return;
  }

  const snapshotPath = path.resolve(workspaceFolder.uri.fsPath, getOutputPath());
  if (!fs.existsSync(snapshotPath)) {
    const make = "Make Now";
    const choice = await vscode.window.showInformationMessage("No TokenCap snapshot exists yet.", make);
    if (choice === make) await makeForWorkspace(true);
    return;
  }
  await openDocument(snapshotPath);
}

async function initConfig() {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace folder before creating config.");
    return;
  }

  const configPath = path.join(workspaceFolder.uri.fsPath, ".tokencap.json");
  if (!fs.existsSync(configPath)) {
    const config = {
      profile: "balanced",
      outputPath: "TOKENCAP.md",
      maxFiles: DEFAULT_CONFIG.maxFiles,
      maxSourceBytes: DEFAULT_CONFIG.maxSourceBytes,
      maxFileBytes: DEFAULT_CONFIG.maxFileBytes,
      includeGitDiff: true,
      includeFileContents: true,
      excludePatterns: ["node_modules/**", "dist/**", "build/**", "coverage/**"],
      redactSecrets: true
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  await openDocument(configPath);
}

async function openDocument(filePath) {
  const document = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(document);
}

async function runCommand(statusMessage, action) {
  try {
    updateStatusBar(statusMessage);
    return await action();
  } catch (error) {
    updateStatusBar(`Failed: ${error.message}`);
    vscode.window.showWarningMessage(`TokenCap failed: ${error.message}`);
    return null;
  }
}

function getWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) return vscode.workspace.getWorkspaceFolder(active) || folders[0];
  return folders[0];
}

function getConfig() {
  return vscode.workspace.getConfiguration("tokencap");
}

function getOutputPath() {
  return getConfig().get("outputPath", DEFAULT_CONFIG.outputPath);
}

function updateStatusBar(message) {
  if (!statusBarItem) return;
  let timeStr = "";
  if (lastRunSummary && lastRunSummary.at) {
    timeStr = ` • ${formatTime(lastRunSummary.at)}`;
  }
  statusBarItem.text = autoCapture ? `$(files) TokenCap${timeStr}` : "$(files) TokenCap Off";
  statusBarItem.tooltip = [
    "TokenCap",
    `Status: ${message}`,
    `Auto capture: ${autoCapture ? "on" : "off"}`,
    lastRunSummary
      ? `Last run: ${formatTime(lastRunSummary.at)} (${lastRunSummary.fileCount} files, ${lastRunSummary.estimatedTokens} tokens)`
      : "Last run: never"
  ].join("\n");
  statusBarItem.show();
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

module.exports = {
  activate,
  deactivate
};
