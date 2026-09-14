import os
import tempfile
import pytest
from memlite.invariants import InvariantsLedger, InvariantRule


def test_invariants_lifecycle():
    with tempfile.TemporaryDirectory() as tmpdir:
        ledger_path = os.path.join(tmpdir, "invariants.json")
        ledger = InvariantsLedger(ledger_path)

        # 1. Add rule
        rule1 = ledger.add_rule("Never use PyTorch", rule_type="NEGATIVE_CONSTRAINT")
        assert rule1.status == "ACTIVE"
        assert rule1.content == "Never use PyTorch"
        assert len(ledger.get_active_rules()) == 1

        # 2. Supersede rule
        rule2 = ledger.supersede_rule(
            rule1.id,
            "Use FastEmbed ONNX only; do not import torch",
            rule_type="NEGATIVE_CONSTRAINT"
        )
        assert rule2.status == "ACTIVE"
        assert ledger.rules[rule1.id].status == "SUPERSEDED"
        assert ledger.rules[rule1.id].superseded_by == rule2.id

        # Only active rule returned
        active = ledger.get_active_rules()
        assert len(active) == 1
        assert active[0].id == rule2.id

        # 3. Revoke rule
        revoked = ledger.revoke_rule(rule2.id, reason="User decided to benchmark PyTorch")
        assert revoked.status == "REVOKED"
        assert revoked.revoked_reason == "User decided to benchmark PyTorch"
        assert len(ledger.get_active_rules()) == 0


def test_tier0_capsule_formatting():
    ledger = InvariantsLedger()
    ledger.add_rule("Do not edit setup.py directly", rule_type="NEGATIVE_CONSTRAINT", scope="file:setup.py")
    ledger.add_rule("Keep visual styling strictly monochrome dark", rule_type="PREFERENCE")

    capsule = ledger.format_tier0_capsule()
    assert "## 🔒 Tier 0: Invariants & Constraints" in capsule
    assert "Do not edit setup.py directly" in capsule
    assert "Keep visual styling strictly monochrome dark" in capsule
    assert "(file:setup.py)" in capsule
