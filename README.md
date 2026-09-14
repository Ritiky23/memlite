# MemLite - Local AI Memory & Context Recovery Hub

[![Version](https://img.shields.io/badge/version-2.0.0-18181b.svg?style=flat-square)](https://github.com/Ritiky23/memlite)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-v2.0.0-18181b.svg?style=flat-square)](https://open-vsx.org/extension/memlite/memlite-extension)
[![License: MIT](https://img.shields.io/badge/license-MIT-18181b.svg?style=flat-square)](#license)
[![Storage](https://img.shields.io/badge/storage-local--first-18181b.svg?style=flat-square)](#privacy--architecture)

Local memory engine and context recovery system for AI applications and coding assistants.

MemLite provides long-term memory for LLM agents and assistants using SQLite (FTS5 BM25) and FAISS/FastEmbed for dense vector search. It features an **MCP Server**, an **Async Engine**, a **Developer CLI**, and an **IDE Extension** that compiles deterministic **Tiered Context Recovery Capsules** to prevent agent context rot.

![MemLite Visual Neural Map](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/memlite_ss1.png)

![MemLite Context Recovery Deck](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/memlite_ss2.png)

---

## Highlights in v2.0

- **Tiered Context Recovery**: Structured prompt compilation divided into Invariants (Tier 0), Causal File Provenance (Tier 1), and Semantic Intent (Tier 2).
- **AST Symbol Extraction**: Automatic parsing of modified classes, functions, and symbols on code diffs and newly created files.
- **Sub-Millisecond Retrieval**: `O(1)` indexed step lookups, bounded transcript scanning, and lazy-rendered DOM pagination prevent UI stalls on large databases.
- **Workspace Scoping**: Strict project isolation ensures memories and actions are scoped to the active workspace.
- **Memory Pruning**: One-click cleanup of foreign or orphaned database records.

---

## Core Capabilities

- **Local-First Architecture**: Runs locally on SQLite and FAISS/FastEmbed. Zero mandatory cloud services or API dependencies.
- **Hybrid Retrieval**: Combines exact keyword matching (BM25) with semantic embeddings via Reciprocal Rank Fusion (RRF).
- **Contradiction Resolution**: Detects updated or conflicting facts and marks superseded records automatically.
- **Memory Decay & Consolidation**: Time-decay simulation for ephemeral notes versus permanent knowledge, with periodic cluster consolidation.
- **Asynchronous Engine**: Native `async`/`await` support (`AsyncMemory`) for LangGraph, CrewAI, AutoGen, and FastAPI.
- **Model Context Protocol (MCP)**: Native stdio MCP server for Cursor, Claude Desktop, and Antigravity.
- **FastEmbed ONNX**: Lightweight local embeddings without requiring PyTorch.

---

## Installation

Install the base engine (SQLite + FTS5):
```bash
pip install memlite
```

Install with FastEmbed (ONNX runtime, zero PyTorch dependency):
```bash
pip install memlite[fastembed]
```

Install with local PyTorch embeddings and FAISS:
```bash
pip install memlite[local]
```

Or install all dependencies:
```bash
pip install memlite[all]
```

---

## Quick Start

### 1. Synchronous API

```python
from memlite import Memory

# Initialize memory for a user
memory = Memory(user_id="user_123")

# Add memories with optional categorization
memory.add("User prefers dark mode", tags=["ui", "theme"])
memory.add("User is a backend engineer using Python and FastAPI", tags=["tech", "backend"])

# Hybrid search (BM25 + Semantic Vector)
result = memory.search("What database and tech does the user prefer?", k=3)
print(result)
```

### 2. Asynchronous API

For FastAPI, LangGraph, AutoGen, or CrewAI:

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

### 3. Model Context Protocol (MCP) Server

Start the stdio MCP server:
```bash
memlite mcp --user default_user
```

Add to your `claude_desktop_config.json` or IDE MCP configuration:
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

### 4. Developer CLI

```bash
# Add a memory
memlite add "User switched to Python 3.12" --category Skill --tags python,runtime --update-existing

# Search memories
memlite search "Python version"

# Inspect statistics
memlite stats

# Run decay cleanup
memlite cleanup
```

---

## IDE Extension (VS Code & Open VSX)

The **MemLite Extension** provides a visual cockpit and recovery deck directly in your editor:

- **Neural Mind Map**: Visual chat clusters with expandable chronological Q&A nodes.
- **Recovery Deck**: Generates Tier 0/1/2 prompt capsules to recover crashed or compacted agent sessions.
- **Context Cart**: Multi-select memories and file changes across conversations.
- **Markdown Sync**: Writes compiled context into `.memlite_context.md` at the workspace root, easily referenced in any chat prompt via `#file:.memlite_context.md`.

Available on [Open VSX](https://open-vsx.org/extension/memlite/memlite-extension).

---

## Privacy & Architecture

- All data, embeddings, and transcripts remain on your local filesystem.
- No network requests, telemetry, or external database calls.

---

## License

MIT © [Ritik Yadav](https://github.com/Ritiky23)
