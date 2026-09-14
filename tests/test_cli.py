import sys
import os
import pytest
from unittest.mock import patch
from memlite.cli import main
from memlite.config import MemLiteConfig

@pytest.fixture
def temp_cli_db(tmp_path, monkeypatch):
    db_file = str(tmp_path / "test_cli.db")
    monkeypatch.setenv("MEMLITE_DB_PATH", db_file)
    return db_file

def test_cli_add_and_list_and_search(temp_cli_db, monkeypatch, capsys):
    # Add a memory
    test_args_add = ["memlite", "add", "User likes dark theme", "--user", "test_cli_user", "--category", "Preference", "--tags", "ui,theme"]
    with patch.object(sys, "argv", test_args_add):
        main()
    
    out, _ = capsys.readouterr()
    assert "[OK] Memory added" in out
    assert "Preference" in out

    # List memories
    test_args_list = ["memlite", "list", "--user", "test_cli_user"]
    with patch.object(sys, "argv", test_args_list):
        main()

    out, _ = capsys.readouterr()
    assert "User likes dark theme" in out

    # Stats
    test_args_stats = ["memlite", "stats", "--user", "test_cli_user"]
    with patch.object(sys, "argv", test_args_stats):
        main()

    out, _ = capsys.readouterr()
    assert "active_memories" in out

def test_cli_link_and_graph(temp_cli_db, monkeypatch, capsys):
    from memlite import Memory
    mem = Memory(user_id="graph_cli_user")
    m1 = mem.add("First node content")
    m2 = mem.add("Second node content")

    # Link CLI
    test_link_args = ["memlite", "link", m1.id, m2.id, "--relation", "CAUSAL", "--user", "graph_cli_user"]
    with patch.object(sys, "argv", test_link_args):
        main()
    out, _ = capsys.readouterr()
    assert "[OK] Linked memory" in out
    assert "CAUSAL" in out

    # Graph CLI
    test_graph_args = ["memlite", "graph", "--user", "graph_cli_user", "--format", "json"]
    with patch.object(sys, "argv", test_graph_args):
        main()
    out, _ = capsys.readouterr()
    assert "nodes" in out
    assert "edges" in out

    # Unlink CLI
    test_unlink_args = ["memlite", "unlink", m1.id, m2.id, "--user", "graph_cli_user"]
    with patch.object(sys, "argv", test_unlink_args):
        main()
    out, _ = capsys.readouterr()
    assert "[OK] Removed relations" in out
