# TokenCap

TokenCap is an automatic coding handoff utility. It generates a production-ready, highly compressed `TOKENCAP.md` snapshot of your workspace.

When your coding session is near a handoff point or you need to capture context, this snapshot provides the key files, Git status, diffs, project map, and handoff notes to help another developer or tool continue work.

---

## Getting Started

1. Open your project/workspace folder in VS Code or Cursor.
2. Edit and save any source file in your project.
3. Open `TOKENCAP.md` in the root of your workspace. The extension automatically generates and updates it!

---

## Key Features

- **Auto Capture on Save**: Debounces and regenerates the snapshot automatically after file saves (enabled by default).
- **Dynamic Status Bar Display**: Displays auto capture status and the last update timestamp in the status bar (e.g. `$(files) TokenCap • 12:34 PM`).
- **One-Click Command Menu**: Click the status bar item to open a Quick-Pick menu with commands to:
  - **Make Snapshot Now**: Force regeneration.
  - **Open TokenCap Snapshot**: Open the snapshot in your editor.
  - **Toggle Auto Capture**: Turn auto-saving capture ON/OFF.
  - **Create Config File**: Generate a default configuration.
- **Separated Git Diffs**: Staged and unstaged changes are separated and formatted cleanly in diff code blocks.
- **Structural Outlines for Truncated Files**: If a file is too large for the token budget, it gets truncated, but a regex outline of its classes, methods, and functions is printed at the top.
- **Secret Redaction**: Automatically filters out OpenAI keys (`sk-...`), GitHub Personal Access Tokens (`ghp_...`, `github_pat_...`), Slack tokens, AWS tokens, and standard password/API variables before they write to the snapshot.

---

## Configuration & Profiles

To customize settings, create a `.tokencap.json` file in the root of your workspace:

```json
{
  "profile": "balanced",
  "outputPath": "TOKENCAP.md",
  "maxFiles": 90,
  "maxSourceBytes": 220000,
  "maxFileBytes": 14000,
  "includeGitDiff": true,
  "includeFileContents": true,
  "excludePatterns": ["node_modules/**", "dist/**", "build/**", "coverage/**"],
  "redactSecrets": true
}
```

### Context Profiles
Use a profile to match different context sizes and capture depth:
- **`compact`**: Smaller snapshot for tight context windows (max 45 files, 90KB budget).
- **`balanced`**: Default production profile (max 90 files, 220KB budget).
- **`deep`**: Deeper capture for complex codebases (max 140 files, 420KB budget).
- **`gpt-4o`**, **`claude-3-5-sonnet`**, **`gemini-1.5-flash`**, **`gemini-1.5-pro`**, **`llama-3-8b`**: These are advanced profiles that adjust budgets for larger or smaller context targets. Use the named profile when you need a different capture budget; otherwise stick with `compact`, `balanced`, or `deep`.

---

## Command Line Usage (Optional)

You can also run the tool from the command line outside of VS Code.

### Installation
Install the package globally:
```cmd
npm install -g tokencap
```

### Commands
Run commands from your project root:
```cmd
:: Generate a snapshot
tokencap make

:: Watch workspace and regenerate on save
tokencap watch --debounce 3000

:: Create a local project config
tokencap init

:: Print resolved configuration
tokencap config
```

### Options
```cmd
:: Custom workspace root, output file, file budgets
tokencap make --root . --out TOKENCAP.md --max-files 90 --max-bytes 220000

:: Skip Git diff snippets
tokencap make --no-diff

:: Skip source file contents
tokencap make --no-contents
```
