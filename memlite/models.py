import uuid
from enum import Enum
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ConfigDict

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class RelationType(str, Enum):
    SIMILAR = "SIMILAR"              # Semantic embedding proximity
    ENTITY = "ENTITY"                # Shared anchor (person, place, tool, condition)
    TEMPORAL = "TEMPORAL"            # Occurred in same session / time frame
    CAUSAL = "CAUSAL"                # Cause -> Effect / Rule -> Consequence
    CONTRADICTS = "CONTRADICTS"      # Incompatible claims for conflict resolution
    SUPERSEDES = "SUPERSEDES"        # Replaced / updated older memory
    DERIVED_FROM = "DERIVED_FROM"    # Synthesized / consolidated insight
    PRECEDES = "PRECEDES"            # Sequential workflow step before
    FOLLOWS = "FOLLOWS"              # Sequential workflow step after
    CO_RECALLED = "CO_RECALLED"      # Learned association from co-retrieval (Hebbian)

class UniversalAnchors(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    who: List[str] = Field(default_factory=list)      # PERSON / Agent
    where: List[str] = Field(default_factory=list)    # GPE, LOC, Path, Environment
    when: List[str] = Field(default_factory=list)     # DATE, TIME, Temporal anchor
    what: List[str] = Field(default_factory=list)     # ORG, PRODUCT, Concept, Tech

class MemoryRelation(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    source_id: str
    target_id: str
    relation_type: RelationType = RelationType.SIMILAR
    weight: float = 1.0
    confidence: float = 1.0
    created_at: datetime = Field(default_factory=utc_now)
    last_activated_at: datetime = Field(default_factory=utc_now)
    activation_count: int = 1
    metadata: Dict[str, Any] = Field(default_factory=dict)

class MemoryItem(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    content: str
    embedding: Optional[List[float]] = None
    importance: float = 0.5
    category: str = "General"
    tags: List[str] = Field(default_factory=list)
    anchors: UniversalAnchors = Field(default_factory=UniversalAnchors)
    session_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    last_accessed: datetime = Field(default_factory=utc_now)
    is_archived: bool = False
    superseded_by: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class MemorySearchResult(BaseModel):
    id: Optional[str] = None
    content: str
    similarity: float = 0.0
    keyword_score: float = 0.0
    graph_score: float = 0.0
    hop_distance: int = 0
    via_relation: Optional[str] = None
    importance: float = 0.5
    recency: float = 1.0
    score: float = 0.0  # Combined Hybrid + Associative score
    category: str = "General"
    tags: List[str] = Field(default_factory=list)
    anchors: Optional[UniversalAnchors] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class SearchResponse(BaseModel):
    memories: List[str]
    confidence: float
    details: List[MemorySearchResult] = Field(default_factory=list)

class MemoryGraphData(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
