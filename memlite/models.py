import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class MemoryItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    content: str
    embedding: Optional[List[float]] = None
    importance: float = 0.5
    category: str = "General"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_accessed: datetime = Field(default_factory=datetime.utcnow)
    is_archived: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class MemorySearchResult(BaseModel):
    content: str
    similarity: float
    importance: float
    recency: float
    score: float  # Hybrid score
    category: str
    metadata: Dict[str, Any]

class SearchResponse(BaseModel):
    memories: List[str]
    confidence: float
    details: List[MemorySearchResult] = Field(default_factory=list)
