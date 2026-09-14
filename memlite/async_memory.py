import asyncio
from typing import List, Dict, Any, Optional, Union
from memlite.config import MemLiteConfig
from memlite.memory import Memory
from memlite.models import MemoryItem, MemoryRelation, RelationType, UniversalAnchors

class AsyncMemory:
    """
    Asynchronous wrapper for MemLite cognitive memory engine.
    Offloads storage, embedding, and graph reasoning tasks to worker threads
    to avoid blocking asyncio event loops.
    """
    def __init__(
        self,
        user_id: Optional[str] = None,
        config: Optional[MemLiteConfig] = None,
        **kwargs
    ):
        self._sync_memory = Memory(user_id=user_id, config=config, **kwargs)

    @property
    def config(self) -> MemLiteConfig:
        return self._sync_memory.config

    @property
    def default_user_id(self) -> Optional[str]:
        return self._sync_memory.default_user_id

    async def aadd(
        self,
        content: str,
        user_id: Optional[str] = None,
        importance: Optional[float] = None,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        anchors: Optional[Union[UniversalAnchors, Dict[str, Any]]] = None,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        update_existing: bool = False
    ) -> MemoryItem:
        """Asynchronously add a new memory item with cognitive auto-linking."""
        return await asyncio.to_thread(
            self._sync_memory.add,
            content=content,
            user_id=user_id,
            importance=importance,
            category=category,
            tags=tags,
            anchors=anchors,
            session_id=session_id,
            metadata=metadata,
            update_existing=update_existing
        )

    async def aadd_batch(
        self,
        items: List[Union[str, Dict[str, Any]]],
        user_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> List[MemoryItem]:
        """Asynchronously add multiple memories in a batch."""
        return await asyncio.to_thread(
            self._sync_memory.add_batch,
            items=items,
            user_id=user_id,
            session_id=session_id
        )

    async def asearch(
        self,
        query: str,
        user_id: Optional[str] = None,
        k: int = 5,
        category: Optional[Union[str, List[str]]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None,
        dedup: bool = False,
        dedup_threshold: float = 0.88,
        graph_hops: int = 1,
        graph_weight: float = 0.35,
        reinforce_hebbian: bool = True
    ) -> Dict[str, Any]:
        """Asynchronously search memories with hybrid retrieval and cognitive spreading activation."""
        return await asyncio.to_thread(
            self._sync_memory.search,
            query=query,
            user_id=user_id,
            k=k,
            category=category,
            tags=tags,
            metadata_filters=metadata_filters,
            dedup=dedup,
            dedup_threshold=dedup_threshold,
            graph_hops=graph_hops,
            graph_weight=graph_weight,
            reinforce_hebbian=reinforce_hebbian
        )

    async def aretrieve(
        self,
        query: str,
        user_id: Optional[str] = None,
        k: int = 5,
        category: Optional[Union[str, List[str]]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None,
        dedup: bool = False,
        graph_hops: int = 1,
        graph_weight: float = 0.35,
        reinforce_hebbian: bool = True
    ) -> Dict[str, Any]:
        """Alias for asearch()."""
        return await self.asearch(
            query=query,
            user_id=user_id,
            k=k,
            category=category,
            tags=tags,
            metadata_filters=metadata_filters,
            dedup=dedup,
            graph_hops=graph_hops,
            graph_weight=graph_weight,
            reinforce_hebbian=reinforce_hebbian
        )

    async def alink(
        self,
        source_id: str,
        target_id: str,
        relation_type: Union[RelationType, str] = RelationType.SIMILAR,
        weight: float = 1.0,
        confidence: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> MemoryRelation:
        """Asynchronously create a cognitive relation link between two memories."""
        return await asyncio.to_thread(
            self._sync_memory.link,
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            weight=weight,
            confidence=confidence,
            metadata=metadata,
            user_id=user_id
        )

    async def aunlink(
        self,
        source_id: str,
        target_id: str,
        user_id: Optional[str] = None
    ) -> bool:
        """Asynchronously remove cognitive relation between two memories."""
        return await asyncio.to_thread(
            self._sync_memory.unlink,
            source_id=source_id,
            target_id=target_id,
            user_id=user_id
        )

    async def aget_relations(
        self,
        user_id: Optional[str] = None,
        memory_id: Optional[str] = None,
        relation_type: Optional[str] = None
    ) -> List[MemoryRelation]:
        """Asynchronously fetch cognitive relations."""
        return await asyncio.to_thread(
            self._sync_memory.get_relations,
            user_id=user_id,
            memory_id=memory_id,
            relation_type=relation_type
        )

    async def aget_graph(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Asynchronously get full graph representation (nodes and edges)."""
        return await asyncio.to_thread(self._sync_memory.get_graph, user_id=user_id)

    async def aget_all(
        self,
        user_id: Optional[str] = None,
        include_archived: bool = False,
        category: Optional[Union[str, List[str]]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None
    ) -> List[MemoryItem]:
        """Asynchronously fetch all stored memories."""
        return await asyncio.to_thread(
            self._sync_memory.get_all,
            user_id=user_id,
            include_archived=include_archived,
            category=category,
            tags=tags,
            metadata_filters=metadata_filters
        )

    async def adelete(self, memory_id: str, user_id: Optional[str] = None):
        """Asynchronously delete a memory."""
        return await asyncio.to_thread(self._sync_memory.delete, memory_id=memory_id, user_id=user_id)

    async def aclear(self, user_id: Optional[str] = None):
        """Asynchronously clear all memories."""
        return await asyncio.to_thread(self._sync_memory.clear, user_id=user_id)

    async def acleanup(self, user_id: Optional[str] = None) -> int:
        """Asynchronously run forgetting cleanup."""
        return await asyncio.to_thread(self._sync_memory.cleanup, user_id=user_id)

    async def aconsolidate(self, user_id: Optional[str] = None) -> List[str]:
        """Asynchronously consolidate memories."""
        return await asyncio.to_thread(self._sync_memory.consolidate, user_id=user_id)

    async def astats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Asynchronously get memory stats."""
        return await asyncio.to_thread(self._sync_memory.stats, user_id=user_id)
