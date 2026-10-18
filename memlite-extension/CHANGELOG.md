# Change Log

All notable changes to the **MemLite** extension are documented in this file.

## [2.2.0] - 2026-10-18

### 🚀 Major Release: Multi-IDE Support (Cursor + Antigravity), In-Editor CodeLens, & Guardian Invariants

#### 🌐 Universal Multi-IDE Watcher & Transcript Engine
- **Simultaneous Cross-IDE Ingestion**: Dual-stream background watcher that automatically detects and monitors active transcripts across both **Antigravity IDE** (`~/.gemini/antigravity-ide/brain`) and **Cursor IDE** (`~/.cursor/projects`).
- **Cursor Transcript Normalization**: Seamlessly parses Anthropic/OpenAI function schemas (`role: "user"`, `role: "assistant"`, `type: "tool_use"`) and Cursor prompt wrappers (`<user_query>`, `<timestamp>`).
- **Cursor Tool Ingestion**: Full AST symbol and diff extraction for Cursor-native tool actions:
  - `StrReplace`: Generates unified diff previews and tracks line changes across `old_string` / `new_string`.
  - `Write`: Captures new file creations from `args.contents`.
  - `Shell`: Logs executed terminal commands.
- **Automatic Project Slug Decoding**: Automatically normalizes Cursor folder slugs (`d-CM-backend` ➔ `backend`, `d-Futurebits` ➔ `Futurebits`, `d-CM-optimus` ➔ `optimus`) for unified cross-IDE project scoping.

#### 🧠 In-Editor CodeLens & Symbol Provenance ("Why does this code exist?")
- **Interactive CodeLens Buttons**: Contextual indicators floating directly above functions, classes, and types (`def`, `class`, `function`, `export`) displaying:
  - Total AI sessions & modifications touching this symbol.
  - Active invariant warnings (e.g., `⚠️ 1 Active Invariant`).
- **Symbol Provenance Inspector (`memlite.explainSymbol`)**: Click any CodeLens to open an architectural dossier displaying:
  - Historical reasons, user prompts, and agent decisions that created or altered the symbol.
  - Linked file actions and exact diff summaries.
  - Active project invariants with a 1-click **"Copy Constraint for Agent"** action.
- **Deterministic Action Extractor**: Extracts clean engineering titles (e.g. `Fixed 4-5 Min Shutdown Freeze`) instead of raw prompt clicks (`"ok"`, `"yes"`, `"continue"`).
- **Rich Hover Provider**: Hover over any symbol to inspect active invariants and its institutional memory card directly in your editor.

#### 🛡️ Guardian Active Invariants & Negative Constraints
- **Real-Time Agent Modification Alerting**: Automatically warns developers and agents whenever an AI assistant touches a file or symbol governed by an active negative invariant.
- **One-Click Agent Directives**: Provides instant clipboard copying of exact negative constraints formatted for immediate pasting into agent chat windows.
- **Deduplicated Guard Tracking**: Prevents notification spamming during rapid multi-file agent edits.

#### ⚡ Critical Stability & Storage Fix (4–16 GB Disk Leak Resolved)
- **Windows NTFS Atomic Write Leak Fix**: Replaced randomized PID/timestamp temporary file generation (`memlite_db.json.<PID>.<time>.<rand>.tmp`) with deterministic single-file writes, guaranteed `finally` cleanup, and startup orphan sweeps—eliminating multi-gigabyte disk leaks caused by Windows file-locking race conditions.
- **Watcher Debouncing (1200ms)**: Added intelligent debounce timers to `fs.watch` to prevent event loop flooding and V8 heap exhaustion while AI agents stream tokens.

#### 🔌 Model Context Protocol (MCP) Upgrades
- Added native MCP server tools:
  - `add_invariant`, `revoke_invariant`, `supersede_invariant`: Allows external LLM agents (Gemini, Claude, Cursor) to read and modify project rules deterministically.
  - `check_workspace_freshness`: Verifies whether disk files have diverged from agent memory.
  - `get_rehydrate_capsule`: One-call recovery payload containing active invariants and causal file history.

## [2.0.2] - 2026-09-21

