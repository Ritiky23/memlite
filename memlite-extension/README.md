# 🧠 MemLite: Long-term Memory & Context Tracker for AI Chats

**Give your IDE chat assistant a long-term memory.** 

MemLite is a local-first, private visual dashboard that automatically indexes your conversations and code changes, visually organizes them into a **Collapsible Mind Map**, and lets you compile and inject past context into new conversations natively using a workspace reference file.

![MemLite Visual Mind Map and Context Cart](media/dashboard.png)

---

## 🚀 Key Features

* **🎨 Collapsible Mind Map:** Visually clusters your previous chat sessions. Click on any green chat hub node to expand or collapse its chronological line of questions (`Q1` -> `Q2` -> `Q3`).
* **🔍 Real-time Search Auto-Expansion:** Type queries in the search bar. If a query matches a question inside a collapsed chat thread, that thread automatically expands and glows.
* **🏷️ Interactive Hover Tooltips:** Simple canvas labels keep the screen clean and prevent overlap. Hovering your mouse over any circle instantly displays a floating glassmorphic tooltip with the full question summary.
* **🛒 Context Cart (Multi-Select):** Select past Q&As and code changes from different conversations. Pinned nodes glow with an outer Magenta double ring on the canvas.
* **💾 Workspace Markdown Sync:** Writes your compiled context into `.memlite_context.md` at the root of your workspace, auto-ignores it in `.gitignore`, and opens it in a split editor.
* **💬 Native AI Chat Integration:** Feed your compiled memory to Copilot, Codex, Gemini, or other chat panels by simply referencing `#file:.memlite_context.md` or dragging it into the chat input.

---

## 🛠️ Installation & Setup

1. **Local Watcher Configuration:** MemLite automatically watches chat transcript files and indexes them in a local, lightweight SQLite database file.
2. **Launch the Panel:** Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and select **`MemLite: Show Visual Map`** or click the Brain icon (`🧠`) in the sidebar view container.

---

## ⌨️ Command Registry

* **`MemLite: Show Visual Map`** — Opens the full-editor tab mind map dashboard.
* **`MemLite: Export Memory`** — Save a backup of your local database.
* **`MemLite: Import Memory`** — Import an older project database file.
* **`MemLite: Clear All Memory`** — Safely erases all stored conversation data.

---

## 🔒 Privacy First

* Everything runs locally.
* Your chat transcripts, code diffs, and embedding vectors are kept entirely private on your own hard drive inside your IDE user storage folder. No network calls, no cloud databases.
