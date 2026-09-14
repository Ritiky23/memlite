# 🧠 MemLite

Give your AI applications long-term memory in 5 lines. Local-first, private, and developer-friendly.

MemLite is a lightweight, local-first memory engine designed for LLM agents and assistants. It combines SQLite with full-text search (FTS5 BM25) and FAISS/NumPy for dense vector similarity search, enabling instant retention, hybrid retrieval, contradiction resolution, and intelligent decay of user memories.

It now includes an **MCP (Model Context Protocol) Server**, an **Async Engine**, a **Developer CLI**, and a **VS Code Extension** with a visual mind map.

![MemLite Visual Mind Map and Context Cart](https://raw.githubusercontent.com/Ritiky23/memlite/main/memlite-extension/media/dashboard.png)

---

## 🚀 Key Features

- **Local-first & Private**: Runs 100% on your local machine using SQLite (with FTS5) and FAISS / FastEmbed. Zero mandatory cloud database setups.
- **True Hybrid Retrieval (BM25 + Dense Vector + RRF)**: Combines exact keyword matching with deep semantic similarity using Reciprocal Rank Fusion (RRF).
- **Contradiction Resolution & Memory Superseding**: Detects conflicting or updated facts (e.g. *"I switched from dark mode to light mode"*) and supersedes older items automatically.
- **Category-Aware Memory Decay**: Simulates human memory dynamics with custom decay rates for temporary notes vs. permanent personal facts and skills.
- **Memory Consolidation & Reflection**: Synthesizes clusters of micro-memories into concise, coherent long-term profile summaries.
- **Asynchronous Engine (`AsyncMemory`)**: Native `async`/`await` support (`aadd`, `asearch`, `aadd_batch`, `astats`) for high-performance agent frameworks (LangGraph, CrewAI, AutoGen, FastAPI).
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

## 🖥️ VS Code Extension Features

- **Collapsible Mind Map:** Clusters previous chat sessions visually.
- **Interactive Hover Tooltips:** Sweep over nodes to instantly preview questions.
- **Context Cart:** Select and pin multiple memories/code changes across chat threads.
- **Workspace Markdown Sync:** Writes compiled context to `.memlite_context.md` at your workspace root, ready to be referenced in Copilot/Codex/Gemini via `#file:.memlite_context.md`.

---

## 📄 License

MIT License

