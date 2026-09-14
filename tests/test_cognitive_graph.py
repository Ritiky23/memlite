import pytest
import os
import shutil
from memlite import Memory
from memlite.config import MemLiteConfig
from memlite.models import RelationType, UniversalAnchors
from memlite.extractor import EntityAnchorExtractor

TEST_DB_DIR = "./test_cognitive_graph_db"
TEST_DB_PATH = os.path.join(TEST_DB_DIR, "test_cognitive.db")

@pytest.fixture(autouse=True)
def cleanup():
    if os.path.exists(TEST_DB_DIR):
        shutil.rmtree(TEST_DB_DIR, ignore_errors=True)
    yield
    if os.path.exists(TEST_DB_DIR):
        shutil.rmtree(TEST_DB_DIR, ignore_errors=True)

def test_entity_anchor_extractor():
    text = "Sarah is visiting Seattle for Thanksgiving with Acme Corp"
    anchors = EntityAnchorExtractor.extract_anchors(text)
    assert isinstance(anchors, UniversalAnchors)
    # Check that it extracted elements across who, where, when, or what
    all_extracted = anchors.who + anchors.where + anchors.when + anchors.what
    assert len(all_extracted) >= 2
    assert any("Sarah" in x or "Seattle" in x or "Thanksgiving" in x for x in all_extracted)

def test_auto_linking_entities_and_similar():
    config = MemLiteConfig(db_path=TEST_DB_PATH, embedding_provider="fastembed")
    mem = Memory(user_id="alice", config=config)

    # Add 2 memories sharing the entity 'Sarah'
    m1 = mem.add("Sarah lives in Seattle and is visiting for Thanksgiving.", category="Personal")
    m2 = mem.add("Sarah loves authentic Thai food and spicy noodles.", category="Preference")

    # Verify that relations were auto-created
    relations = mem.get_relations()
    assert len(relations) >= 1
    rel_types = [r.relation_type for r in relations]
    assert RelationType.ENTITY in rel_types or RelationType.SIMILAR in rel_types

def test_manual_link_and_unlink():
    config = MemLiteConfig(db_path=TEST_DB_PATH, embedding_provider="fastembed")
    mem = Memory(user_id="bob", config=config)

    m1 = mem.add("I have a severe peanut allergy", category="Personal")
    m2 = mem.add("Thai food often uses peanut oil in sauces", category="Preference")

    # Manually link with CAUSAL relation
    rel = mem.link(m1.id, m2.id, relation_type=RelationType.CAUSAL, weight=1.5, confidence=0.95)
    assert rel.source_id == m1.id
    assert rel.target_id == m2.id
    assert rel.relation_type == RelationType.CAUSAL

    # Verify graph includes edge
    graph = mem.get_graph()
    assert len(graph["edges"]) >= 1
    edge = [e for e in graph["edges"] if e["source"] == m1.id and e["target"] == m2.id][0]
    assert edge["relation_type"] == "CAUSAL"
    assert edge["weight"] == 1.5

    # Unlink
    ok = mem.unlink(m1.id, m2.id)
    assert ok is True
    assert len(mem.get_relations(memory_id=m1.id)) == 0

def test_hebbian_co_recall_reinforcement():
    config = MemLiteConfig(db_path=TEST_DB_PATH, embedding_provider="fastembed")
    mem = Memory(user_id="charlie", config=config)

    m1 = mem.add("User works on Payment Gateway Service", category="Project")
    m2 = mem.add("VPN security token refreshes every 8 hours", category="Project")

    # Manually create link with initial activation_count = 1
    mem.link(m1.id, m2.id, relation_type=RelationType.CO_RECALLED, weight=1.0)

    # Perform a search that recalls both
    res = mem.search("Payment Gateway VPN token", k=2, reinforce_hebbian=True)
    assert len(res["details"]) >= 2

    # Check that activation_count increased and weight was boosted
    rels = mem.get_relations()
    co_rel = [r for r in rels if r.relation_type == RelationType.CO_RECALLED][0]
    assert co_rel.activation_count >= 2
    assert co_rel.weight > 1.0

def test_associative_multi_hop_search():
    config = MemLiteConfig(db_path=TEST_DB_PATH, embedding_provider="fastembed")
    mem = Memory(user_id="david", config=config)

    # Memory 1: Talks about Sarah
    m1 = mem.add("Sarah is visiting Seattle this Thanksgiving.", category="Personal")
    # Memory 2: Talks about Sarah's food preference
    m2 = mem.add("Sarah loves eating Thai food at local diners.", category="Preference")
    # Memory 3: Talks about Peanut allergy (never mentions Sarah)
    m3 = mem.add("I have a severe peanut allergy and must avoid peanut oil.", category="Personal")

    # Explicitly link Thai food to peanut allergy caution
    mem.link(m2.id, m3.id, relation_type=RelationType.CAUSAL, weight=1.4)

    # Search with query about Sarah's dinner
    search_res = mem.search("Where can I take Sarah for dinner?", k=3, graph_hops=2)
    recalled_contents = [d["content"] for d in search_res["details"]]

    # Ensure m1 and m2 are found directly, AND m3 (peanut allergy) is pulled in via graph associative traversal!
    assert any("Sarah" in c for c in recalled_contents)
    assert any("peanut allergy" in c for c in recalled_contents)

    # Check hop distance on peanut allergy result
    allergy_detail = [d for d in search_res["details"] if "peanut allergy" in d["content"]][0]
    assert allergy_detail["hop_distance"] >= 1
    assert allergy_detail["via_relation"] is not None
