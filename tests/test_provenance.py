import os
import tempfile
import pytest
from memlite.provenance import ProvenanceTracker


def test_diff_breadcrumb_generation():
    # Small diff <= 20 lines
    small_diff = "--- a.py\n+++ a.py\n@@ -1,2 +1,2 @@\n-old_func()\n+new_func()"
    summary, added, removed = ProvenanceTracker.generate_diff_summary(small_diff, max_lines=20)
    assert summary == small_diff
    assert added == 1
    assert removed == 1

    # Large diff > 20 lines
    large_lines = ["--- big.py", "+++ big.py"]
    for i in range(25):
        large_lines.append(f"+def helper_{i}():\n+    return {i}")
    large_diff = "\n".join(large_lines)

    summary_large, added_l, removed_l = ProvenanceTracker.generate_diff_summary(large_diff, max_lines=20)
    assert "[LARGE DIFF:" in summary_large
    assert "Key modified symbols:" in summary_large
    assert "helper_" in summary_large


def test_freshness_reality_check():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "main.py")
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("print('version 1')\n")

        tracker = ProvenanceTracker(os.path.join(tmpdir, "provenance.json"))
        hash_v1 = tracker.compute_file_sha256(test_file)

        # Record action with current hash
        tracker.record_action(
            file_path="main.py",
            action="modified",
            diff_text="+print('version 1')",
            intent="initialize main",
            step_index=1,
            file_hash_after=hash_v1
        )

        # Verification 1: Disk matches recorded hash -> Fresh
        res_fresh = tracker.verify_freshness(tmpdir)
        assert res_fresh["all_fresh"] is True
        assert res_fresh["stale_count"] == 0

        # Simulate user manually editing file on disk outside agent control
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("print('version 2 - manually edited by user')\n")

        # Verification 2: Disk modified -> ⚠️ STALE detected!
        res_stale = tracker.verify_freshness(tmpdir)
        assert res_stale["all_fresh"] is False
        assert res_stale["stale_count"] == 1
        assert "main.py" in res_stale["stale_files"][0]["file"]
        assert "⚠️ STALE" in res_stale["stale_files"][0]["warning"]

        # Check Tier 2 formatting
        freshness_capsule = tracker.format_tier2_freshness(tmpdir)
        assert "⚠️ STALE" in freshness_capsule
