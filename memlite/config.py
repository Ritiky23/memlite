import os
from typing import Optional, Dict
from pydantic import BaseModel, Field, ConfigDict

class MemLiteConfig(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    # Storage settings
    db_path: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_DB_PATH", os.path.expanduser("~/.memlite/memlite.db"))
    )
    
    # Embedding settings
    # Options: "fastembed" (ONNX, default), "local" (sentence-transformers), "openai", "ollama"
    embedding_provider: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_EMBEDDING_PROVIDER", "fastembed")
    )
    embedding_model: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_EMBEDDING_MODEL", "")
    )
    
    # API credentials
    openai_api_key: Optional[str] = Field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY")
    )
    ollama_base_url: str = Field(
        default_factory=lambda: os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    )
    llm_model: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_LLM_MODEL", "")
    )
    
    # Retrieval & Search weights
    hybrid_search: bool = True
    keyword_weight: float = 0.3
    similarity_weight: float = 0.5
    importance_weight: float = 0.1
    recency_weight: float = 0.1
    
    # Forgetting & decay parameters
    # Default decay_rate per day (0.005 = ~0.5% per day)
    decay_rate: float = 0.005
    archive_threshold: float = 0.15
    
    # Multipliers applied to base decay_rate per category
    category_decay_multipliers: Dict[str, float] = Field(
        default_factory=lambda: {
            "Personal": 0.02,
            "Preference": 0.1,
            "Skill": 0.1,
            "Project": 0.4,
            "General": 1.0,
            "Temporary": 4.0,
        }
    )

    # Optional absolute category decay rate overrides (per day)
    category_decay_rates: Dict[str, float] = Field(default_factory=dict)
    
    def get_decay_rate(self, category: str) -> float:
        """Calculate effective decay rate for a category."""
        if self.category_decay_rates and category in self.category_decay_rates:
            return self.category_decay_rates[category]
        multiplier = self.category_decay_multipliers.get(category, 1.0)
        return self.decay_rate * multiplier

    
    def model_post_init(self, __context) -> None:
        # Set default embedding models if not specified
        if not self.embedding_model:
            if self.embedding_provider == "local":
                self.embedding_model = "all-MiniLM-L6-v2"
            elif self.embedding_provider == "fastembed":
                self.embedding_model = "BAAI/bge-small-en-v1.5"
            elif self.embedding_provider == "openai":
                self.embedding_model = "text-embedding-3-small"
            elif self.embedding_provider == "ollama":
                self.embedding_model = "nomic-embed-text"
            else:
                self.embedding_model = "all-MiniLM-L6-v2"

        # Set default LLM models if not specified
        if not self.llm_model:
            if self.embedding_provider == "openai":
                self.llm_model = "gpt-4o-mini"
            elif self.embedding_provider == "ollama":
                self.llm_model = "llama3"
            else:
                self.llm_model = ""


