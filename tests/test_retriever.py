import pytest
import numpy as np
from datetime import datetime, timedelta
from memlite.config import MemLiteConfig
from memlite.models import MemoryItem
from memlite.storage import SQLiteStorage
from memlite.retriever import MemoryRetriever
from memlite.embeddings import BaseEmbedder

class MockEmbedder(BaseEmbedder):
    def embed_text(self, text: str) -> list:
        # Create deterministic embeddings based on contents
        if "python" in text.lower():
            return [1.0, 0.0, 0.0, 0.0]
        elif "javascript" in text.lower():
            return [0.0, 1.0, 0.0, 0.0]
        elif "rust" in text.lower():
            return [0.0, 0.0, 1.0, 0.0]
        return [0.0, 0.0, 0.0, 1.0]

    def embed_batch(self, texts: list) -> list:
        return [self.embed_text(t) for t in texts]

@pytest.fixture
def temp_db(tmp_path):
    return str(tmp_path / "test_retrieval.db")

def test_hybrid_retrieval_and_numpy_fallback(temp_db):
    storage = SQLiteStorage(temp_db)
    embedder = MockEmbedder()
    # Configuration with equal retrieval weights
    config = MemLiteConfig(
        similarity_weight=0.6,
        importance_weight=0.2,
        recency_weight=0.2,
        decay_rate=0.01
    )
    
    retriever = MemoryRetriever(storage, embedder, config)
    user_id = "user_dev"
    
    # 1. Add some records to storage
    now = datetime.utcnow()
    
    # Python record: high similarity to "python coding", high importance (0.9), fresh
    item1 = MemoryItem(
        id="item_py",
        user_id=user_id,
        content="I code in Python everyday",
        embedding=embedder.embed_text("I code in Python everyday"),
        importance=0.9,
        created_at=now,
        last_accessed=now
    )
    
    # JavaScript record: zero similarity to python, medium importance (0.5), stale (10 days old)
    item2 = MemoryItem(
        id="item_js",
        user_id=user_id,
        content="I use JavaScript for frontend",
        embedding=embedder.embed_text("I use JavaScript for frontend"),
        importance=0.5,
        created_at=now - timedelta(days=10),
        last_accessed=now - timedelta(days=10)
    )
    
    storage.add_memory(item1)
    storage.add_memory(item2)
    
    # 2. Retrieve memories using a Python query
    results = retriever.retrieve(user_id=user_id, query="Show me python coding", k=2)
    
    # Assert Python record is ranked first
    assert len(results) == 2
    assert results[0].content == "I code in Python everyday"
    assert results[1].content == "I use JavaScript for frontend"
    
    # Assert score calculation component ranges
    assert results[0].similarity > 0.9  # high cosine similarity
    assert results[0].importance == 0.9
    assert results[0].recency == pytest.approx(1.0) # fresh
    
    # Assert JS record decayed recency
    assert results[1].recency < 0.95 # decayed
    assert results[1].similarity < 0.1 # low similarity
    
    # 3. Test caching behavior
    # Index should be cached
    assert user_id in retriever._index_cache
    
    # Invalidate cache
    retriever.invalidate_cache(user_id)
    assert user_id not in retriever._index_cache
