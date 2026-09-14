import pytest
from datetime import datetime, timezone, timedelta
from memlite import Memory, MemLiteConfig
from memlite.embeddings import BaseEmbedder

class SimpleMockEmbedder(BaseEmbedder):
    def embed_text(self, text: str) -> list:
        t = text.lower()
        if "dark mode" in t or "light mode" in t or "theme" in t:
            return [0.9, 0.1, 0.0]
        return [0.1, 0.9, 0.0]

    def embed_batch(self, texts: list) -> list:
        return [self.embed_text(t) for t in texts]

@pytest.fixture
def temp_lifecycle_db(tmp_path):
    return str(tmp_path / "test_lifecycle.db")

def test_update_existing_and_supersede(temp_lifecycle_db):
    config = MemLiteConfig(db_path=temp_lifecycle_db)
    mem = Memory(user_id="user_life", config=config)
    mock = SimpleMockEmbedder()
    mem.embedder = mock
    mem.retriever.embedder = mock

    # 1. Add initial memory
    item1 = mem.add("User prefers dark mode theme", update_existing=True)
    assert item1.is_archived is False

    # 2. Add conflicting/updated memory with update_existing=True
    item2 = mem.add("User switched to light mode theme", update_existing=True)
    assert item2.is_archived is False

    # Check that older memory was superseded and archived
    old_item = mem.storage.get_memory(item1.id)
    assert old_item.is_archived is True
    assert old_item.superseded_by == item2.id

    # Active memories should only return item2
    active = mem.get_all()
    assert len(active) == 1
    assert active[0].id == item2.id
    assert active[0].content == "User switched to light mode theme"

def test_category_aware_decay_rates(temp_lifecycle_db):
    config = MemLiteConfig(
        db_path=temp_lifecycle_db,
        decay_rate=0.01,
        archive_threshold=0.3,
        category_decay_rates={
            "Personal": 0.0001,  # near zero decay
            "Temporary": 0.1,    # rapid decay
        }
    )
    mem = Memory(user_id="user_decay", config=config)
    mock = SimpleMockEmbedder()
    mem.embedder = mock
    mem.retriever.embedder = mock

    now = datetime.now(timezone.utc)
    # Personal fact 10 days ago (should stay active)
    item_personal = mem.add("User was born in Canada", category="Personal", importance=0.8)
    mem.storage.update_memory_access(item_personal.id, now - timedelta(days=10))

    # Temporary note 10 days ago (importance 0.5, decay rate 0.1 -> e^(-1.0) * 0.5 = 0.183 < 0.3 -> archived)
    item_temp = mem.add("Debugging temporary port issue", category="Temporary", importance=0.5)
    mem.storage.update_memory_access(item_temp.id, now - timedelta(days=10))

    archived = mem.cleanup()
    assert archived == 1

    check_personal = mem.storage.get_memory(item_personal.id)
    check_temp = mem.storage.get_memory(item_temp.id)
    assert check_personal.is_archived is False
    assert check_temp.is_archived is True
