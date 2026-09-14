import pytest
from memlite import AsyncMemory, MemLiteConfig
from memlite.embeddings import BaseEmbedder

class AsyncMockEmbedder(BaseEmbedder):
    def embed_text(self, text: str) -> list:
        return [0.2, 0.4, 0.6]

    def embed_batch(self, texts: list) -> list:
        return [[0.2, 0.4, 0.6] for _ in texts]

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.fixture
def temp_async_db(tmp_path):
    return str(tmp_path / "test_async.db")

@pytest.mark.anyio
async def test_async_memory_flow(temp_async_db):
    config = MemLiteConfig(db_path=temp_async_db)
    async_mem = AsyncMemory(user_id="user_async", config=config)
    mock = AsyncMockEmbedder()
    async_mem._sync_memory.embedder = mock
    async_mem._sync_memory.retriever.embedder = mock

    # 1. Add single memory
    item = await async_mem.aadd("Async agent created task", category="Project", tags=["agent"])
    assert item.content == "Async agent created task"

    # 2. Add batch memories
    batch_items = await async_mem.aadd_batch([
        {"content": "First subtask finished", "category": "Project"},
        {"content": "Second subtask started", "category": "Project"}
    ])
    assert len(batch_items) == 2

    # 3. Search memories
    search_res = await async_mem.asearch("agent task", k=2)
    assert len(search_res["memories"]) >= 1

    # 4. Get all
    all_items = await async_mem.aget_all()
    assert len(all_items) == 3

    # 5. Stats
    st = await async_mem.astats()
    assert st["active_memories"] == 3

    # 6. Delete
    await async_mem.adelete(item.id)
    remaining = await async_mem.aget_all()
    assert len(remaining) == 2

    # 7. Clear
    await async_mem.aclear()
    cleared = await async_mem.aget_all()
    assert len(cleared) == 0
