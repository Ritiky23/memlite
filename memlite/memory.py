import os
import json
import logging
import urllib.request
import numpy as np
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple, Union

from memlite.config import MemLiteConfig
from memlite.models import (
    MemoryItem,
    SearchResponse,
    MemorySearchResult,
    MemoryRelation,
    RelationType,
    UniversalAnchors,
    MemoryGraphData,
    utc_now
)
from memlite.storage import SQLiteStorage
from memlite.embeddings import get_embedder
from memlite.retriever import MemoryRetriever
from memlite.extractor import EntityAnchorExtractor
from memlite.classifier import SemanticPrototypeClassifier

logger = logging.getLogger("memlite")

class Memory:
    def __init__(
        self,
        user_id: Optional[str] = None,
        config: Optional[MemLiteConfig] = None,
        **kwargs
    ):
        """
        Initialize the MemLite engine.
        
        Args:
            user_id: Default user ID to associate memories with.
            config: Optional custom MemLiteConfig configuration object.
            **kwargs: Inline overrides for MemLiteConfig attributes.
        """
        # Load or create configuration
        if config is None:
            self.config = MemLiteConfig(**kwargs)
        else:
            self.config = config
            
        self.default_user_id = user_id
        
        # Initialize storage, embedding engine, and retriever
        self.storage = SQLiteStorage(self.config.db_path)
        self.embedder = get_embedder(
            provider=self.config.embedding_provider,
            model=self.config.embedding_model,
            openai_api_key=self.config.openai_api_key,
            ollama_base_url=self.config.ollama_base_url
        )
        self.retriever = MemoryRetriever(self.storage, self.embedder, self.config)
        self.classifier = SemanticPrototypeClassifier(self.embedder)

    def _get_user_id(self, user_id: Optional[str]) -> str:
        """Resolve the user ID, defaulting to the instance-level user ID."""
        resolved = user_id or self.default_user_id
        if not resolved:
            raise ValueError("user_id must be provided either in the method call or upon Memory initialization.")
        return resolved

    def _llm_chat(self, prompt: str, system_instruction: str = "") -> Optional[str]:
        """Helper to invoke LLM based on configuration (OpenAI or Ollama)."""
        provider = self.config.embedding_provider.lower()
        
        if provider == "openai":
            try:
                import openai
                if not self.config.openai_api_key:
                    return None
                client = openai.OpenAI(api_key=self.config.openai_api_key)
                messages = []
                if system_instruction:
                    messages.append({"role": "system", "content": system_instruction})
                messages.append({"role": "user", "content": prompt})
                
                model_name = self.config.llm_model or "gpt-4o-mini"
                res = client.chat.completions.create(model=model_name, messages=messages)
                return res.choices[0].message.content
            except Exception as e:
                logger.warning(f"Failed to query OpenAI for intelligence: {e}")
                return None
                
        elif provider == "ollama":
            url = f"{self.config.ollama_base_url.rstrip('/')}/api/chat"
            messages = []
            if system_instruction:
                messages.append({"role": "system", "content": system_instruction})
            messages.append({"role": "user", "content": prompt})
            
            model_name = self.config.llm_model or "llama3"
            payload = json.dumps({
                "model": model_name,
                "messages": messages,
                "stream": False
            }).encode("utf-8")
            
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as res:
                    response = json.loads(res.read().decode("utf-8"))
                    return response["message"]["content"]
            except Exception as e:
                logger.warning(f"Failed to query Ollama for intelligence: {e}")
                return None
                
        return None

    def _evaluate_memory_with_llm(self, content: str) -> Tuple[float, str]:
        """Evaluate memory using LLM to extract importance and category."""
        system_instruction = (
            "You are an assistant that analyzes text to extract user preferences, facts, and memories. "
            "Respond ONLY with a valid JSON object matching this schema: "
            '{"importance": <float between 0.0 and 1.0>, "category": <string>}. '
            "Categories MUST be one of: 'Preference', 'Personal', 'Skill', 'Project', 'Temporary', 'General'."
        )
        
        prompt = (
            f"Analyze this memory content: \"{content}\"\n"
            "Determine:\n"
            "1. Importance score (0.0 to 1.0). e.g., allergies = 1.0, address/job/names = 0.9, tools/preferences = 0.8, temporary debugging/daily notes = 0.3.\n"
            "2. Category (Preference, Personal, Skill, Project, Temporary, General).\n"
            "Respond ONLY with the JSON object. Do not include markdown code block formatting."
        )
        
        llm_response = self._llm_chat(prompt, system_instruction)
        if llm_response:
            try:
                cleaned = llm_response.strip().strip("`").strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
                parsed = json.loads(cleaned)
                importance = float(parsed.get("importance", 0.5))
                category = str(parsed.get("category", "General"))
                return importance, category
            except Exception as e:
                logger.debug(f"Parsing LLM intelligence response failed: {e}")
                
        return self._heuristic_evaluate(content)

    def _heuristic_evaluate(self, content: str) -> Tuple[float, str]:
        """Classify category and importance using semantic prototypes with declarative weighting."""
        # 1. Semantic Prototype Vector Classification
        category, confidence = self.classifier.classify(content, threshold=0.36)

        # 2. Importance scoring based on domain criticality
        text = content.lower()
        if any(k in text for k in ["allergic", "allergy", "diabetic", "emergency", "must", "never", "critical"]):
            importance = 0.95
        elif category == "Personal":
            importance = 0.85
        elif category == "Preference":
            importance = 0.80
        elif category == "Skill":
            importance = 0.75
        elif category == "Project":
            importance = 0.70
        else:
            importance = 0.50

        return importance, category

    def add(
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
        """
        Add a new memory with cognitive auto-linking and universal anchors.
        
        Args:
            content: The text content of the memory.
            user_id: Optional user ID (overrides default).
            importance: Optional manual override for importance score.
            category: Optional manual override for memory category.
            tags: Optional list of tag labels (e.g. ['python', 'theme']).
            anchors: Optional UniversalAnchors (Who, Where, When, What). Auto-extracted if None.
            session_id: Optional session identifier for chronological threading.
            metadata: Optional additional metadata dictionary.
            update_existing: If True, checks for conflicting/duplicate memories and supersedes them.
        """
        resolved_user_id = self._get_user_id(user_id)
        
        # Generate embedding vector
        try:
            embedding = self.embedder.embed_text(content)
        except Exception as e:
            logger.error(f"Failed to generate embedding for memory: {e}")
            embedding = None
            
        # Determine importance and category
        if importance is None or category is None:
            calc_importance, calc_category = self._evaluate_memory_with_llm(content)
            if importance is None:
                importance = calc_importance
            if category is None:
                category = calc_category

        # Extract Universal Anchors (Who, Where, When, What)
        if anchors is None:
            resolved_anchors = EntityAnchorExtractor.extract_anchors(content)
        elif isinstance(anchors, dict):
            resolved_anchors = UniversalAnchors(**anchors)
        else:
            resolved_anchors = anchors
                
        # Create new memory item
        item = MemoryItem(
            user_id=resolved_user_id,
            content=content,
            embedding=embedding,
            importance=importance,
            category=category,
            tags=tags or [],
            anchors=resolved_anchors,
            session_id=session_id,
            metadata=metadata or {}
        )

        existing_candidates = self.storage.get_all_memories(user_id=resolved_user_id, include_archived=False)

        # Contradiction / Supersede detection if enabled
        if update_existing and embedding is not None:
            for existing in existing_candidates:
                if existing.embedding is not None and existing.id != item.id:
                    sim = self.retriever._cosine_similarity(embedding, existing.embedding)
                    if sim >= 0.85:
                        self.storage.supersede_memory(existing.id, item.id)
                        # Create explicit SUPERSEDES relation in knowledge graph
                        self.storage.add_relation(MemoryRelation(
                            user_id=resolved_user_id,
                            source_id=item.id,
                            target_id=existing.id,
                            relation_type=RelationType.SUPERSEDES,
                            weight=1.0,
                            confidence=1.0,
                            metadata={"similarity": float(round(sim, 3))}
                        ))
                        logger.info(f"Superseded memory '{existing.content}' with '{item.content}' (sim={sim:.2f})")
        
        self.storage.add_memory(item)

        # Forge cognitive edges (SIMILAR, ENTITY, PRECEDES)
        try:
            self.retriever.graph_engine.auto_link_new_memory(
                new_item=item,
                existing_memories=existing_candidates,
                sim_calc_fn=self.retriever._cosine_similarity
            )
        except Exception as e:
            logger.debug(f"Auto-linking memory failed: {e}")

        self.retriever.invalidate_cache(resolved_user_id)
        return item

    def add_batch(
        self,
        items: List[Union[str, Dict[str, Any]]],
        user_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> List[MemoryItem]:
        """
        Add multiple memories in batch for fast ingestion with cognitive anchor extraction.
        """
        resolved_user_id = self._get_user_id(user_id)
        if not items:
            return []

        # Parse contents
        texts: List[str] = []
        parsed_entries: List[Dict[str, Any]] = []

        for item in items:
            if isinstance(item, str):
                texts.append(item)
                parsed_entries.append({"content": item})
            elif isinstance(item, dict):
                content = item.get("content", "")
                texts.append(content)
                parsed_entries.append(item)

        # Batch embed
        try:
            embeddings = self.embedder.embed_batch(texts)
        except Exception as e:
            logger.error(f"Batch embedding failed: {e}")
            embeddings = [None] * len(texts)

        memory_items: List[MemoryItem] = []
        for i, entry in enumerate(parsed_entries):
            content = entry["content"]
            imp = entry.get("importance")
            cat = entry.get("category")
            if imp is None or cat is None:
                calc_imp, calc_cat = self._heuristic_evaluate(content)
                imp = imp or calc_imp
                cat = cat or calc_cat

            anchors_val = entry.get("anchors")
            if anchors_val is None:
                resolved_anchors = EntityAnchorExtractor.extract_anchors(content)
            elif isinstance(anchors_val, dict):
                resolved_anchors = UniversalAnchors(**anchors_val)
            else:
                resolved_anchors = anchors_val

            m_item = MemoryItem(
                user_id=resolved_user_id,
                content=content,
                embedding=embeddings[i] if i < len(embeddings) else None,
                importance=imp,
                category=cat,
                tags=entry.get("tags", []),
                anchors=resolved_anchors,
                session_id=entry.get("session_id", session_id),
                metadata=entry.get("metadata", {})
            )
            memory_items.append(m_item)

        self.storage.add_memories_batch(memory_items)

        # Auto-link batch memories against each other and existing memories
        existing = self.storage.get_all_memories(user_id=resolved_user_id, include_archived=False)
        for m_item in memory_items:
            try:
                self.retriever.graph_engine.auto_link_new_memory(
                    new_item=m_item,
                    existing_memories=existing,
                    sim_calc_fn=self.retriever._cosine_similarity
                )
            except Exception:
                pass

        self.retriever.invalidate_cache(resolved_user_id)
        return memory_items

    def search(
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
        """
        Search for relevant memories with hybrid keyword + vector retrieval + cognitive spreading activation.
        """
        resolved_user_id = self._get_user_id(user_id)
        results = self.retriever.retrieve(
            user_id=resolved_user_id,
            query=query,
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
        
        memories = [res.content for res in results]
        confidence = float(round(results[0].score, 2)) if results else 0.0
        
        response = SearchResponse(
            memories=memories,
            confidence=confidence,
            details=results
        )
        return response.model_dump()

    def retrieve(
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
        """Alias for search() method with cognitive graph options."""
        return self.search(
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

    def get_all(
        self,
        user_id: Optional[str] = None,
        include_archived: bool = False,
        category: Optional[Union[str, List[str]]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None
    ) -> List[MemoryItem]:
        """Fetch all stored memories matching filters."""
        resolved_user_id = user_id or self.default_user_id
        return self.storage.get_all_memories(
            user_id=resolved_user_id,
            include_archived=include_archived,
            category=category,
            tags=tags,
            metadata_filters=metadata_filters
        )

    def delete(self, memory_id: str, user_id: Optional[str] = None):
        """Delete a memory by its ID."""
        self.storage.delete_memory(memory_id)
        if user_id:
            self.retriever.invalidate_cache(user_id)
        else:
            self.retriever._index_cache.clear()

    def clear(self, user_id: Optional[str] = None):
        """Clear all memories, optionally filtered by user_id."""
        resolved_user_id = user_id or self.default_user_id
        self.storage.clear_memories(resolved_user_id)
        if resolved_user_id:
            self.retriever.invalidate_cache(resolved_user_id)
        else:
            self.retriever._index_cache.clear()

    def cleanup(self, user_id: Optional[str] = None) -> int:
        """
        Run category-aware forgetting cleanup. Scans memories and archives decayed items.
        
        Returns:
            Number of archived memories.
        """
        resolved_user = user_id or self.default_user_id
        memories = self.storage.get_all_memories(user_id=resolved_user, include_archived=False)
        now = utc_now()
        archived_count = 0
        
        for item in memories:
            decay_rate = self.config.get_decay_rate(item.category)
            time_diff = (now - item.last_accessed).total_seconds() / 86400.0
            decayed_score = item.importance * float(np.exp(-decay_rate * time_diff))

            if decayed_score < self.config.archive_threshold:
                self.storage.archive_memory(item.id)
                archived_count += 1
                
        if archived_count > 0:
            if resolved_user:
                self.retriever.invalidate_cache(resolved_user)
            else:
                self.retriever._index_cache.clear()
                
        return archived_count

    def consolidate(self, user_id: Optional[str] = None) -> List[str]:
        """
        Consolidate and summarize active micro-memories into coherent profile summaries.
        
        Returns:
            List of new consolidated memory strings.
        """
        resolved_user = self._get_user_id(user_id)
        active_memories = self.storage.get_all_memories(user_id=resolved_user, include_archived=False)
        if len(active_memories) < 2:
            return []

        # Group contents by category
        by_category: Dict[str, List[MemoryItem]] = {}
        for m in active_memories:
            by_category.setdefault(m.category, []).append(m)

        consolidated_facts: List[str] = []
        for cat, items in by_category.items():
            if len(items) < 2:
                continue

            joined_text = "\n".join(f"- {item.content}" for item in items)
            system_instruction = (
                f"You are an expert memory synthesis agent. Analyze these user facts in category '{cat}'. "
                "Synthesize them into concise, non-redundant core knowledge statements. "
                "Respond ONLY as a JSON list of strings, for example: [\"User uses Python with FastAPI\", \"User works on MemLite\"]."
            )
            prompt = f"Consolidate these {cat} memories:\n{joined_text}\nReturn ONLY the JSON list."

            llm_response = self._llm_chat(prompt, system_instruction)
            if llm_response:
                try:
                    cleaned = llm_response.strip().strip("`").strip()
                    if cleaned.startswith("json"):
                        cleaned = cleaned[4:].strip()
                    facts = json.loads(cleaned)
                    if isinstance(facts, list) and facts:
                        # Archive older micro-items
                        for it in items:
                            self.storage.archive_memory(it.id)
                        # Add new consolidated facts
                        for fact in facts:
                            if isinstance(fact, str) and fact.strip():
                                self.add(
                                    content=fact.strip(),
                                    user_id=resolved_user,
                                    category=cat,
                                    importance=0.9,
                                    tags=["consolidated"]
                                )
                                consolidated_facts.append(fact.strip())
                except Exception as e:
                    logger.warning(f"Failed to parse consolidation JSON for category {cat}: {e}")

        if consolidated_facts:
            self.retriever.invalidate_cache(resolved_user)
        return consolidated_facts

    def stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get summary statistics for stored memories and cognitive relations."""
        resolved_user = user_id or self.default_user_id
        active = self.storage.get_all_memories(user_id=resolved_user, include_archived=False)
        archived = self.storage.get_all_memories(user_id=resolved_user, include_archived=True)
        relations = self.storage.get_relations(user_id=resolved_user)
        
        categories: Dict[str, int] = {}
        tags: Dict[str, int] = {}
        for m in active:
            categories[m.category] = categories.get(m.category, 0) + 1
            for t in m.tags:
                tags[t] = tags.get(t, 0) + 1

        relation_types: Dict[str, int] = {}
        for r in relations:
            r_type = r.relation_type.value if hasattr(r.relation_type, "value") else str(r.relation_type)
            relation_types[r_type] = relation_types.get(r_type, 0) + 1

        return {
            "user_id": resolved_user,
            "active_memories": len(active),
            "total_memories": len(archived),
            "archived_memories": len(archived) - len(active),
            "total_relations": len(relations),
            "relation_types": relation_types,
            "categories": categories,
            "tags": tags,
            "embedding_provider": self.config.embedding_provider,
            "hybrid_search": self.config.hybrid_search,
            "cognitive_graph": True
        }

    def link(
        self,
        source_id: str,
        target_id: str,
        relation_type: Union[RelationType, str] = RelationType.SIMILAR,
        weight: float = 1.0,
        confidence: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> MemoryRelation:
        """
        Manually link two memory nodes with an explicit cognitive relation.
        """
        resolved_user = self._get_user_id(user_id)
        if isinstance(relation_type, str):
            try:
                rel_enum = RelationType(relation_type.upper())
            except ValueError:
                rel_enum = RelationType.SIMILAR
        else:
            rel_enum = relation_type

        relation = MemoryRelation(
            user_id=resolved_user,
            source_id=source_id,
            target_id=target_id,
            relation_type=rel_enum,
            weight=weight,
            confidence=confidence,
            metadata=metadata or {}
        )
        return self.storage.add_relation(relation)

    def unlink(
        self,
        source_id: str,
        target_id: str,
        user_id: Optional[str] = None
    ) -> bool:
        """Remove relations between two memory nodes."""
        resolved_user = self._get_user_id(user_id)
        return self.storage.delete_relations_between(source_id=source_id, target_id=target_id, user_id=resolved_user)

    def get_relations(
        self,
        user_id: Optional[str] = None,
        memory_id: Optional[str] = None,
        relation_type: Optional[str] = None
    ) -> List[MemoryRelation]:
        """Get cognitive relations, optionally filtered by memory ID or relation type."""
        resolved_user = self._get_user_id(user_id)
        return self.storage.get_relations(user_id=resolved_user, memory_id=memory_id, relation_type=relation_type)

    def get_graph(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get full graph data (nodes and edges) for visualizer or graph analysis."""
        resolved_user = self._get_user_id(user_id)
        graph_data = self.storage.get_graph(user_id=resolved_user)
        return graph_data.model_dump()

    def compress_conversation(
        self,
        messages: List[Dict[str, str]],
        user_id: Optional[str] = None
    ) -> List[str]:
        """
        Compress a multi-turn chat history conversation into a set of concise facts,
        and automatically save them as new memories.
        """
        resolved_user_id = self._get_user_id(user_id)
        
        chat_text = ""
        for msg in messages:
            role = msg.get("role", "user").capitalize()
            content = msg.get("content", "")
            chat_text += f"{role}: {content}\n"
            
        system_instruction = (
            "You are an expert profile compressor. Analyze the chat history and extract key facts about the User "
            "(e.g., preferences, technologies they use, facts they mentioned about themselves). "
            "Respond ONLY as a JSON list of short, independent strings, for example: "
            '["User prefers dark mode", "User coding in Python"]. '
            "If no key facts are found, return an empty list: []."
        )
        
        prompt = (
            f"Extract user profile memories from the following conversation:\n\n{chat_text}\n"
            "Return ONLY the valid JSON list of text strings."
        )
        
        llm_response = self._llm_chat(prompt, system_instruction)
        facts = []
        if llm_response:
            try:
                cleaned = llm_response.strip().strip("`").strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
                facts = json.loads(cleaned)
            except Exception as e:
                logger.warning(f"Failed to parse conversation compression JSON: {e}")
                
        if not facts:
            return []
            
        added_memories = []
        for fact in facts:
            if isinstance(fact, str) and fact.strip():
                self.add(fact.strip(), user_id=resolved_user_id)
                added_memories.append(fact.strip())
                
        return added_memories