### Multi-Window Project Scoping & Robust Workspace Isolation
- **Multi-Window Anti-Pollution Watcher**: Resolved cross-window session overwriting when multiple Antigravity IDE instances (e.g., `optimus`, `client`, `memlite`) run simultaneously.
- **Deep Metadata Workspace Detection**: Prioritizes file paths from tool actions (`Cwd`, `TargetFile`), active document URIs, and `<user_information>` workspace mappings from transcript lines before falling back to window focus state.
- **Auto-Scoped Timeline Filter**: Each IDE window's Timeline automatically defaults its filter to the active workspace project without hiding the global cross-project view (`All Projects`).
- **Inline Session & Project Renaming**: Double-click or click the edit icon on any session header or project pill in the Timeline to rename sessions and re-tag projects inline with optimistic UI updates.
- **Accurate Historical Session Timestamps**: Restored true relative timestamps (`2h ago`, `1d ago`) by reading original `created_at` records across IDE restarts instead of resetting to `"Just now"`.
- **Causal File Timeline & Deck Fixes**: Fixed rendering glitches in the Context Recovery Deck file actions column and improved diff preview formatting.

## [2.0.1] - 2026-09-14

- **Documentation & Marketplace Sync**: Added comprehensive historical and architectural change logs.
- **Context Cart UI Polish**: Polished bottom dock styling, category chips, and SVG indicators.

## [2.0.0] - 2026-09-14

### Major Release: Tiered Context Recovery & High-Performance Architecture

#### Added
- **Tiered Context Recovery Capsules**: Deterministic prompt recovery partitioned into three distinct tiers:
  - **Tier 0 (Invariants & Hard Constraints)**: Preserves architectural rules, forbidden dependencies, and user instructions with 100% fidelity.
  - **Tier 1 (Causal File Provenance)**: Chronological timeline of file modifications, diffs, and created files with SHA-256 integrity validation.
  - **Tier 2 (Semantic Intent)**: Compact syntheses of user queries and agent goals.
- **AST Symbol Extraction**: Intelligent syntax parsing that automatically extracts modified functions, methods, and classes on code writes (`write_to_file`) and patch edits (`replace_file_content`).
- **Studio Neural Map & Recovery Deck**: A comprehensive 4-column kanban board layout for real-time inspection of active invariants, causal file provenance, chat sessions, and staged working context.
- **Redesigned Context Cart Dock**: Sleek bottom dock with animated SVG chevron, category tags (`QA`), text truncation with full hover tooltips, and a one-click `Clear` action.
- **Workspace Scoping & Isolation**: Strict project isolation ensuring that transcript scanning and memory lookups are scoped solely to the active workspace.
- **One-Click Memory Pruning**: Header action to clean up foreign or orphaned records from other workspaces.

#### Performance & Optimization
- **O(1) Step Indexing**: Sub-millisecond step lookups replacing legacy graph-scanning loops, eliminating lag and CPU spikes on databases with thousands of records.
- **Bounded Transcript Scanning**: Prioritizes recently modified transcripts by file modification time (`mtime`) for instantaneous extension startup.
- **Line Ending Normalization**: Windows CRLF (`\r\n`) and Unix LF (`\n`) hash normalization to eliminate false-positive `⚠️ STALE` file warnings.
- **DOM Lazy-Rendering & Pagination**: Smooth scrolling and deferred loading across the Recovery Deck and Timeline views.

---

## [0.1.3] - 2026-07-12

### Foundational Release: Visual Mind Map & Local AI Chat Indexer

#### Visual Knowledge Graph
- **Collapsible Mind Map**: Visual tree layout clustering historical chat sessions into expandable chronological branches (`Q1` → `Q2` → `Q3`).
- **Real-Time Search & Glow**: Instant query filtering that automatically expands matching conversation threads and highlights matching nodes on the canvas.
- **Interactive Glassmorphic Tooltips**: Hover over any canvas node to inspect full question prompts, answers, and file paths without visual overlap.
- **Zoom, Pan, & Minimap Controls**: Smooth canvas navigation with mouse wheel zoom, click-and-drag panning, and reset controls.

#### Context Compilation & IDE Integration
- **Context Cart (Multi-Select)**: Pin past Q&As and code changes across multiple sessions into an active working set with visual ring indicators.
- **Workspace Markdown Sync**: Automatically writes selected context into `.memlite_context.md` at the workspace root, opens it in a split editor, and auto-adds it to `.gitignore`.
- **Native AI Chat Integration**: Inject compiled context directly into Copilot, Claude, Gemini, or Codex using `#file:.memlite_context.md`.

#### Offline Engine & Command Registry
- **100% Offline SQLite Watcher**: Automatically detects and indexes chat transcripts into a local, private SQLite database without external network calls.
- **Memory Backup & Portability**: Built-in commands for `MemLite: Export Memory`, `MemLite: Import Memory`, and `MemLite: Clear All Memory`.
- **Activity Bar View**: Dedicated brain icon container in the VS Code sidebar for quick one-click dashboard access.
