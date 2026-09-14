"""
MemLite Causal File Provenance & Reality Check Engine
Tracks file modifications, diffs with semantic breadcrumbs for large changes (>20 lines),
SHA-256 file hashes, and instant disk freshness verification (Anti-Stale).
"""

import os
import hashlib
import json
import re
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any, Tuple


@dataclass
class FileActionRecord:
    """
    A single file modification provenance record.
    """
    id: str
    step_index: int
    file_path: str           # Relative or normalized path
    action: str              # "created" | "modified" | "deleted"
    file_hash_after: str     # SHA-256 hash after modification
    intent: str              # User intent or prompt that caused the change
    diff_summary: str        # Diff hunk if <= 20 lines, or semantic breadcrumb if > 20 lines
    lines_added: int = 0
    lines_removed: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FileActionRecord":
        return cls(**data)


class ProvenanceTracker:
    """
    Tracks causal file provenance and performs disk reality checks.
    """
    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = storage_path
        self.records: List[FileActionRecord] = []
        self.file_latest_hash: Dict[str, str] = {}
        if self.storage_path and os.path.exists(self.storage_path):
            self._load()

    @staticmethod
    def compute_sha256(content: str) -> str:
        """Compute SHA-256 hash of a string, normalizing CRLF line endings to LF."""
        normalized = content.replace("\r\n", "\n").strip()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def compute_file_sha256(abs_path: str) -> Optional[str]:
        """Compute SHA-256 hash of a file on disk, normalizing CRLF line endings to LF."""
        if not os.path.exists(abs_path) or os.path.isdir(abs_path):
            return None
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            normalized = content.replace("\r\n", "\n").strip()
            return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
        except Exception:
            return None

    @classmethod
    def generate_diff_summary(cls, diff_text: str, max_lines: int = 20, is_raw_code: bool = False) -> Tuple[str, int, int]:
        """
        Processes a diff or raw code string.
        If diff is <= max_lines and has diff markers: returns exact unified diff hunk.
        If diff is > max_lines or raw code: extracts modified symbols and returns a high-signal Semantic Breadcrumb.
        Returns: (diff_summary, lines_added, lines_removed)
        """
        lines = diff_text.strip().split("\n")
        has_diff_markers = not is_raw_code and any(
            (l.startswith("+") and not l.startswith("+++")) or (l.startswith("-") and not l.startswith("---"))
            for l in lines
        )

        if has_diff_markers:
            added = sum(1 for l in lines if l.startswith("+") and not l.startswith("+++"))
            removed = sum(1 for l in lines if l.startswith("-") and not l.startswith("---"))
        else:
            added = len(lines)
            removed = 0

        if len(lines) <= max_lines and has_diff_markers:
            return diff_text.strip(), added, removed

        # Extract key symbols (functions, classes, variables, exports)
        symbol_pattern = re.compile(
            r'(?:def\s+|class\s+|function\s+|export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+)([a-zA-Z0-9_]+)'
        )
        symbols = set()
        for line in lines:
            if not has_diff_markers or line.startswith("+") or line.startswith("-"):
                match = symbol_pattern.search(line)
                if match:
                    symbols.add(match.group(1))

        symbols_str = ", ".join(sorted(symbols)[:5]) if symbols else "general logic refactoring"

        if len(lines) <= max_lines and not has_diff_markers:
            return diff_text.strip(), added, removed

        label = "LARGE DIFF" if has_diff_markers else "FILE CONTENT"
        breadcrumb = (
            f"[{label}: +{added} lines, -{removed} lines across {len(lines)} total lines. "
            f"Key modified symbols: {{{symbols_str}}}. "
            f"Action: Read file directly on disk for complete AST & signature details.]"
        )
        return breadcrumb, added, removed

    def record_action(
        self,
        file_path: str,
        action: str,
        diff_text: str,
        intent: str,
        step_index: int,
        file_hash_after: Optional[str] = None
    ) -> FileActionRecord:
        """
        Record a file action with diff summary and SHA-256 hash.
        """
        is_raw = (action == "created")
        summary, added, removed = self.generate_diff_summary(diff_text, is_raw_code=is_raw)
        if not file_hash_after:
            file_hash_after = self.compute_sha256(diff_text)

        norm_path = file_path.replace("\\", "/")
        rec_id = f"{step_index}_{hash(norm_path) & 0xffffffff:x}"
        record = FileActionRecord(
            id=rec_id,
            step_index=step_index,
            file_path=norm_path,
            action=action,
            file_hash_after=file_hash_after,
            intent=intent,
            diff_summary=summary,
            lines_added=added,
            lines_removed=removed
        )
        self.records.append(record)
        self.file_latest_hash[norm_path] = file_hash_after
        self._save()
        return record

    def verify_freshness(self, workspace_root: str) -> Dict[str, Any]:
        """
        Performs an instant Disk Reality Check.
        Compares recorded SHA-256 hash against current disk state for each tracked file.
        Returns fresh vs stale file details.
        """
        stale_files = []
        fresh_files = []
        missing_files = []

        for norm_path, recorded_hash in self.file_latest_hash.items():
            abs_path = os.path.join(workspace_root, norm_path)
            if not os.path.exists(abs_path):
                missing_files.append({"file": norm_path, "recorded_hash": recorded_hash})
                continue

            current_hash = self.compute_file_sha256(abs_path)
            if current_hash != recorded_hash:
                stale_files.append({
                    "file": norm_path,
                    "recorded_hash": recorded_hash,
                    "current_hash": current_hash,
                    "warning": f"⚠️ STALE: '{norm_path}' was modified on disk since last recorded step."
                })
            else:
                fresh_files.append({"file": norm_path, "hash": current_hash})

        return {
            "all_fresh": len(stale_files) == 0 and len(missing_files) == 0,
            "stale_count": len(stale_files),
            "stale_files": stale_files,
            "fresh_count": len(fresh_files),
            "fresh_files": fresh_files,
            "missing_files": missing_files
        }

    def format_tier2_freshness(self, workspace_root: str) -> str:
        """
        Format the Tier 2 Disk Reality Check into a concise markdown section (< 100 tokens).
        """
        res = self.verify_freshness(workspace_root)
        lines = ["## 🛡️ Tier 2: Disk Reality Check (Freshness Verification)"]
        if res["all_fresh"]:
            lines.append(f"✅ All {res['fresh_count']} active workspace files match recorded memory hashes.")
        else:
            if res["stale_files"]:
                for s in res["stale_files"]:
                    lines.append(f"- {s['warning']} Inspect disk before editing.")
            if res["missing_files"]:
                for m in res["missing_files"]:
                    lines.append(f"- ⚠️ MISSING: '{m['file']}' recorded in memory was deleted from disk.")

        return "\n".join(lines) + "\n"

    def format_tier1_provenance(self, last_n_steps: int = 3) -> str:
        """
        Format the Tier 1 Causal File Provenance into a concise chronological ledger (< 250 tokens).
        """
        if not self.records:
            return "## ⚡ Tier 1: Causal File Provenance\nNo recent file modifications recorded.\n"

        recent = sorted(self.records, key=lambda r: r.step_index)[-last_n_steps:]
        lines = ["## ⚡ Tier 1: Causal File Provenance (Recent Action Timeline)"]
        for r in recent:
            lines.append(f"- Step {r.step_index} | `{r.file_path}` [{r.action.upper()}] (SHA: {r.file_hash_after})")
            lines.append(f"  Intent: \"{r.intent}\"")
            if r.diff_summary.startswith("[LARGE DIFF"):
                lines.append(f"  {r.diff_summary}")
            else:
                diff_indent = "\n    ".join(r.diff_summary.split("\n")[:6])
                lines.append(f"  Diff:\n    {diff_indent}")

        return "\n".join(lines) + "\n"

    def _save(self):
        if not self.storage_path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.storage_path)), exist_ok=True)
        data = {
            "records": [r.to_dict() for r in self.records],
            "file_latest_hash": self.file_latest_hash
        }
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _load(self):
        if not self.storage_path or not os.path.exists(self.storage_path):
            return
        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.records = [FileActionRecord.from_dict(r) for r in data.get("records", [])]
            self.file_latest_hash = data.get("file_latest_hash", {})
        except Exception:
            self.records = []
            self.file_latest_hash = {}
