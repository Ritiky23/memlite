import time
from datetime import datetime, timezone
from memlite import Memory, AsyncMemory, MemLiteConfig
from memlite.embeddings import BaseEmbedder

class WordOverlapEmbedder(BaseEmbedder):
    """
    A simple zero-dependency embedder for interactive demonstration.
    Creates mock embeddings based on keyword overlap (no model download required).
    """
    def __init__(self):
        self.vocabulary = [
            "python", "javascript", "rust", "dark", "light", "mode", "backend", 
            "developer", "allergy", "penicillin", "peanut", "coffee", "tea", "database", "postgres"
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
    print("=" * 65)
    print("🧠 MemLite Interactive Feature Showcase")
    print("=" * 65)
    
    # Initialize Memory with custom hybrid config
    config = MemLiteConfig(
        db_path="demo_memory.db",
        hybrid_search=True,
        keyword_weight=0.3,
        similarity_weight=0.5,
        importance_weight=0.1,
        recency_weight=0.1
    )
    memory = Memory(user_id="alice_dev", config=config)
    
    # Inject zero-download embedder for instant offline demo
    mock_embedder = WordOverlapEmbedder()
    memory.embedder = mock_embedder
    memory.retriever.embedder = mock_embedder
    
    # Clear previous demo run data
    memory.clear()
    
    print("\nPre-populating Alice's memories with batch ingestion...")
    memory.add_batch([
        {"content": "Alice prefers dark mode in all IDEs", "category": "Preference", "importance": 0.8, "tags": ["ui", "theme"]},
        {"content": "Alice is allergic to peanuts and shellfish", "category": "Personal", "importance": 1.0, "tags": ["health"]},
        {"content": "Alice builds backend microservices with Python and FastAPI", "category": "Skill", "importance": 0.9, "tags": ["python", "backend"]},
        {"content": "Alice uses PostgreSQL for primary relational storage", "category": "Project", "importance": 0.7, "tags": ["db", "sql"]}
    ])
    print("[OK] 4 memories pre-populated with tags & hybrid FTS5 indexing!\n")
    
    while True:
        print("-" * 55)
        print("Menu Options:")
        print("1. Hybrid Search (Keyword + Semantic Vector)")
        print("2. Add new memory (with tags & contradiction check)")
        print("3. List all active memories")
        print("4. View Memory Stats")
        print("5. Test Memory Contradiction / Supersede Update")
        print("6. Exit")
        
        choice = input("\nEnter choice (1-6): ").strip()
        
        if choice == "1":
            query = input("\nEnter search query (e.g., 'What backend tools and database?'): ").strip()
            if not query:
                continue
                
            tag_filter = input("Filter by tag (optional, e.g. 'backend' or press Enter): ").strip()
            tags = [tag_filter] if tag_filter else None
            
            results = memory.search(query, tags=tags, k=3)
            
            print(f"\nSearch Confidence: {results['confidence']}")
            print("Retrieved Memories:")
            for i, content in enumerate(results["memories"], 1):
                print(f" {i}. {content}")
                
            print("\nRanking Breakdown:")
            for detail in results.get("details", []):
                print(
                    f" - Memory: '{detail.get('content', '')}'\n"
                    f"   Category: {detail.get('category')} | Tags: {detail.get('tags')}\n"
                    f"   Final Score: {detail.get('score'):.3f} | Vector Sim: {detail.get('similarity'):.3f} | BM25 KW: {detail.get('keyword_score'):.3f} | Importance: {detail.get('importance'):.2f}"
                )
                
        elif choice == "2":
            fact = input("\nEnter memory text: ").strip()
            if not fact:
                continue
            cat = input("Category (Preference, Personal, Skill, Project, Temporary, General): ").strip() or None
            tag_input = input("Tags (comma-separated, optional): ").strip()
            tags = [t.strip() for t in tag_input.split(",")] if tag_input else None
            
            item = memory.add(fact, category=cat, tags=tags, update_existing=True)
            print(f"\n[OK] Stored memory (ID: {item.id}, Category: {item.category}, Importance: {item.importance})")
            
        elif choice == "3":
            items = memory.get_all()
            print(f"\nActive memories for Alice ({len(items)} items):")
            for it in items:
                tags_str = f" [tags: {', '.join(it.tags)}]" if it.tags else ""
                print(f" - [{it.category}] {it.content}{tags_str}")
                
        elif choice == "4":
            st = memory.stats()
            print("\nMemory Statistics:")
            import json
            print(json.dumps(st, indent=2))

        elif choice == "5":
            print("\nDemonstrating Contradiction Resolution:")
            print("Current preference: 'Alice prefers dark mode in all IDEs'")
            input("Press Enter to add update: 'Alice switched to light mode in all IDEs' (update_existing=True)...")
            
            new_item = memory.add("Alice switched to light mode in all IDEs", category="Preference", update_existing=True)
            print(f"\n[OK] Added new memory: '{new_item.content}'")
            print("Checking active memories list:")
            items = memory.get_all()
            for it in items:
                if it.category == "Preference":
                    print(f" -> Active preference: '{it.content}'")
                    
        elif choice == "6":
            print("\nExiting demo. Goodbye!")
            break
        else:
            print("Invalid input. Please choose 1-6.")

if __name__ == "__main__":
    main()

