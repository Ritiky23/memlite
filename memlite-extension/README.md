# 🧠 MemLite: Local AI Memory Hub & Tiered Recovery Engine

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://open-vsx.org/extension/memlite/memlite-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](https://opensource.org/licenses/MIT)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-100%25%20Local-green.svg)](#-privacy-first)

**Give your IDE AI assistant long-term memory and bulletproof context recovery.**

MemLite is a local-first, private memory engine and visual dashboard for your IDE. It indexes conversations, tool executions, and file edits into an interactive neural mind map and generates **Tiered Agent Recovery Capsules** to instantly restore state across sessions without context rot.

![MemLite Visual Mind Map and Context Cart](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/dashboard.png)

---

## ⚡ What's New in v2.0

* **🛡️ Tiered Agent Recovery Capsules:** Compile bulletproof prompt capsules categorized into Tier 0 (Invariants), Tier 1 (Causal File Provenance), and Tier 2 (Semantic Intent).
* **🔍 AST Symbol Extraction:** Automatically parses modified classes, functions, and symbols on code diffs and file creations.
* **⚡ Zero-Lag Architecture:** High-performance `O(1)` indexed step lookup, bounded transcript scanning, and lazy-rendered DOM pagination — zero IDE lag even with thousands of memories.
* **🎯 Workspace Scoping & Isolation:** Multi-project isolation ensures your active project view only displays relevant memories and actions.
* **🧼 One-Click Memory Pruning:** Clean up foreign or orphaned entries with the new Prune button.

---

## 🚀 Key Features

### 1. ⚡ Tiered Context Recovery
Recover crashed or compacted agent sessions with zero loss of critical context:
* **🔒 Tier 0: Invariants & Constraints:** Enforces hard rules (forbidden libraries, API schemas, style constraints) with 100% fidelity.
* **⚡ Tier 1: Causal File Provenance:** Tracks every file edit, creation, line delta, and modified symbol (`function`, `class`) with exact SHA-256 freshness validation.
* **🧠 Tier 2: Semantic Intent:** Captures user goals, reasoning, and context summaries.

### 2. 🎨 Studio Visual Neural Map
* **Collapsible Chat Hubs:** Visually clusters chat sessions. Click on any hub to expand or collapse chronological questions (`Q1` → `Q2` → `Q3`).
* **Interactive Tooltips & Diff Viewer:** Hover over any node to inspect queries, answers, affected files, and line changes with full syntax highlighting.
* **Chronological Timeline & Recovery Deck:** Switch seamlessly between the visual canvas, timeline view, and file provenance deck.

### 3. 🛒 Multi-Select Context Cart
* Pick and choose past Q&As and code changes across multiple sessions.
* Automatically syncs to `.memlite_context.md` at your workspace root (auto-added to `.gitignore`).
* Inject into Copilot, Claude, Gemini, or Codex by referencing `@.memlite_context.md` or dragging it directly into the chat prompt.

---

## 🛠️ Getting Started

### Installation
1. Search for **MemLite** in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**.
2. Or download the VSIX package from [Open VSX](https://open-vsx.org/extension/memlite/memlite-extension) or [GitHub Releases](https://github.com/Ritiky23/memlite/releases).

### Launching the Dashboard
* Click the **Brain icon (🧠)** in your IDE Activity Bar.
* Or open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
  ```text
  MemLite: Show Visual Map
  ```

---

## ⌨️ Command Registry

| Command | Description |
| :--- | :--- |
| `MemLite: Show Visual Map` | Opens the full-tab interactive neural mind map and recovery deck |
| `MemLite: Export Memory` | Exports your local SQLite memory database as a JSON backup |
| `MemLite: Import Memory` | Imports and merges external memories into your local storage |
| `MemLite: Clear All Memory` | Safely clears stored conversations and file actions for the project |

---

## 🔒 Privacy First

* **100% Offline & Local:** Everything runs locally on your machine.
* **Zero Telemetry / Zero Cloud Calls:** Transcripts, embeddings, and diff summaries reside exclusively in your IDE's user storage directory.
* **No Cloud Accounts Required:** No API keys or accounts needed to organize and browse your local memory.

---

## 📄 License

MIT © [Ritik Yadav](https://github.com/Ritiky23)
