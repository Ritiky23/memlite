# Change Log

All notable changes to the **MemLite** extension are documented in this file.

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
