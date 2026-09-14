import uuid
from typing import List, Dict, Tuple, Optional, Any, Set
from datetime import datetime
from memlite.models import (
    MemoryItem,
    MemoryRelation,
    RelationType,
    UniversalAnchors,
    utc_now
)

try:
    import networkx as nx
except ImportError:
    nx = None

class CognitiveGraphEngine:
    """
    Cognitive Associative Knowledge Graph Engine.
    Handles semantic k-NN auto-linking, universal anchor linking,
    and in-memory spreading activation for multi-hop associative retrieval.
    """

    def __init__(self, storage):
        self.storage = storage

    def auto_link_new_memory(
        self,
        new_item: MemoryItem,
        existing_memories: List[MemoryItem],
        sim_calc_fn=None,
        similarity_threshold: float = 0.78
    ) -> List[MemoryRelation]:
        """
        Automatically forge cognitive edges between a new memory and existing memories:
        1. SIMILAR: High cosine similarity (k-NN).
        2. ENTITY: Shared universal anchors (Who, Where, When, What).
        3. TEMPORAL / PRECEDES: Same session or chronological flow.
        4. SUPERSEDES: Contradiction / update resolution.
        """
        new_relations: List[MemoryRelation] = []
        if not existing_memories:
            return new_relations

        now = utc_now()
        existing_active = [m for m in existing_memories if m.id != new_item.id and not m.is_archived]

        # 1. Semantic Proximity Linking (SIMILAR)
        if new_item.embedding is not None and sim_calc_fn is not None:
            similar_candidates = []
            for target in existing_active:
                if target.embedding is not None:
                    sim = sim_calc_fn(new_item.embedding, target.embedding)
                    if sim >= similarity_threshold:
                        similar_candidates.append((target, sim))
            
            # Sort by similarity and link top matches (up to 3)
            similar_candidates.sort(key=lambda x: x[1], reverse=True)
            for target, sim in similar_candidates[:3]:
                rel = MemoryRelation(
                    id=str(uuid.uuid4()),
                    user_id=new_item.user_id,
                    source_id=new_item.id,
                    target_id=target.id,
                    relation_type=RelationType.SIMILAR,
                    weight=float(round(sim, 3)),
                    confidence=float(round(sim, 3)),
                    created_at=now,
                    last_activated_at=now,
                    activation_count=1,
                    metadata={"cosine_similarity": float(round(sim, 3))}
                )
                new_relations.append(rel)

        # 2. Universal Anchor Linking (ENTITY)
        if new_item.anchors:
            new_who = set(w.lower() for w in new_item.anchors.who)
            new_where = set(w.lower() for w in new_item.anchors.where)
            new_when = set(w.lower() for w in new_item.anchors.when)
            new_what = set(w.lower() for w in new_item.anchors.what)

            for target in existing_active:
                if not target.anchors:
                    continue
                
                shared_who = new_who.intersection(set(w.lower() for w in target.anchors.who))
                shared_where = new_where.intersection(set(w.lower() for w in target.anchors.where))
                shared_when = new_when.intersection(set(w.lower() for w in target.anchors.when))
                shared_what = new_what.intersection(set(w.lower() for w in target.anchors.what))

                total_shared = len(shared_who) + len(shared_where) + len(shared_when) + len(shared_what)
                if total_shared > 0:
                    shared_details = {
                        "shared_who": list(shared_who),
                        "shared_where": list(shared_where),
                        "shared_when": list(shared_when),
                        "shared_what": list(shared_what),
                    }
                    confidence = min(1.0, 0.7 + 0.1 * total_shared)
                    rel = MemoryRelation(
                        id=str(uuid.uuid4()),
                        user_id=new_item.user_id,
                        source_id=new_item.id,
                        target_id=target.id,
                        relation_type=RelationType.ENTITY,
                        weight=float(round(confidence, 3)),
                        confidence=float(round(confidence, 3)),
                        created_at=now,
                        last_activated_at=now,
                        activation_count=1,
                        metadata=shared_details
                    )
                    new_relations.append(rel)

        # 3. Session & Chronology Linking (PRECEDES / TEMPORAL)
        if new_item.session_id:
            same_session = [m for m in existing_active if m.session_id == new_item.session_id]
            if same_session:
                # Link to the most recent memory in this session
                same_session.sort(key=lambda m: m.created_at, reverse=True)
                prev_mem = same_session[0]
                rel = MemoryRelation(
                    id=str(uuid.uuid4()),
                    user_id=new_item.user_id,
                    source_id=prev_mem.id,
                    target_id=new_item.id,
                    relation_type=RelationType.PRECEDES,
                    weight=1.0,
                    confidence=0.95,
                    created_at=now,
                    last_activated_at=now,
                    activation_count=1,
                    metadata={"session_id": new_item.session_id}
                )
                new_relations.append(rel)

        # Batch persist the newly created relations
        if new_relations:
            self.storage.add_relations(new_relations)

        return new_relations

    def build_networkx_graph(self, user_id: str):
        """Construct an in-memory NetworkX graph from SQLite storage."""
        if nx is None:
            return None

        G = nx.DiGraph()
        relations = self.storage.get_relations(user_id=user_id)
        for r in relations:
            rel_type_str = r.relation_type.value if hasattr(r.relation_type, "value") else str(r.relation_type)
            G.add_edge(
                r.source_id,
                r.target_id,
                id=r.id,
                relation_type=rel_type_str,
                weight=r.weight,
                confidence=r.confidence,
                activation_count=r.activation_count
            )
            # Add reverse edge for bidirectional associative flow
            G.add_edge(
                r.target_id,
                r.source_id,
                id=r.id,
                relation_type=rel_type_str,
                weight=r.weight * 0.9,  # slight asymmetry for reverse traversal
                confidence=r.confidence,
                activation_count=r.activation_count
            )
        return G

    def spreading_activation(
        self,
        user_id: str,
        seed_scores: Dict[str, float],
        max_hops: int = 2,
        decay: float = 0.75
    ) -> Dict[str, Tuple[float, int, str]]:
        """
        Execute Spreading Activation across the cognitive graph.
        Input: seed_scores: { memory_id: initial_score }
        Output: { memory_id: (activation_score, hop_distance, via_relation) }
        """
        if not seed_scores or max_hops <= 0:
            return {}

        results: Dict[str, Tuple[float, int, str]] = {}
        # Track best energy and shortest hop per node
        activated_energy: Dict[str, float] = dict(seed_scores)
        hop_map: Dict[str, int] = {k: 0 for k in seed_scores}
        via_map: Dict[str, str] = {k: "seed" for k in seed_scores}

        G = self.build_networkx_graph(user_id)

        if G is not None:
            # NetworkX Spreading Activation
            current_frontier = set(seed_scores.keys())
            for hop in range(1, max_hops + 1):
                next_frontier: Set[str] = set()
                for u in current_frontier:
                    if u not in G:
                        continue
                    u_energy = activated_energy.get(u, 0.0)
                    if u_energy <= 0.05:
                        continue

                    for v in G.neighbors(u):
                        edge_data = G.get_edge_data(u, v, default={})
                        w = edge_data.get("weight", 1.0)
                        conf = edge_data.get("confidence", 1.0)
                        rel_type = edge_data.get("relation_type", "SIMILAR")

                        transferred_energy = u_energy * w * conf * decay
                        if transferred_energy > activated_energy.get(v, 0.0):
                            activated_energy[v] = transferred_energy
                            hop_map[v] = hop
                            via_map[v] = rel_type
                            next_frontier.add(v)
                current_frontier = next_frontier
                if not current_frontier:
                    break
        else:
            # Pure Python fallback spreading activation if networkx is missing
            relations = self.storage.get_relations(user_id=user_id)
            adj: Dict[str, List[Tuple[str, float, float, str]]] = {}
            for r in relations:
                rel_str = r.relation_type.value if hasattr(r.relation_type, "value") else str(r.relation_type)
                adj.setdefault(r.source_id, []).append((r.target_id, r.weight, r.confidence, rel_str))
                adj.setdefault(r.target_id, []).append((r.source_id, r.weight * 0.9, r.confidence, rel_str))

            current_frontier = set(seed_scores.keys())
            for hop in range(1, max_hops + 1):
                next_frontier = set()
                for u in current_frontier:
                    u_energy = activated_energy.get(u, 0.0)
                    if u_energy <= 0.05:
                        continue
                    for v, w, conf, rel_type in adj.get(u, []):
                        transferred_energy = u_energy * w * conf * decay
                        if transferred_energy > activated_energy.get(v, 0.0):
                            activated_energy[v] = transferred_energy
                            hop_map[v] = hop
                            via_map[v] = rel_type
                            next_frontier.add(v)
                current_frontier = next_frontier
                if not current_frontier:
                    break

        for mem_id, energy in activated_energy.items():
            results[mem_id] = (round(energy, 4), hop_map.get(mem_id, 0), via_map.get(mem_id, "direct"))

        return results
