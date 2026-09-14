# 🧠 MemLite: Local AI Memory Hub & Context Recovery Engine

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/Ritiky23/memlite)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-v2.0.0-purple.svg)](https://open-vsx.org/extension/memlite/memlite-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](#-license)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-100%25%20Local-green.svg)](#-privacy-first)

**Give your AI agents and IDE chat assistants persistent long-term memory and bulletproof context recovery.**

MemLite is a lightweight, local-first memory engine and visual dashboard. It combines SQLite (FTS5 BM25) and FAISS/FastEmbed for dense vector search, enabling instant retention, hybrid retrieval, contradiction resolution, and intelligent decay. It includes an **MCP Server**, an **Async Engine**, a **Developer CLI**, and a **VS Code / Open VSX Extension** with a visual neural map and **Tiered Agent Recovery Capsules**.

![MemLite Visual Mind Map and Context Cart](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/dashboard.png)

---

## ⚡ What's New in v2.0

* **🛡️ Tiered Agent Recovery Capsules:** Generate structured prompt capsules divided into Tier 0 (Hard Invariants & Constraints), Tier 1 (Causal File Provenance with exact line diffs & symbol modifications), and Tier 2 (Semantic Intent & Goals).
* **🔍 AST Symbol Extraction:** Automatically detects modified classes, functions, and symbols on code diffs and newly created files.
* **⚡ Zero-Lag Architecture:** High-performance `O(1)` indexed step lookup, bounded transcript scanning, and lazy-rendered DOM pagination — zero IDE lag even with thousands of memories.
* **🎯 Workspace Scoping & Isolation:** Multi-project isolation ensures your active project view only displays relevant memories and actions.
* **🧼 One-Click Memory Pruning:** Clean up foreign or orphaned entries with the new Prune button.

---

## 🚀 Core Engine Features

- **Local-first & Private**: Runs 100% locally on your machine using SQLite (with FTS5) and FAISS / FastEmbed. Zero cloud dependencies.
- **True Hybrid Retrieval (BM25 + Dense Vector + RRF)**: Combines exact keyword matching with deep semantic similarity using Reciprocal Rank Fusion (RRF).
- **Contradiction Resolution & Memory Superseding**: Detects conflicting or updated facts (e.g. *"I switched from dark mode to light mode"*) and supersedes older items automatically.
- **Category-Aware Memory Decay**: Simulates human memory dynamics with custom decay rates for temporary notes vs. permanent personal facts and skills.
- **Memory Consolidation & Reflection**: Synthesizes clusters of micro-memories into concise, coherent long-term profile summaries.
- **Asynchronous Engine (`AsyncMemory`)**: Native `async`/`await` support (`aadd`, `asearch`, `aadd_batch`, `astats`) for agent frameworks (LangGraph, CrewAI, AutoGen, FastAPI).
- **Model Context Protocol (MCP) Server**: Connect MemLite directly to Claude Desktop, Cursor, Antigravity, and other MCP clients via `memlite mcp`.
- **FastEmbed ONNX Support**: Ultra-lightweight local embeddings without requiring heavy PyTorch installations.
- **Developer CLI**: Fast terminal commands for managing memories, viewing stats, and inspecting retrieval ranking diagnostics.

---

## 📦 Installation

To install the core engine (SQLite + FTS5, works with API-based embeddings like OpenAI):
```bash
pip install memlite
```

To install with FastEmbed (ultra-fast ONNX runtime, zero PyTorch dependency):
```bash
pip install memlite[fastembed]
```

To install local PyTorch embedding & FAISS vector search capabilities:
```bash
pip install memlite[local]
```

Or install everything:
```bash
pip install memlite[all]
```

---

## 🛠️ Quick Start

### 1. Synchronous Python API

```python
from memlite import Memory

# Initialize memory for a specific user
memory = Memory(user_id="user_123")

# Add memories with optional tags and contradiction detection
memory.add("User prefers dark mode", tags=["ui", "theme"])
memory.add("User is a backend engineer using Python and FastAPI", tags=["tech", "backend"])

# Add multiple memories in a batch
memory.add_batch([
    {"content": "User works on MemLite", "category": "Project", "tags": ["oss"]},
    {"content": "User uses PostgreSQL for storage", "category": "Skill", "tags": ["db"]}
])

# Hybrid Search (BM25 + Semantic Vector)
result = memory.search("What database and tech does the user prefer?", k=3)
print(result)
```

**Output:**
```json
{
  "memories": [
    "User uses PostgreSQL for storage",
    "User is a backend engineer using Python and FastAPI"
  ],
  "confidence": 0.88
}
```

---

### 2. Asynchronous API (`AsyncMemory`)

Ideal for FastAPI, LangGraph, AutoGen, or CrewAI:

```python
import asyncio
from memlite import AsyncMemory

async def main():
    memory = AsyncMemory(user_id="agent_session_1")
    
    await memory.aadd("Completed task: database migration", category="Project")
    results = await memory.asearch("database tasks")
    print(results["memories"])

asyncio.run(main())
```

---

### 3. Model Context Protocol (MCP) Server

MemLite exposes a standard MCP server over stdio for Cursor, Claude Desktop, and Antigravity.

Start the MCP server from the command line:
```bash
memlite mcp --user default_user
```

Or add it to your `claude_desktop_config.json` or MCP settings:
```json
{
  "mcpServers": {
    "memlite": {
      "command": "memlite",
      "args": ["mcp", "--user", "my_user"]
    }
  }
}
```

---

### 4. Developer CLI

```bash
# Add a memory
memlite add "User switched to Python 3.12" --category Skill --tags python,runtime --update-existing

# Hybrid Search
memlite search "Python version"

# List stored memories
memlite list --category Skill

# View statistics
memlite stats

# Run memory forgetting cleanup
memlite cleanup
```

---

## 🖥️ IDE Extension (VS Code & Open VSX)

The **MemLite Extension** provides a rich visual dashboard and agent recovery cockpit directly in your editor:

* **Collapsible Neural Mind Map:** Clusters previous chat sessions visually. Click hubs to expand/collapse chronological Q&As.
* **Tiered Context Recovery Deck:** One-click generation of Tier 0/1/2 prompt recovery capsules.
* **Context Cart:** Multi-select past Q&As and code changes across sessions.
* **Workspace Markdown Sync:** Automatically compiles context into `.memlite_context.md` at your workspace root, ready to be injected into Copilot, Claude, Gemini, or Codex via `#file:.memlite_context.md`.

Install directly from [Open VSX](https://open-vsx.org/extension/memlite/memlite-extension) or the VS Code Marketplace.

---

## 🔒 Privacy First

* Everything runs 100% locally on your machine.
* Your chat transcripts, code diffs, and embedding vectors are kept entirely private inside your local database. Zero telemetry, zero external network calls.

---

## 📄 License

MIT © [Ritik Yadav](https://github.com/Ritiky23)
