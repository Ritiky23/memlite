# MemLite

[![Version](https://img.shields.io/badge/version-2.0.0-18181b.svg?style=flat-square)](https://open-vsx.org/extension/memlite/memlite-extension)
[![License: MIT](https://img.shields.io/badge/license-MIT-18181b.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Storage](https://img.shields.io/badge/storage-local--first-18181b.svg?style=flat-square)](#privacy--architecture)

Local memory engine and context recovery system for IDE chat assistants.

MemLite tracks conversations, file modifications, and agent executions locally in SQLite. It compiles structured **Tiered Context Recovery Capsules** to restore agent state across sessions without context drift or token waste.

![MemLite Visual Neural Map](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/memlite_ss1.png)

![MemLite Context Recovery Deck](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/memlite_ss2.png)

---

## Overview

During long programming sessions or agent compaction cycles, coding assistants lose crucial historical context—such as architectural constraints, recently modified symbols, and file provenance. MemLite solves this by maintaining an offline, chronological index of your workspace activity and synthesizing deterministic context capsules on demand.

### Highlights in v2.0

- **Tiered Context Recovery**: Structured context compilation categorized into Invariants (Tier 0), Causal File Provenance (Tier 1), and Semantic Intent (Tier 2).
- **AST Symbol Extraction**: Automatic detection of modified classes, functions, and symbols across file edits and creations.
- **Sub-Millisecond Lookup**: `O(1)` indexed step retrieval, bounded log parsing, and lazy DOM rendering prevent UI stalls even with thousands of historical records.
- **Workspace Scoping**: Strict project-level isolation ensures only relevant transcripts and edits appear in the active view.

---

## Core Capabilities

### Tiered Recovery Architecture

1. **Tier 0 — Invariants & Constraints**  
   Verbatim preservation of user guidelines, architectural contracts, and operational constraints that must never decay.

2. **Tier 1 — Causal File Provenance**  
   Deterministic record of every file change, line delta, and symbol touched by the assistant, backed by SHA-256 integrity checks.

3. **Tier 2 — Semantic Intent**  
   Synthesized summaries of user inquiries and agent reasoning steps for conversational continuity.

### Visual Neural Map & Timeline

- **Hierarchical Chat Hubs**: Collapsible session clusters that expand chronological questions (`Q1` → `Q2` → `Q3`).
- **Diff & Symbol Viewer**: Inspect modified files, line counts, and AST symbols directly from the canvas or timeline.
- **Context Cart**: Multi-select past Q&As and code changes, compiling them into `.memlite_context.md` at your workspace root for direct consumption by any chat model.

---

## Getting Started

### Installation

Install via the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) by searching for **MemLite**, or download directly from [Open VSX](https://open-vsx.org/extension/memlite/memlite-extension).

### Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and execute:
```text
MemLite: Show Visual Map
```
Or select the MemLite icon in the Activity Bar.

---

## Commands

| Command | Description |
| :--- | :--- |
| `MemLite: Show Visual Map` | Opens the interactive visual map and recovery dashboard |
| `MemLite: Export Memory` | Exports the local workspace memory database to JSON |
| `MemLite: Import Memory` | Imports external records into local storage |
| `MemLite: Clear All Memory` | Clears stored session data for the current workspace |

---

## Privacy & Architecture

- **100% Offline**: All indexing, hashing, and symbol extraction runs locally.
- **Zero Telemetry**: No network requests, external databases, or third-party analytics.
- **Isolated Storage**: Transcripts and vector indexes remain strictly within your IDE's local storage directory.

---

## License

MIT © [Ritik Yadav](https://github.com/Ritiky23)
