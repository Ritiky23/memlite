import time
from datetime import datetime
from memlite import Memory
from memlite.embeddings import BaseEmbedder

class WordOverlapEmbedder(BaseEmbedder):
    """
    A simple zero-dependency embedder for interactive demonstration.
    Creates mock embeddings based on keyword overlap (no model download required).
    """
    def __init__(self):
        self.vocabulary = [
            "python", "javascript", "rust", "dark", "light", "mode", "backend", 
            "developer", "allergy", "penicillin", "peanut", "coffee", "tea"
        ]

    def embed_text(self, text: str) -> list:
        text_lower = text.lower()
        vec = [0.0] * len(self.vocabulary)
        for i, word in enumerate(self.vocabulary):
            if word in text_lower:
                vec[i] = 1.0
        # Normalize vector
        total = sum(v ** 2 for v in vec) ** 0.5
        if total > 0:
            vec = [v / total for v in vec]
        return vec

    def embed_batch(self, texts: list) -> list:
        return [self.embed_text(t) for t in texts]

def main():
    print("=" * 60)
    print("🧠 MemLite Lightweight Interactive Demo")
    print("=" * 60)
    print("Initializing local memory...")
    
    # Initialize Memory with SQLite in workspace
    memory = Memory(user_id="alice_dev", db_path="demo_memory.db")
    
    # Inject our zero-download WordOverlapEmbedder
    mock_embedder = WordOverlapEmbedder()
    memory.embedder = mock_embedder
    memory.retriever.embedder = mock_embedder
    
    # Clear any old run data
    memory.clear()
    
    print("\nPre-populating Alice's memories...")
    memory.add("Alice prefers dark mode in applications", category="Preference", importance=0.8)
    memory.add("Alice is allergic to peanuts", category="Personal", importance=1.0)
    memory.add("Alice writes backend servers using Python", category="Skill", importance=0.9)
    print("Memories successfully pre-populated and indexed!")
    
    while True:
        print("\n" + "-" * 50)
        print("Menu Options:")
        print("1. Search/Query memory")
        print("2. Add a new fact to memory")
        print("3. List all current active memories")
        print("4. Exit")
        
        choice = input("\nEnter choice (1-4): ").strip()
        
        if choice == "1":
            query = input("\nEnter query (e.g. 'What does Alice use for coding?'): ").strip()
            if not query:
                continue
                
            print(f"\nSearching database for similarity to: '{query}'...")
            results = memory.search(query, k=3)
            
            print(f"\nConfidence: {results['confidence']}")
            print("Matched Memories:")
            for i, content in enumerate(results["memories"], 1):
                print(f" {i}. {content}")
                
            print("\nTechnical Hybrid-Ranking Scores:")
            for detail in results["details"]:
                print(
                    f" - Memory: '{detail.content}'\n"
                    f"   Category: {detail.category} | Final Score: {detail.score:.3f}\n"
                    f"   [Cosine Similarity: {detail.similarity:.2f} | Importance: {detail.importance:.2f} | Recency: {detail.recency:.2f}]"
                )
                
        elif choice == "2":
            fact = input("\nEnter memory fact to save (e.g., 'Alice enjoys drinking green tea'): ").strip()
            if not fact:
                continue
            item = memory.add(fact)
            print("\nSaved memory details:")
            print(f" - Content: '{item.content}'")
            print(f" - Importance score: {item.importance}")
            print(f" - Category: {item.category}")
            
        elif choice == "3":
            print("\nSQLite Table Contents:")
            items = memory.storage.get_all_memories(user_id="alice_dev")
            if not items:
                print("No memories stored yet.")
            for item in items:
                print(f" - [{item.category}] {item.content} (Importance: {item.importance})")
                
        elif choice == "4":
            print("\nExiting. Thank you!")
            break
        else:
            print("Invalid input. Please enter 1, 2, 3 or 4.")

if __name__ == "__main__":
    main()
