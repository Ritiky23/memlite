import pytest
from memlite import Memory, MemLiteConfig
from memlite.embeddings import BaseEmbedder

class DeterministicMockEmbedder(BaseEmbedder):
    def embed_text(self, text: str) -> list:
        t = text.lower()
        if "frontend" in t:
            return [1.0, 0.0, 0.0]
        elif "backend" in t:
            return [0.0, 1.0, 0.0]
        return [0.0, 0.0, 1.0]

    def embed_batch(self, texts: list) -> list:
        return [self.embed_text(t) for t in texts]

@pytest.fixture
def temp_hybrid_db(tmp_path):
    return str(tmp_path / "test_hybrid.db")

def test_fts5_hybrid_search(temp_hybrid_db):
    config = MemLiteConfig(
        db_path=temp_hybrid_db,
        hybrid_search=True,
        keyword_weight=0.4,
        similarity_weight=0.4,
        importance_weight=0.1,
        recency_weight=0.1
    )
    mem = Memory(user_id="user_hybrid", config=config)
    mock = DeterministicMockEmbedder()
    mem.embedder = mock
    mem.retriever.embedder = mock

    # Add items using batch
    mem.add_batch([
        {"content": "Deploying Kubernetes cluster with Helm charts", "category": "Project", "tags": ["k8s", "devops"]},
        {"content": "Building React frontend with Tailwind CSS", "category": "Skill", "tags": ["react", "ui"]},
        {"content": "Configuring PostgreSQL database connection pooling", "category": "Project", "tags": ["db", "backend"]}
    ])

    # 1. Exact keyword search matching FTS5
    results_kw = mem.search("PostgreSQL", k=3)
    assert len(results_kw["memories"]) >= 1
    assert "PostgreSQL" in results_kw["memories"][0]
    assert results_kw["details"][0]["keyword_score"] > 0

    # 2. Category filtering
    results_cat = mem.search("frontend", category="Skill", k=3)
    assert len(results_cat["memories"]) == 1
    assert "React frontend" in results_cat["memories"][0]

    # 3. Tag filtering
    results_tags = mem.search("cluster", tags=["devops"], k=3)
    assert len(results_tags["memories"]) == 1
    assert "Kubernetes" in results_tags["memories"][0]

    # 4. Search with non-existent tag
    results_empty = mem.search("cluster", tags=["nonexistent"], k=3)
    assert len(results_empty["memories"]) == 0
