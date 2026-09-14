import os
import json
import urllib.request
from abc import ABC, abstractmethod
from typing import List, Optional

class BaseEmbedder(ABC):
    @abstractmethod
    def embed_text(self, text: str) -> List[float]:
        """Generate vector embedding for a single text string."""
        pass

    @abstractmethod
    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate vector embeddings for a list of text strings."""
        pass

class FastEmbedEmbedder(BaseEmbedder):
    """
    Ultra-lightweight local embedder using ONNX Runtime (fastembed).
    Zero PyTorch dependency, extremely fast cold starts and inference.
    """
    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5"):
        self.model_name = model_name or "BAAI/bge-small-en-v1.5"
        self._model = None

    @property
    def model(self):
        if self._model is None:
            try:
                from fastembed import TextEmbedding
                self._model = TextEmbedding(model_name=self.model_name)
            except ImportError:
                raise ImportError(
                    "fastembed is not installed. "
                    "Install it using `pip install fastembed` to use ultra-fast ONNX embeddings."
                )
        return self._model

    def embed_text(self, text: str) -> List[float]:
        embeddings = list(self.model.embed([text]))
        return embeddings[0].tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        embeddings = list(self.model.embed(texts))
        return [e.tolist() for e in embeddings]

class SentenceTransformerEmbedder(BaseEmbedder):
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name or "all-MiniLM-L6-v2"
        self._model = None

    @property
    def model(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self.model_name)
            except ImportError:
                raise ImportError(
                    "sentence-transformers is not installed. "
                    "Install it using `pip install memlite[local]` or `pip install sentence-transformers` to use local embeddings."
                )
        return self._model

    def embed_text(self, text: str) -> List[float]:
        vector = self.model.encode(text)
        return vector.tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        vectors = self.model.encode(texts)
        return vectors.tolist()

class OpenAIEmbedder(BaseEmbedder):
    def __init__(self, model: str = "text-embedding-3-small", api_key: Optional[str] = None):
        self.model = model or "text-embedding-3-small"
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                import openai
            except ImportError:
                raise ImportError(
                    "openai is not installed. "
                    "Install it using `pip install memlite[openai]` or `pip install openai` to use OpenAI embeddings."
                )
            if not self.api_key:
                raise ValueError("OpenAI API key is missing. Please set the OPENAI_API_KEY environment variable or pass it to config.")
            self._client = openai.OpenAI(api_key=self.api_key)
        return self._client

    def embed_text(self, text: str) -> List[float]:
        response = self.client.embeddings.create(input=[text], model=self.model)
        return response.data[0].embedding

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        response = self.client.embeddings.create(input=texts, model=self.model)
        return [item.embedding for item in response.data]

class OllamaEmbedder(BaseEmbedder):
    def __init__(self, model: str = "nomic-embed-text", base_url: str = "http://localhost:11434"):
        self.model = model or "nomic-embed-text"
        self.base_url = base_url.rstrip("/")

    def embed_text(self, text: str) -> List[float]:
        url = f"{self.base_url}/api/embeddings"
        payload = json.dumps({"model": self.model, "prompt": text}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req) as res:
                response = json.loads(res.read().decode("utf-8"))
                return response["embedding"]
        except Exception as e:
            raise RuntimeError(f"Ollama embedding request failed: {e}")

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        return [self.embed_text(t) for t in texts]

def get_embedder(provider: str, model: str = "", **kwargs) -> BaseEmbedder:
    provider = (provider or "local").lower()
    if provider == "fastembed":
        return FastEmbedEmbedder(model_name=model)
    elif provider in ("local", "sentence-transformers", "sentence_transformers"):
        return SentenceTransformerEmbedder(model_name=model)
    elif provider == "openai":
        return OpenAIEmbedder(model=model, api_key=kwargs.get("openai_api_key"))
    elif provider == "ollama":
        return OllamaEmbedder(model=model, base_url=kwargs.get("ollama_base_url"))
    else:
        raise ValueError(f"Unknown embedding provider: {provider}. Options: 'local', 'fastembed', 'openai', 'ollama'")

