import os
from datetime import datetime, timedelta
import pytest
from memlite.models import MemoryItem
from memlite.storage import SQLiteStorage

@pytest.fixture
def temp_db(tmp_path):
    db_file = tmp_path / "test_memories.db"
    return str(db_file)

def test_sqlite_storage_crud(temp_db):
    # Initialize storage
    storage = SQLiteStorage(temp_db)
    
    # 1. Create a MemoryItem
    item = MemoryItem(
        user_id="test_user",
        content="I love coding in Python",
        embedding=[0.1, 0.2, 0.3],
        importance=0.8,
        category="Skill",
        metadata={"level": "expert"}
    )
    
    # 2. Add memory
    storage.add_memory(item)
    
    # 3. Retrieve and assert details
    retrieved = storage.get_memory(item.id)
    assert retrieved is not None
    assert retrieved.id == item.id
    assert retrieved.user_id == "test_user"
    assert retrieved.content == "I love coding in Python"
    assert retrieved.importance == 0.8
    assert retrieved.category == "Skill"
    assert retrieved.metadata == {"level": "expert"}
    assert retrieved.embedding == pytest.approx([0.1, 0.2, 0.3])
    
    # 4. Get all memories
    all_m = storage.get_all_memories(user_id="test_user")
    assert len(all_m) == 1
    assert all_m[0].id == item.id
    
    # 5. Update last accessed
    now = datetime.utcnow()
    storage.update_memory_access(item.id, now)
    updated = storage.get_memory(item.id)
    # Compare with a tiny delta since timestamps lose precision in conversion
    assert abs((updated.last_accessed - now).total_seconds()) < 1.0
    
    # 6. Update importance
    storage.update_memory_importance(item.id, 0.95)
    updated_imp = storage.get_memory(item.id)
    assert updated_imp.importance == 0.95
    
    # 7. Archive memory
    storage.archive_memory(item.id)
    archived = storage.get_memory(item.id)
    assert archived.is_archived is True
    
    # Default get_all_memories doesn't include archived
    active_m = storage.get_all_memories(user_id="test_user", include_archived=False)
    assert len(active_m) == 0
    
    # Explicit get_all_memories includes archived
    all_with_archived = storage.get_all_memories(user_id="test_user", include_archived=True)
    assert len(all_with_archived) == 1
    
    # 8. Delete memory
    storage.delete_memory(item.id)
    deleted = storage.get_memory(item.id)
    assert deleted is None

def test_sqlite_storage_clear(temp_db):
    storage = SQLiteStorage(temp_db)
    
    item1 = MemoryItem(user_id="u1", content="Fact 1")
    item2 = MemoryItem(user_id="u2", content="Fact 2")
    
    storage.add_memory(item1)
    storage.add_memory(item2)
    
    # Clear only u1
    storage.clear_memories(user_id="u1")
    assert storage.get_memory(item1.id) is None
    assert storage.get_memory(item2.id) is not None
    
    # Clear all
    storage.clear_memories()
    assert storage.get_memory(item2.id) is None
