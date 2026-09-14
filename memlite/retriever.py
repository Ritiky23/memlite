import numpy as np
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Optional, Any
from memlite.models import MemoryItem, MemorySearchResult, utc_now
from memlite.config import MemLiteConfig
from memlite.graph import CognitiveGraphEngine

try:
    import faiss
except ImportError:
    faiss = None

class MemoryRetriever:
    def __init__(self, storage, embedder, config: MemLiteConfig):
        self.storage = storage
        self.embedder = embedder
        self.config = config
        self.graph_engine = CognitiveGraphEngine(storage)
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
        valid_memories = [m for m in memories if m.embedding is not None]
        
        if not valid_memories:
            return None, []
            
        if faiss is None:
            self._index_cache[user_id] = (None, valid_memories)
            return None, valid_memories
            
        embeddings_arr = np.array([m.embedding for m in valid_memories], dtype=np.float32)
        d = len(valid_memories[0].embedding)
        
        norms = np.linalg.norm(embeddings_arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normalized_embeddings = embeddings_arr / norms
        
        index = faiss.IndexFlatIP(d)
        index.add(normalized_embeddings)
        
        self._index_cache[user_id] = (index, valid_memories)
        return index, valid_memories

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        """Compute cosine similarity between two embedding vectors."""
        a = np.array(vec_a, dtype=np.float32)
        b = np.array(vec_b, dtype=np.float32)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))

    def retrieve(
        self,
        user_id: str,
        query: str,
        k: int = 5,
        category: Optional[str | List[str]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None,
        dedup: bool = False,
        dedup_threshold: float = 0.88,
        graph_hops: int = 1,
        graph_weight: float = 0.35,
        reinforce_hebbian: bool = True
    ) -> List[MemorySearchResult]:
        """
        Retrieve memories for a user matching a query, ranked by hybrid score
        plus spreading activation across the cognitive knowledge graph.
        """
        # 1. Fetch memories from vector index and DB
        index, all_memories = self._get_or_create_index(user_id)
        
        candidate_memories = all_memories
        if category is not None:
            cat_list = [category] if isinstance(category, str) else category
            candidate_memories = [m for m in candidate_memories if m.category in cat_list]
        if tags:
            tag_set = set(t.lower() for t in tags)
            candidate_memories = [m for m in candidate_memories if any(t.lower() in tag_set for t in m.tags)]
        if metadata_filters:
            candidate_memories = [
                m for m in candidate_memories
                if all(m.metadata.get(kf) == vf for kf, vf in metadata_filters.items())
            ]

        if not candidate_memories:
            db_mems = self.storage.get_all_memories(
                user_id=user_id,
                include_archived=False,
                category=category,
                tags=tags,
                metadata_filters=metadata_filters
            )
            candidate_memories = db_mems

        if not candidate_memories:
            return []

        # 2. Vector Similarity Search
        vector_sim_map: Dict[str, float] = {}
        try:
            query_emb = self.embedder.embed_text(query)
            query_vector = np.array(query_emb, dtype=np.float32)
            norm = np.linalg.norm(query_vector)
            if norm > 0:
                query_vector = query_vector / norm

            if index is not None and faiss is not None and len(candidate_memories) == len(all_memories):
                query_2d = np.expand_dims(query_vector, axis=0)
                distances, indices = index.search(query_2d, len(all_memories))
                for dist, idx in zip(distances[0], indices[0]):
                    if idx != -1 and idx < len(all_memories):
                        vector_sim_map[all_memories[idx].id] = float(dist)
            else:
                for m in candidate_memories:
                    if m.embedding is not None:
                        sim = self._cosine_similarity(m.embedding, query_emb)
                        vector_sim_map[m.id] = sim
                    else:
                        vector_sim_map[m.id] = 0.0
        except Exception:
            for m in candidate_memories:
                vector_sim_map[m.id] = 0.0

        # 3. FTS5 BM25 Keyword Search
        keyword_score_map: Dict[str, float] = {}
        if self.config.hybrid_search:
            fts_results = self.storage.search_keyword(
                query=query,
                user_id=user_id,
                k=max(k * 4, 30),
                category=category
            )
            for fts_item, kw_score in fts_results:
                keyword_score_map[fts_item.id] = kw_score

        # 4. Direct Hybrid Score Calculation
        now = utc_now()
        mem_dict = {m.id: m for m in candidate_memories}

        w_sim = self.config.similarity_weight
        w_kw = self.config.keyword_weight if self.config.hybrid_search else 0.0
        w_imp = self.config.importance_weight
        w_rec = self.config.recency_weight
        total_weight = w_sim + w_kw + w_imp + w_rec or 1.0

        raw_hybrid_scores: Dict[str, float] = {}
        for item in candidate_memories:
            vec_sim = vector_sim_map.get(item.id, 0.0)
            kw_score = keyword_score_map.get(item.id, 0.0)

            decay_rate = self.config.get_decay_rate(item.category)
            time_diff = (now - item.last_accessed).total_seconds() / 86400.0
            recency = float(np.exp(-decay_rate * max(0.0, time_diff)))
            importance = item.importance
            norm_vec_sim = float(np.clip((vec_sim + 1.0) / 2.0, 0.0, 1.0))

            hybrid_score = (
                w_sim * norm_vec_sim
                + w_kw * kw_score
                + w_imp * importance
                + w_rec * recency
            ) / total_weight
            raw_hybrid_scores[item.id] = hybrid_score

        # 5. Cognitive Spreading Activation (Graph Multi-Hop Reasoning)
        graph_activations: Dict[str, Tuple[float, int, str]] = {}
        if graph_hops > 0:
            # Select top seed memories based on raw hybrid score
            sorted_seeds = sorted(raw_hybrid_scores.items(), key=lambda x: x[1], reverse=True)
            top_seeds = {m_id: score for m_id, score in sorted_seeds[:5] if score > 0.15}
            
            if top_seeds:
                graph_activations = self.graph_engine.spreading_activation(
                    user_id=user_id,
                    seed_scores=top_seeds,
                    max_hops=graph_hops,
                    decay=0.75
                )

        # 6. Fuse Hybrid Scores + Cognitive Graph Activation
        results: List[MemorySearchResult] = []
        all_ids_to_consider = set(candidate_memories_map := {m.id: m for m in candidate_memories})
        # If graph activation found nodes outside current candidate list, load them
        for act_id in graph_activations:
            if act_id not in all_ids_to_consider:
                activated_mem = self.storage.get_memory(act_id)
                if activated_mem and not activated_mem.is_archived:
                    if category is not None:
                        cat_list = [category] if isinstance(category, str) else category
                        if activated_mem.category not in cat_list:
                            continue
                    if tags:
                        tag_set = set(t.lower() for t in tags)
                        if not any(t.lower() in tag_set for t in activated_mem.tags):
                            continue
                    if metadata_filters:
                        if not all(activated_mem.metadata.get(kf) == vf for kf, vf in metadata_filters.items()):
                            continue
                    all_ids_to_consider.add(act_id)
                    mem_dict[act_id] = activated_mem

        for item_id in all_ids_to_consider:
            item = mem_dict.get(item_id)
            if not item:
                continue

            base_score = raw_hybrid_scores.get(item_id, 0.0)
            act_energy, hop_dist, via_rel = graph_activations.get(item_id, (0.0, 0, None))

            # Blend graph energy into final score
            final_score = base_score + (graph_weight * act_energy if hop_dist > 0 else 0.0)
            vec_sim = vector_sim_map.get(item_id, 0.0)
            kw_score = keyword_score_map.get(item_id, 0.0)
            importance = item.importance

            decay_rate = self.config.get_decay_rate(item.category)
            time_diff = (now - item.last_accessed).total_seconds() / 86400.0
            recency = float(np.exp(-decay_rate * max(0.0, time_diff)))

            results.append(MemorySearchResult(
                id=item.id,
                content=item.content,
                similarity=float(round(vec_sim, 4)),
                keyword_score=float(round(kw_score, 4)),
                graph_score=float(round(act_energy, 4)),
                hop_distance=hop_dist,
                via_relation=via_rel if hop_dist > 0 else None,
                importance=float(round(importance, 4)),
                recency=float(round(recency, 4)),
                score=float(round(final_score, 4)),
                category=item.category,
                tags=item.tags,
                anchors=item.anchors,
                metadata=item.metadata
            ))

        results.sort(key=lambda x: x.score, reverse=True)

        # 7. Deduplication (MMR)
        if dedup:
            deduped_results: List[MemorySearchResult] = []
            for candidate in results:
                cand_item = mem_dict.get(candidate.id)
                cand_emb = cand_item.embedding if cand_item else None
                is_duplicate = False
                if cand_emb is not None:
                    for accepted in deduped_results:
                        acc_item = mem_dict.get(accepted.id)
                        if acc_item and acc_item.embedding is not None:
                            sim_between = self._cosine_similarity(cand_emb, acc_item.embedding)
                            if sim_between >= dedup_threshold:
                                is_duplicate = True
                                break
                if not is_duplicate:
                    deduped_results.append(candidate)
            results = deduped_results

        top_results = results[:k]

        # 8. Update access timestamps
        for res in top_results:
            if res.id:
                self.storage.update_last_accessed(res.id)
                orig_item = mem_dict.get(res.id)
                if orig_item:
                    orig_item.last_accessed = now

        # 9. Hebbian Co-Recall Reinforcement
        if reinforce_hebbian and len(top_results) >= 2:
            recalled_ids = [r.id for r in top_results if r.id is not None]
            self.storage.reinforce_co_recall(user_id=user_id, memory_ids=recalled_ids)

        return top_results
