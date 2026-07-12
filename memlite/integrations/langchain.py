from typing import List, Any, Optional

try:
    from langchain_core.retrievers import BaseRetriever
    from langchain_core.documents import Document
    from langchain_core.callbacks import CallbackManagerForRetrieverRun
    LANGCHAIN_AVAILABLE = True
except ImportError:
    # Use object as fallback base class to avoid runtime issues if LangChain is absent
    BaseRetriever = object
    Document = None
    CallbackManagerForRetrieverRun = None
    LANGCHAIN_AVAILABLE = False

class MemoryRetriever(BaseRetriever) if LANGCHAIN_AVAILABLE else object:
    # Fields must be type hinted and set up for Pydantic in LangChain
    # We use 'Any' for memory to avoid strict type checks and circular imports
    memory: Any
    k: int = 5
    user_id: Optional[str] = None

    def __init__(self, **kwargs):
        if not LANGCHAIN_AVAILABLE:
            raise ImportError(
                "The langchain-core package is required to use this integration. "
                "Install it using `pip install langchain-core`."
            )
        super().__init__(**kwargs)

    def _get_relevant_documents(
        self, query: str, *, run_manager: Optional[CallbackManagerForRetrieverRun] = None
    ) -> List[Any]:
        """Retrieve memories from MemLite and convert them to LangChain Documents."""
        res = self.memory.search(query, user_id=self.user_id, k=self.k)
        details = res.get("details", [])
        
        documents = []
        for item in details:
            doc = Document(
                page_content=item.content,
                metadata={
                    "similarity": item.similarity,
                    "importance": item.importance,
                    "recency": item.recency,
                    "score": item.score,
                    "category": item.category,
                    **item.metadata
                }
            )
            documents.append(doc)
        return documents
