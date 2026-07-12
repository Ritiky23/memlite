import numpy as np
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from memlite.models import MemoryItem, MemorySearchResult
from memlite.config import MemLiteConfig

try:
    import faiss
except ImportError:
    faiss = None

class MemoryRetriever:
    def __init__(self, storage, embedder, config: MemLiteConfig):
        self.storage = storage
        self.embedder = embedder
        self.config = config
        # Cache for FAISS indexes: user_id -> (faiss_index, list_of_memory_items)
        self._index_cache: Dict[str, Tuple[Optional[object], List[MemoryItem]]] = {}

    def invalidate_cache(self, user_id: str):
        """Invalidate the cached FAISS index for a user."""
        if user_id in self._index_cache:
            del self._index_cache[user_id]

    def _get_or_create_index(self, user_id: str) -> Tuple[Optional[object], List[MemoryItem]]:
        """Retrieve the index for a user, or build one from scratch if not cached."""
        if user_id in self._index_cache:
            return self._index_cache[user_id]
            
        memories = self.storage.get_all_memories(user_id=user_id, include_archived=False)
        # Filter memories that have embeddings
        valid_memories = [m for m in memories if m.embedding is not None]
        
        if not valid_memories:
            return None, []
            
        if faiss is None:
            # FAISS not available, cache only memories for Numpy fallback search
            self._index_cache[user_id] = (None, valid_memories)
            return None, valid_memories
            
        # Build FAISS Index
        embeddings_arr = np.array([m.embedding for m in valid_memories], dtype=np.float32)
        d = len(valid_memories[0].embedding)
        
        # Normalize embeddings for Cosine Similarity (using Inner Product)
        norms = np.linalg.norm(embeddings_arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normalized_embeddings = embeddings_arr / norms
        
        index = faiss.IndexFlatIP(d)
        index.add(normalized_embeddings)
        
        self._index_cache[user_id] = (index, valid_memories)
        return index, valid_memories

    def retrieve(self, user_id: str, query: str, k: int = 5) -> List[MemorySearchResult]:
        """Retrieve memories for a user matching a query, ranked by hybrid score."""
        index, memories = self._get_or_create_index(user_id)
        if not memories:
            return []
            
        query_emb = self.embedder.embed_text(query)
        query_vector = np.array(query_emb, dtype=np.float32)
        norm = np.linalg.norm(query_vector)
        if norm > 0:
            query_vector = query_vector / norm
            
        similarities = []
        
        # Vector Similarity Search
        if index is not None and faiss is not None:
            # FAISS search
            # FAISS index expect 2D array
            query_2d = np.expand_dims(query_vector, axis=0)
            distances, indices = index.search(query_2d, len(memories))
            
            # Map search results back to memory items
            # FAISS returns sorted order
            sim_dict = {memories[idx].id: float(dist) for dist, idx in zip(distances[0], indices[0]) if idx != -1}
            for m in memories:
                similarities.append((m, sim_dict.get(m.id, 0.0)))
        else:
            # Fallback NumPy search (Cosine Similarity)
            mem_embeddings = np.array([m.embedding for m in memories], dtype=np.float32)
            mem_norms = np.linalg.norm(mem_embeddings, axis=1, keepdims=True)
            mem_norms[mem_norms == 0] = 1.0
            norm_mem = mem_embeddings / mem_norms
            
            sims = np.dot(norm_mem, query_vector)
            for m, sim in zip(memories, sims):
                similarities.append((m, float(sim)))
                
        # Calculate Hybrid Rankings
        results = []
        now = datetime.utcnow()
        
        for item, similarity in similarities:
            # 1. Recency Decay Score: e^(-decay_rate * time_diff_days)
            time_diff = (now - item.last_accessed).total_seconds() / 86400.0  # in days
            recency = float(np.exp(-self.config.decay_rate * time_diff))
            
            # 2. Importance Score (item.importance, between 0 and 1)
            importance = item.importance
            
            # 3. Combined Weighted Score
            w_sim = self.config.similarity_weight
            w_imp = self.config.importance_weight
            w_rec = self.config.recency_weight
            
            total_weight = w_sim + w_imp + w_rec
            hybrid_score = (w_sim * similarity + w_imp * importance + w_rec * recency) / total_weight
            
            # Normalize hybrid_score to [0.0, 1.0] (cap similarity if it goes beyond 1.0 or -1.0)
            # cosine similarity is in [-1, 1], so normalize to [0, 1] for the hybrid ranking formula
            normalized_sim = (similarity + 1.0) / 2.0
            hybrid_score = (w_sim * normalized_sim + w_imp * importance + w_rec * recency) / total_weight
            
            results.append(MemorySearchResult(
                content=item.content,
                similarity=similarity,
                importance=importance,
                recency=recency,
                score=hybrid_score,
                category=item.category,
                metadata=item.metadata
            ))
            
            # Update last accessed for this item asynchronously or during retrieval to boost its recency?
            # To avoid writing on every retrieve, we can defer last_accessed updates, or do it on-demand.
            # In our MVP, we will update the SQLite DB last_accessed for the top results to simulate usage!
            
        # Sort by hybrid score descending
        results.sort(key=lambda x: x.score, reverse=True)
        top_results = results[:k]
        
        # Update last_accessed in storage for the retrieved top_results to indicate they were read
        for res in top_results:
            # find original item ID to update last accessed
            original_item = next((m for m in memories if m.content == res.content), None)
            if original_item:
                self.storage.update_memory_access(original_item.id, now)
                
        # Invalidate cache to refresh last_accessed timestamps on next retrieve if needed,
        # but since last_accessed only affects ranking and doesn't change vector embeddings,
        # we don't have to rebuild the FAISS index (which is vector-only). We can just update the local items timestamps.
        for res in top_results:
            original_item = next((m for m in memories if m.content == res.content), None)
            if original_item:
                original_item.last_accessed = now

        return top_results
