import os
import sqlite3
import json
import re
import uuid
import numpy as np
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Tuple
from contextlib import contextmanager
from memlite.models import (
    MemoryItem,
    MemoryRelation,
    RelationType,
    UniversalAnchors,
    MemoryGraphData,
    utc_now
)

class SQLiteStorage:
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Ensure parent directories exist
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.create_table()

    @contextmanager
    def _conn(self):
        """Thread-safe context manager for SQLite connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_table(self):
        """Create memories table, relations table, and FTS5 search index if they do not exist."""
        with self._conn() as conn:
            # 1. Main memories table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding BLOB,
                    importance REAL NOT NULL,
                    category TEXT NOT NULL,
                    tags TEXT DEFAULT '[]',
                    anchors TEXT DEFAULT '{}',
                    session_id TEXT,
                    created_at TEXT NOT NULL,
                    last_accessed TEXT NOT NULL,
                    is_archived INTEGER DEFAULT 0,
                    superseded_by TEXT,
                    metadata TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_is_archived ON memories(is_archived)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)")

            # Auto-migrations for memories table
            cursor = conn.execute("PRAGMA table_info(memories)")
            columns = [row["name"] for row in cursor.fetchall()]
            if "tags" not in columns:
                conn.execute("ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'")
            if "superseded_by" not in columns:
                conn.execute("ALTER TABLE memories ADD COLUMN superseded_by TEXT")
            if "anchors" not in columns:
                conn.execute("ALTER TABLE memories ADD COLUMN anchors TEXT DEFAULT '{}'")
            if "session_id" not in columns:
                conn.execute("ALTER TABLE memories ADD COLUMN session_id TEXT")

            # 2. Memory relations table for Cognitive Knowledge Graph & Hebbian Learning
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memory_relations (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    weight REAL DEFAULT 1.0,
                    confidence REAL DEFAULT 1.0,
                    created_at TEXT NOT NULL,
                    last_activated_at TEXT NOT NULL,
                    activation_count INTEGER DEFAULT 1,
                    metadata TEXT DEFAULT '{}',
                    FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
                    FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rel_source ON memory_relations(source_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rel_target ON memory_relations(target_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rel_user ON memory_relations(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rel_type ON memory_relations(relation_type)")

            # 3. SQLite FTS5 Virtual Table for full-text / BM25 search
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                        id UNINDEXED,
                        user_id UNINDEXED,
                        content,
                        category,
                        tags,
                        tokenize = 'unicode61'
                    )
                """)
            except sqlite3.OperationalError:
                pass

    def _sync_fts(self, conn: sqlite3.Connection, item: MemoryItem):
        """Helper to sync memory item into FTS5 index."""
        try:
            conn.execute("DELETE FROM memories_fts WHERE id = ?", (item.id,))
            tags_str = " ".join(item.tags) if item.tags else ""
            conn.execute(
                """
                INSERT INTO memories_fts (id, user_id, content, category, tags)
                VALUES (?, ?, ?, ?, ?)
                """,
                (item.id, item.user_id, item.content, item.category, tags_str)
            )
        except sqlite3.OperationalError:
            pass

    def add_memory(self, item: MemoryItem):
        """Save a memory item to SQLite and sync FTS index."""
        embedding_blob = None
        if item.embedding is not None:
            embedding_blob = np.array(item.embedding, dtype=np.float32).tobytes()
        
        anchors_json = json.dumps(item.anchors.model_dump() if item.anchors else {})

        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO memories (
                    id, user_id, content, embedding, importance, category, tags, anchors, session_id, created_at, last_accessed, is_archived, superseded_by, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.user_id,
                    item.content,
                    embedding_blob,
                    item.importance,
                    item.category,
                    json.dumps(item.tags),
                    anchors_json,
                    item.session_id,
                    item.created_at.isoformat(),
                    item.last_accessed.isoformat(),
                    1 if item.is_archived else 0,
                    item.superseded_by,
                    json.dumps(item.metadata)
                )
            )
            self._sync_fts(conn, item)

    def add_memories_batch(self, items: List[MemoryItem]):
        """Save multiple memory items in a single transaction."""
        if not items:
            return
        with self._conn() as conn:
            for item in items:
                embedding_blob = None
                if item.embedding is not None:
                    embedding_blob = np.array(item.embedding, dtype=np.float32).tobytes()
                anchors_json = json.dumps(item.anchors.model_dump() if item.anchors else {})
                conn.execute(
                    """
                    INSERT OR REPLACE INTO memories (
                        id, user_id, content, embedding, importance, category, tags, anchors, session_id, created_at, last_accessed, is_archived, superseded_by, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.id,
                        item.user_id,
                        item.content,
                        embedding_blob,
                        item.importance,
                        item.category,
                        json.dumps(item.tags),
                        anchors_json,
                        item.session_id,
                        item.created_at.isoformat(),
                        item.last_accessed.isoformat(),
                        1 if item.is_archived else 0,
                        item.superseded_by,
                        json.dumps(item.metadata)
                    )
                )
                self._sync_fts(conn, item)

    def _row_to_item(self, row: sqlite3.Row) -> MemoryItem:
        """Helper to convert database row to MemoryItem."""
        embedding = None
        if "embedding" in row.keys() and row["embedding"] is not None:
            embedding = np.frombuffer(row["embedding"], dtype=np.float32).tolist()

        tags = []
        if "tags" in row.keys() and row["tags"]:
            try:
                tags = json.loads(row["tags"])
            except Exception:
                tags = []

        anchors = UniversalAnchors()
        if "anchors" in row.keys() and row["anchors"]:
            try:
                anchors_dict = json.loads(row["anchors"])
                anchors = UniversalAnchors(**anchors_dict)
            except Exception:
                anchors = UniversalAnchors()

        session_id = row["session_id"] if "session_id" in row.keys() else None
        superseded_by = row["superseded_by"] if "superseded_by" in row.keys() else None

        # Parse datetime with timezone safety
        created_at_val = row["created_at"]
        last_acc_val = row["last_accessed"]
        try:
            dt_created = datetime.fromisoformat(created_at_val)
            if dt_created.tzinfo is None:
                dt_created = dt_created.replace(tzinfo=timezone.utc)
        except Exception:
            dt_created = utc_now()

        try:
            dt_last_acc = datetime.fromisoformat(last_acc_val)
            if dt_last_acc.tzinfo is None:
                dt_last_acc = dt_last_acc.replace(tzinfo=timezone.utc)
        except Exception:
            dt_last_acc = utc_now()

        metadata_dict = {}
        if "metadata" in row.keys() and row["metadata"]:
            try:
                metadata_dict = json.loads(row["metadata"])
            except Exception:
                metadata_dict = {}

        return MemoryItem(
            id=row["id"],
            user_id=row["user_id"],
            content=row["content"],
            embedding=embedding,
            importance=row["importance"],
            category=row["category"],
            tags=tags,
            anchors=anchors,
            session_id=session_id,
            created_at=dt_created,
            last_accessed=dt_last_acc,
            is_archived=row["is_archived"] == 1,
            superseded_by=superseded_by,
            metadata=metadata_dict
        )

    def _row_to_relation(self, row: sqlite3.Row) -> MemoryRelation:
        """Helper to convert database row to MemoryRelation."""
        try:
            dt_created = datetime.fromisoformat(row["created_at"])
            if dt_created.tzinfo is None:
                dt_created = dt_created.replace(tzinfo=timezone.utc)
        except Exception:
            dt_created = utc_now()

        try:
            dt_last_act = datetime.fromisoformat(row["last_activated_at"])
            if dt_last_act.tzinfo is None:
                dt_last_act = dt_last_act.replace(tzinfo=timezone.utc)
        except Exception:
            dt_last_act = utc_now()

        metadata_dict = {}
        if "metadata" in row.keys() and row["metadata"]:
            try:
                metadata_dict = json.loads(row["metadata"])
            except Exception:
                metadata_dict = {}

        rel_type_str = row["relation_type"]
        try:
            rel_type = RelationType(rel_type_str)
        except ValueError:
            rel_type = RelationType.SIMILAR

        return MemoryRelation(
            id=row["id"],
            user_id=row["user_id"],
            source_id=row["source_id"],
            target_id=row["target_id"],
            relation_type=rel_type,
            weight=row["weight"],
            confidence=row["confidence"],
            created_at=dt_created,
            last_activated_at=dt_last_act,
            activation_count=row["activation_count"],
            metadata=metadata_dict
        )

    def get_memory(self, item_id: str) -> Optional[MemoryItem]:
        """Fetch a specific memory item by ID."""
        with self._conn() as conn:
            cursor = conn.execute("SELECT * FROM memories WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            return self._row_to_item(row) if row else None

    def get_all_memories(
        self,
        user_id: Optional[str] = None,
        include_archived: bool = False,
        category: Optional[str | List[str]] = None,
        tags: Optional[List[str]] = None,
        metadata_filters: Optional[Dict[str, Any]] = None
    ) -> List[MemoryItem]:
        """Get all memories, optionally filtered by user_id, category, tags, and metadata."""
        query = "SELECT * FROM memories WHERE 1=1"
        params: List[Any] = []
        
        if user_id is not None:
            query += " AND user_id = ?"
            params.append(user_id)
            
        if not include_archived:
            query += " AND is_archived = 0"

        if category is not None:
            if isinstance(category, str):
                query += " AND category = ?"
                params.append(category)
            elif isinstance(category, list) and len(category) > 0:
                placeholders = ",".join(["?"] * len(category))
                query += f" AND category IN ({placeholders})"
                params.extend(category)

        with self._conn() as conn:
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            
        items = [self._row_to_item(row) for row in rows]
        
        if tags:
            tag_set = set(t.lower() for t in tags)
            items = [item for item in items if any(t.lower() in tag_set for t in item.tags)]
            
        if metadata_filters:
            filtered = []
            for item in items:
                matches = all(item.metadata.get(k) == v for k, v in metadata_filters.items())
                if matches:
                    filtered.append(item)
            items = filtered
            
        return items

    def search_keyword(
        self,
        query: str,
        user_id: Optional[str] = None,
        k: int = 10,
        category: Optional[str | List[str]] = None,
        include_archived: bool = False
    ) -> List[Tuple[MemoryItem, float]]:
        """Search memories using SQLite FTS5 BM25 ranking."""
        clean_query = re.sub(r'[^a-zA-Z0-9\s]', ' ', query).strip()
        if not clean_query:
            return []
        
        tokens = clean_query.split()
        fts_query = " OR ".join(f'"{token}"*' for token in tokens)

        sql = """
            SELECT m.*, bm25(memories_fts) as rank
            FROM memories_fts fts
            JOIN memories m ON fts.id = m.id
            WHERE memories_fts MATCH ?
        """
        params: List[Any] = [fts_query]

        if user_id is not None:
            sql += " AND m.user_id = ?"
            params.append(user_id)

        if not include_archived:
            sql += " AND m.is_archived = 0"

        if category is not None:
            if isinstance(category, str):
                sql += " AND m.category = ?"
                params.append(category)
            elif isinstance(category, list) and len(category) > 0:
                placeholders = ",".join(["?"] * len(category))
                sql += f" AND m.category IN ({placeholders})"
                params.extend(category)

        sql += " ORDER BY rank LIMIT ?"
        params.append(k)

        try:
            with self._conn() as conn:
                cursor = conn.execute(sql, params)
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = self._row_to_item(r)
                    raw_rank = float(r["rank"])
                    norm_score = max(0.0, 1.0 / (1.0 + max(0.0, raw_rank + 10.0)))
                    results.append((item, norm_score))
                return results
        except sqlite3.OperationalError:
            return []

    # ==================== Knowledge Graph Relations & Hebbian Plasticity ====================

    def add_relation(self, relation: MemoryRelation) -> MemoryRelation:
        """Add or update a relation between two memory nodes."""
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO memory_relations (
                    id, user_id, source_id, target_id, relation_type, weight, confidence, created_at, last_activated_at, activation_count, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    relation.id,
                    relation.user_id,
                    relation.source_id,
                    relation.target_id,
                    relation.relation_type.value if hasattr(relation.relation_type, "value") else str(relation.relation_type),
                    relation.weight,
                    relation.confidence,
                    relation.created_at.isoformat(),
                    relation.last_activated_at.isoformat(),
                    relation.activation_count,
                    json.dumps(relation.metadata)
                )
            )
        return relation

    def add_relations(self, relations: List[MemoryRelation]):
        """Batch insert or update memory relations."""
        if not relations:
            return
        with self._conn() as conn:
            for rel in relations:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO memory_relations (
                        id, user_id, source_id, target_id, relation_type, weight, confidence, created_at, last_activated_at, activation_count, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rel.id,
                        rel.user_id,
                        rel.source_id,
                        rel.target_id,
                        rel.relation_type.value if hasattr(rel.relation_type, "value") else str(rel.relation_type),
                        rel.weight,
                        rel.confidence,
                        rel.created_at.isoformat(),
                        rel.last_activated_at.isoformat(),
                        rel.activation_count,
                        json.dumps(rel.metadata)
                    )
                )

    def get_relations(
        self,
        user_id: str,
        memory_id: Optional[str] = None,
        relation_type: Optional[str] = None
    ) -> List[MemoryRelation]:
        """Get relations for a user, optionally filtered by memory_id (as source or target) or type."""
        sql = "SELECT * FROM memory_relations WHERE user_id = ?"
        params: List[Any] = [user_id]

        if memory_id is not None:
            sql += " AND (source_id = ? OR target_id = ?)"
            params.extend([memory_id, memory_id])

        if relation_type is not None:
            sql += " AND relation_type = ?"
            params.append(relation_type)

        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            rows = cursor.fetchall()
            return [self._row_to_relation(r) for r in rows]

    def delete_relation(self, relation_id: str, user_id: str) -> bool:
        """Delete a relation by ID."""
        with self._conn() as conn:
            cursor = conn.execute(
                "DELETE FROM memory_relations WHERE id = ? AND user_id = ?",
                (relation_id, user_id)
            )
            return cursor.rowcount > 0

    def delete_relations_between(self, source_id: str, target_id: str, user_id: str) -> bool:
        """Delete all relations between two specific memories."""
        with self._conn() as conn:
            cursor = conn.execute(
                """
                DELETE FROM memory_relations 
                WHERE user_id = ? AND (
                    (source_id = ? AND target_id = ?) OR
                    (source_id = ? AND target_id = ?)
                )
                """,
                (user_id, source_id, target_id, target_id, source_id)
            )
            return cursor.rowcount > 0

    def reinforce_co_recall(self, user_id: str, memory_ids: List[str]) -> int:
        """
        Hebbian Learning Reinforcement:
        When memories are retrieved together in a search response, reinforce connections
        between them. Increments activation_count, updates last_activated_at, and boosts weight.
        If no relation exists between a pair, creates a new CO_RECALLED edge.
        """
        if len(memory_ids) < 2:
            return 0

        reinforced_count = 0
        now_iso = utc_now().isoformat()
        
        # Take pairs from top results (up to top 4 items to avoid quadratic explosion)
        top_ids = memory_ids[:4]
        pairs = []
        for i in range(len(top_ids)):
            for j in range(i + 1, len(top_ids)):
                pairs.append((top_ids[i], top_ids[j]))

        with self._conn() as conn:
            for s_id, t_id in pairs:
                cursor = conn.execute(
                    """
                    SELECT id, weight, activation_count FROM memory_relations
                    WHERE user_id = ? AND (
                        (source_id = ? AND target_id = ?) OR
                        (source_id = ? AND target_id = ?)
                    )
                    LIMIT 1
                    """,
                    (user_id, s_id, t_id, t_id, s_id)
                )
                row = cursor.fetchone()
                if row:
                    rel_id = row["id"]
                    new_weight = min(2.5, float(row["weight"]) + 0.05)
                    conn.execute(
                        """
                        UPDATE memory_relations
                        SET weight = ?, activation_count = activation_count + 1, last_activated_at = ?
                        WHERE id = ?
                        """,
                        (new_weight, now_iso, rel_id)
                    )
                    reinforced_count += 1
                else:
                    # Form a new CO_RECALLED connection
                    conn.execute(
                        """
                        INSERT INTO memory_relations (
                            id, user_id, source_id, target_id, relation_type, weight, confidence, created_at, last_activated_at, activation_count, metadata
                        ) VALUES (?, ?, ?, ?, 'CO_RECALLED', 1.0, 0.85, ?, ?, 1, '{}')
                        """,
                        (str(uuid.uuid4()), user_id, s_id, t_id, now_iso, now_iso)
                    )
                    reinforced_count += 1

        return reinforced_count

    def get_graph(self, user_id: str) -> MemoryGraphData:
        """Fetch all active memories and relations formatted for graph visualization or NetworkX."""
        memories = self.get_all_memories(user_id=user_id, include_archived=False)
        relations = self.get_relations(user_id=user_id)

        nodes = []
        for m in memories:
            nodes.append({
                "id": m.id,
                "content": m.content,
                "category": m.category,
                "importance": m.importance,
                "tags": m.tags,
                "anchors": m.anchors.model_dump() if m.anchors else {},
                "created_at": m.created_at.isoformat()
            })

        edges = []
        for r in relations:
            edges.append({
                "id": r.id,
                "source": r.source_id,
                "target": r.target_id,
                "relation_type": r.relation_type.value if hasattr(r.relation_type, "value") else str(r.relation_type),
                "weight": r.weight,
                "confidence": r.confidence,
                "activation_count": r.activation_count,
                "last_activated_at": r.last_activated_at.isoformat()
            })

        return MemoryGraphData(nodes=nodes, edges=edges)

    # ==================== Lifecycle & Cleanup ====================

    def update_last_accessed(self, item_id: str, timestamp: Optional[datetime] = None):
        """Update last_accessed timestamp."""
        dt = timestamp or utc_now()
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET last_accessed = ? WHERE id = ?",
                (dt.isoformat(), item_id)
            )

    def update_memory_access(self, item_id: str, timestamp: Optional[datetime] = None):
        """Alias for update_last_accessed for backwards compatibility."""
        self.update_last_accessed(item_id, timestamp)

    def update_importance(self, item_id: str, new_importance: float):
        """Update importance score for a memory."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET importance = ? WHERE id = ?",
                (new_importance, item_id)
            )

    def update_memory_importance(self, item_id: str, new_importance: float):
        """Alias for update_importance for backwards compatibility."""
        self.update_importance(item_id, new_importance)

    def archive_memory(self, item_id: str):
        """Mark a memory as archived."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET is_archived = 1 WHERE id = ?",
                (item_id,)
            )

    def supersede_memory(self, old_id: str, new_id: str):
        """Mark an old memory as archived and superseded by a new one."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET is_archived = 1, superseded_by = ? WHERE id = ?",
                (new_id, old_id)
            )

    def delete_memory(self, item_id: str):
        """Delete a memory from the database, relations, and FTS index."""
        with self._conn() as conn:
            conn.execute("DELETE FROM memories WHERE id = ?", (item_id,))
            conn.execute("DELETE FROM memory_relations WHERE source_id = ? OR target_id = ?", (item_id, item_id))
            try:
                conn.execute("DELETE FROM memories_fts WHERE id = ?", (item_id,))
            except sqlite3.OperationalError:
                pass

    def clear_memories(self, user_id: Optional[str] = None):
        """Clear memories, optionally filtered by user_id."""
        with self._conn() as conn:
            if user_id is not None:
                conn.execute("DELETE FROM memories WHERE user_id = ?", (user_id,))
                conn.execute("DELETE FROM memory_relations WHERE user_id = ?", (user_id,))
                try:
                    conn.execute("DELETE FROM memories_fts WHERE user_id = ?", (user_id,))
                except sqlite3.OperationalError:
                    pass
            else:
                conn.execute("DELETE FROM memories")
                conn.execute("DELETE FROM memory_relations")
                try:
                    conn.execute("DELETE FROM memories_fts")
                except sqlite3.OperationalError:
                    pass

    def count_memories(self, user_id: Optional[str] = None, include_archived: bool = False) -> int:
        """Count memories in storage."""
        sql = "SELECT COUNT(*) as count FROM memories WHERE 1=1"
        params = []
        if user_id is not None:
            sql += " AND user_id = ?"
            params.append(user_id)
        if not include_archived:
            sql += " AND is_archived = 0"
        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            row = cursor.fetchone()
            return int(row["count"]) if row else 0
