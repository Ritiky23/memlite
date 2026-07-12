import sys
from unittest.mock import MagicMock, patch
import pytest
from memlite.embeddings import get_embedder, OllamaEmbedder, OpenAIEmbedder, SentenceTransformerEmbedder

def test_embedder_factory():
    # Test factory returns correct instances
    local = get_embedder("local", "all-MiniLM-L6-v2")
    assert isinstance(local, SentenceTransformerEmbedder)
    assert local.model_name == "all-MiniLM-L6-v2"
    
    openai = get_embedder("openai", "text-embedding-3-small", openai_api_key="test-key")
    assert isinstance(openai, OpenAIEmbedder)
    assert openai.model == "text-embedding-3-small"
    assert openai.api_key == "test-key"
    
    ollama = get_embedder("ollama", "nomic-embed-text", ollama_base_url="http://localhost:11434")
    assert isinstance(ollama, OllamaEmbedder)
    assert ollama.model == "nomic-embed-text"
    assert ollama.base_url == "http://localhost:11434"
    
    with pytest.raises(ValueError):
        get_embedder("invalid_provider", "model")

@patch("urllib.request.urlopen")
def test_ollama_embedder_http(mock_urlopen):
    # Mock HTTP response from Ollama API
    mock_response = MagicMock()
    mock_response.read.return_value = b'{"embedding": [0.1, 0.2, 0.3]}'
    mock_urlopen.return_value.__enter__.return_value = mock_response
    
    ollama = OllamaEmbedder(model="nomic-embed-text", base_url="http://localhost:11434")
    embedding = ollama.embed_text("Test string")
    
    assert embedding == [0.1, 0.2, 0.3]
    # Check that HTTP payload is built correctly
    mock_urlopen.assert_called_once()
    req = mock_urlopen.call_args[0][0]
    assert req.full_url == "http://localhost:11434/api/embeddings"
    assert req.headers["Content-type"] == "application/json"

@patch("openai.OpenAI")
def test_openai_embedder_client(mock_openai_class):
    # Setup mock openai client structure
    mock_client = MagicMock()
    mock_openai_class.return_value = mock_client
    
    mock_resp = MagicMock()
    mock_resp.data = [MagicMock(embedding=[0.5, 0.6, 0.7])]
    mock_client.embeddings.create.return_value = mock_resp
    
    openai_embedder = OpenAIEmbedder(model="text-embedding-3-small", api_key="sk-test")
    # Manually seed client to trigger mock structure
    openai_embedder._client = mock_client
    
    embedding = openai_embedder.embed_text("Hello OpenAI")
    assert embedding == [0.5, 0.6, 0.7]
    mock_client.embeddings.create.assert_called_once_with(
        input=["Hello OpenAI"],
        model="text-embedding-3-small"
    )
