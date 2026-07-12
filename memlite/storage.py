import os
import sqlite3
import json
import numpy as np
from datetime import datetime
from typing import List, Optional, Dict, Any
from contextlib import contextmanager
from memlite.models import MemoryItem

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
        """Create the memories table if it does not exist."""
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding BLOB,
                    importance REAL NOT NULL,
                    category TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_accessed TEXT NOT NULL,
                    is_archived INTEGER DEFAULT 0,
                    metadata TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_is_archived ON memories(is_archived)")

    def add_memory(self, item: MemoryItem):
        """Save a memory item to SQLite."""
        embedding_blob = None
        if item.embedding is not None:
            embedding_blob = np.array(item.embedding, dtype=np.float32).tobytes()
        
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO memories (
                    id, user_id, content, embedding, importance, category, created_at, last_accessed, is_archived, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.user_id,
                    item.content,
                    embedding_blob,
                    item.importance,
                    item.category,
                    item.created_at.isoformat(),
                    item.last_accessed.isoformat(),
                    1 if item.is_archived else 0,
                    json.dumps(item.metadata)
                )
            )

    def _row_to_item(self, row: sqlite3.Row) -> MemoryItem:
        """Helper to convert database row to MemoryItem."""
        embedding = None
        if row["embedding"] is not None:
            embedding = np.frombuffer(row["embedding"], dtype=np.float32).tolist()

        return MemoryItem(
            id=row["id"],
            user_id=row["user_id"],
            content=row["content"],
            embedding=embedding,
            importance=row["importance"],
            category=row["category"],
            created_at=datetime.fromisoformat(row["created_at"]),
            last_accessed=datetime.fromisoformat(row["last_accessed"]),
            is_archived=row["is_archived"] == 1,
            metadata=json.loads(row["metadata"])
        )

    def get_memory(self, item_id: str) -> Optional[MemoryItem]:
        """Fetch a specific memory item by ID."""
        with self._conn() as conn:
            cursor = conn.execute("SELECT * FROM memories WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            return self._row_to_item(row) if row else None

    def get_all_memories(self, user_id: Optional[str] = None, include_archived: bool = False) -> List[MemoryItem]:
        """Get all memories, optionally filtered by user_id and archived state."""
        query = "SELECT * FROM memories WHERE 1=1"
        params = []
        
        if user_id is not None:
            query += " AND user_id = ?"
            params.append(user_id)
            
        if not include_archived:
            query += " AND is_archived = 0"
            
        with self._conn() as conn:
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            return [self._row_to_item(row) for row in rows]

    def update_memory_access(self, item_id: str, last_accessed: Optional[datetime] = None):
        """Update the last accessed timestamp of a memory."""
        dt = last_accessed or datetime.utcnow()
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET last_accessed = ? WHERE id = ?",
                (dt.isoformat(), item_id)
            )

    def update_memory_importance(self, item_id: str, new_importance: float):
        """Update the importance score of a memory."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET importance = ? WHERE id = ?",
                (new_importance, item_id)
            )

    def archive_memory(self, item_id: str):
        """Mark a memory as archived."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE memories SET is_archived = 1 WHERE id = ?",
                (item_id,)
            )

    def delete_memory(self, item_id: str):
        """Delete a memory from the database."""
        with self._conn() as conn:
            conn.execute("DELETE FROM memories WHERE id = ?", (item_id,))

    def clear_memories(self, user_id: Optional[str] = None):
        """Clear memories, optionally filtered by user_id."""
        query = "DELETE FROM memories"
        params = []
        if user_id is not None:
            query += " WHERE user_id = ?"
            params.append(user_id)
            
        with self._conn() as conn:
            conn.execute(query, params)
