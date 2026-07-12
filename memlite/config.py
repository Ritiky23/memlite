import os
from typing import Optional
from pydantic import BaseModel, Field

class MemLiteConfig(BaseModel):
    # Storage settings
    db_path: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_DB_PATH", os.path.expanduser("~/.memlite/memlite.db"))
    )
    
    # Embedding settings
    # Options: "local" (sentence-transformers), "openai", "ollama"
    embedding_provider: str = Field(
        default_factory=lambda: os.environ.get("MEMLITE_EMBEDDING_PROVIDER", "local")
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
    
    # Retrieval weights (must sum to 1.0 ideally, but normalized in calculation)
    similarity_weight: float = 0.5
    importance_weight: float = 0.3
    recency_weight: float = 0.2
    
    # Forgetting & decay parameters
    # decay_rate per day (e.g. 0.005 means memory score reduces by ~0.5% each day)
    decay_rate: float = 0.005
    archive_threshold: float = 0.15
    
    def model_post_init(self, __context) -> None:
        # Set default embedding models if not specified
        if not self.embedding_model:
            if self.embedding_provider == "local":
                self.embedding_model = "all-MiniLM-L6-v2"
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

