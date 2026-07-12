import os
import json
import logging
import urllib.request
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

from memlite.config import MemLiteConfig
from memlite.models import MemoryItem, SearchResponse, MemorySearchResult
from memlite.storage import SQLiteStorage
from memlite.embeddings import get_embedder
from memlite.retriever import MemoryRetriever

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
                # Strip markdown code blocks if the model wrapped it
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
        """Fallback local heuristic scoring and classification."""
        text = content.lower()
        importance = 0.5
        category = "General"
        
        # 1. Importance heuristic
        if any(k in text for k in ["allergic", "allergy", "diabetic", "emergency", "must", "never", "always", "critical"]):
            importance = 0.95
        elif any(k in text for k in ["prefer", "favorite", "love", "hate", "like", "dislike", "want"]):
            importance = 0.8
        elif any(k in text for k in ["today", "yesterday", "now", "just", "random", "brief"]):
            importance = 0.3
            
        # 2. Categorization heuristic
        if any(k in text for k in ["like", "prefer", "love", "dislike", "favorite", "dark mode", "light mode"]):
            category = "Preference"
        elif any(k in text for k in ["name is", "i am", "live in", "born", "allergic", "allergy", "my age", "phone number"]):
            category = "Personal"
        elif any(k in text for k in ["know", "python", "javascript", "rust", "code", "speak", "language", "dev", "developer"]):
            category = "Skill"
        elif any(k in text for k in ["project", "build", "app", "creating", "work on", "develop"]):
            category = "Project"
        elif any(k in text for k in ["today", "debugging", "now", "issue", "fixing", "temp", "temporary"]):
            category = "Temporary"
            
        return importance, category

    def add(
        self,
        content: str,
        user_id: Optional[str] = None,
        importance: Optional[float] = None,
        category: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> MemoryItem:
        """
        Add a new memory.
        
        Args:
            content: The text content of the memory.
            user_id: Optional user ID (overrides default).
            importance: Optional manual override for importance score.
            category: Optional manual override for memory category.
            metadata: Optional additional metadata dictionary.
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
                
        # Create and persist memory item
        item = MemoryItem(
            user_id=resolved_user_id,
            content=content,
            embedding=embedding,
            importance=importance,
            category=category,
            metadata=metadata or {}
        )
        
        self.storage.add_memory(item)
        self.retriever.invalidate_cache(resolved_user_id)
        return item

    def search(
        self,
        query: str,
        user_id: Optional[str] = None,
        k: int = 5
    ) -> Dict[str, Any]:
        """
        Search for relevant memories.
        
        Args:
            query: The search query string.
            user_id: Optional user ID (overrides default).
            k: Maximum number of memories to return.
            
        Returns:
            Dict containing retrieved memories, confidence score, and details.
        """
        resolved_user_id = self._get_user_id(user_id)
        results = self.retriever.retrieve(resolved_user_id, query, k=k)
        
        memories = [res.content for res in results]
        
        # Overall confidence is the score of the top-ranked retrieved memory, or 0.0
        confidence = float(round(results[0].score, 2)) if results else 0.0
        
        # Construct SearchResponse model to serialize properly
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
        k: int = 5
    ) -> Dict[str, Any]:
        """Alias for search() method to support standard retrieve naming conventions."""
        return self.search(query, user_id=user_id, k=k)

    def delete(self, memory_id: str, user_id: Optional[str] = None):
        """Delete a memory by its ID."""
        self.storage.delete_memory(memory_id)
        if user_id:
            self.retriever.invalidate_cache(user_id)
        else:
            # Clear all caches if user_id is unknown
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
        Run forgetting cleanup. Scans memories and archives low-score items.
        
        Returns:
            Number of archived memories.
        """
        resolved_user = user_id or self.default_user_id
        # Wait, we already implemented cleanup inside Memory itself or storage. Let's write the cleanup logic here:
        memories = self.storage.get_all_memories(user_id=resolved_user, include_archived=False)
        now = datetime.utcnow()
        archived_count = 0
        
        for item in memories:
            time_diff = (now - item.last_accessed).total_seconds() / 86400.0
            decayed_score = item.importance * float(np.exp(-self.config.decay_rate * time_diff))
            if decayed_score < self.config.archive_threshold:
                self.storage.archive_memory(item.id)
                archived_count += 1
                
        if archived_count > 0:
            if resolved_user:
                self.retriever.invalidate_cache(resolved_user)
            else:
                self.retriever._index_cache.clear()
                
        return archived_count

    def compress_conversation(
        self,
        messages: List[Dict[str, str]],
        user_id: Optional[str] = None
    ) -> List[str]:
        """
        Compress a multi-turn chat history conversation into a set of concise facts,
        and automatically save them as new memories.
        
        Args:
            messages: List of chat messages, e.g. [{"role": "user", "content": "I like dark mode"}]
            user_id: Optional user ID.
            
        Returns:
            List of summarized facts added to memory.
        """
        resolved_user_id = self._get_user_id(user_id)
        
        # Serialize messages to text block
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
                
        # If no LLM results, or parsing failed, we fall back to a dummy/empty list
        # since heuristic conversation parsing is extremely complex and error-prone.
        if not facts:
            return []
            
        # Add facts to memory
        added_memories = []
        for fact in facts:
            if isinstance(fact, str) and fact.strip():
                self.add(fact.strip(), user_id=resolved_user_id)
                added_memories.append(fact.strip())
                
        return added_memories
import numpy as np # Import numpy at module level for cleanup
