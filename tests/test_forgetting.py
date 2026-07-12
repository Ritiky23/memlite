import pytest
from datetime import datetime, timedelta
from memlite import Memory
from memlite.config import MemLiteConfig
from memlite.models import MemoryItem

class MockEmbedder:
    def embed_text(self, text: str) -> list:
        return [0.1, 0.2]
    def embed_batch(self, texts: list) -> list:
        return [[0.1, 0.2]]

@pytest.fixture
def temp_db(tmp_path):
    return str(tmp_path / "test_forgetting.db")

def test_forgetting_system_cleanup(temp_db):
    # Set up config with rapid decay and specific archive threshold
    config = MemLiteConfig(
        db_path=temp_db,
        decay_rate=0.2,            # fast decay rate (20% per day)
        archive_threshold=0.3,     # items with score < 0.3 get archived
        embedding_provider="local"
    )
    
    # Initialize Memory
    memory = Memory(user_id="user_forget", config=config)
    # Inject Mock Embedder to avoid downloading model
    memory.embedder = MockEmbedder()
    memory.retriever.embedder = MockEmbedder()
    
    now = datetime.utcnow()
    
    # 1. Important recent memory: should not decay below threshold
    item_important = MemoryItem(
        id="item_imp",
        user_id="user_forget",
        content="I am allergic to penicillin",
        embedding=[0.1, 0.2],
        importance=1.0,
        created_at=now,
        last_accessed=now
    )
    
    # 2. Unimportant old memory: should decay below threshold
    # 5 days old, decay_rate = 0.2 -> e^(-0.2*5) = e^(-1.0) = 0.3678
    # importance = 0.5 -> decayed_score = 0.5 * 0.3678 = 0.1839 < 0.3 (threshold)
    item_unimportant = MemoryItem(
        id="item_unimp",
        user_id="user_forget",
        content="I had cheese for lunch yesterday",
        embedding=[0.1, 0.2],
        importance=0.5,
        created_at=now - timedelta(days=5),
        last_accessed=now - timedelta(days=5)
    )
    
    # Add directly to database
    memory.storage.add_memory(item_important)
    memory.storage.add_memory(item_unimportant)
    
    # Run forgetting cleanup
    archived_count = memory.cleanup()
    
    # Assertions
    assert archived_count == 1
    
    # Verify DB state
    retrieved_imp = memory.storage.get_memory("item_imp")
    retrieved_unimp = memory.storage.get_memory("item_unimp")
    
    assert retrieved_imp.is_archived is False
    assert retrieved_unimp.is_archived is True
    
    # Check that search only retrieves the active memory
    search_res = memory.search("penicillin", k=5)
    assert len(search_res["memories"]) == 1
    assert search_res["memories"][0] == "I am allergic to penicillin"
