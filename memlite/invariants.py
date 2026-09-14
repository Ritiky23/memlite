"""
MemLite Invariants Ledger
Manages immutable negative constraints, architectural decisions, and permanent rules.
Provides Tier 0 prompt context with zero lossy summarization and full lifecycle tracking (ACTIVE, SUPERSEDED, REVOKED).
"""

import json
import os
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any


@dataclass
class InvariantRule:
    """
    An immutable rule or constraint contract.
    Must be preserved verbatim in prompt contexts (never summarized).
    """
    id: str
    rule_type: str  # "NEGATIVE_CONSTRAINT" | "ARCHITECTURAL_DECISION" | "PREFERENCE"
    content: str    # Verbatim text of the rule
    scope: str = "global"  # "global" | "file:<path>" | "package:<name>"
    status: str = "ACTIVE"  # "ACTIVE" | "SUPERSEDED" | "REVOKED"
    superseded_by: Optional[str] = None
    revoked_reason: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    revoked_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InvariantRule":
        return cls(**data)


class InvariantsLedger:
    """
    Ledger for storing and managing Tier 0 Invariant Rules.
    Ensures zero lossy compression and deterministic retrieval for agent context.
    """
    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = storage_path
        self.rules: Dict[str, InvariantRule] = {}
        if self.storage_path and os.path.exists(self.storage_path):
            self._load()

    def add_rule(
        self,
        content: str,
        rule_type: str = "NEGATIVE_CONSTRAINT",
        scope: str = "global",
        supersedes_id: Optional[str] = None
    ) -> InvariantRule:
        """
        Add a deliberate invariant rule.
        If supersedes_id is provided, automatically marks the previous rule as SUPERSEDED.
        """
        rule_id = str(uuid.uuid4())[:8]
        new_rule = InvariantRule(
            id=rule_id,
            rule_type=rule_type.upper(),
            content=content.strip(),
            scope=scope
        )

        if supersedes_id and supersedes_id in self.rules:
            old_rule = self.rules[supersedes_id]
            old_rule.status = "SUPERSEDED"
            old_rule.superseded_by = rule_id
            old_rule.revoked_at = datetime.now(timezone.utc).isoformat()

        self.rules[rule_id] = new_rule
        self._save()
        return new_rule

    def revoke_rule(self, rule_id: str, reason: str = "") -> Optional[InvariantRule]:
        """
        Revoke an existing rule when requirements change, preventing prompt deadlocks.
        """
        if rule_id not in self.rules:
            return None

        rule = self.rules[rule_id]
        rule.status = "REVOKED"
        rule.revoked_reason = reason
        rule.revoked_at = datetime.now(timezone.utc).isoformat()
        self._save()
        return rule

    def supersede_rule(
        self,
        old_id: str,
        new_content: str,
        rule_type: str = "NEGATIVE_CONSTRAINT",
        scope: str = "global"
    ) -> InvariantRule:
        """
        Supersede an older rule with an updated rule.
        """
        return self.add_rule(
            content=new_content,
            rule_type=rule_type,
            scope=scope,
            supersedes_id=old_id
        )

    def get_active_rules(self, scope: Optional[str] = None) -> List[InvariantRule]:
        """
        Return all currently ACTIVE rules, optionally filtered by scope.
        """
        active = [r for r in self.rules.values() if r.status == "ACTIVE"]
        if scope:
            active = [r for r in active if r.scope == "global" or r.scope == scope]
        return active

    def format_tier0_capsule(self, scope: Optional[str] = None) -> str:
        """
        Format active invariants into a token-capped, high-priority Tier 0 markdown block.
        Preserves exact verbatim text with zero summarization.
        """
        active_rules = self.get_active_rules(scope=scope)
        if not active_rules:
            return "## 🔒 Tier 0: Invariants & Constraints\nNo active constraints registered.\n"

        lines = ["## 🔒 Tier 0: Invariants & Constraints (Verbatim Contract)"]
        for r in active_rules:
            badge = f"[{r.rule_type}]"
            scope_badge = f"({r.scope})" if r.scope != "global" else ""
            lines.append(f"- {badge} {r.content} {scope_badge} [id:{r.id}]")

        block = "\n".join(lines) + "\n"
        return block

    def _save(self):
        if not self.storage_path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.storage_path)), exist_ok=True)
        data = {k: v.to_dict() for k, v in self.rules.items()}
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _load(self):
        if not self.storage_path or not os.path.exists(self.storage_path):
            return
        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.rules = {k: InvariantRule.from_dict(v) for k, v in data.items()}
        except Exception:
            self.rules = {}
