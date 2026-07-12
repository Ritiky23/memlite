import time
from memlite import Memory

def main():
    print("=" * 60)
    print("🧠 MemLite CLI Chatbot Demo (Local-first offline mode)")
    print("=" * 60)
    print("This demo runs fully locally without API keys, using local heuristic scoring.")
    print("Initializing Memory engine...")
    
    # Initialize Memory with local configurations
    memory = Memory(
        user_id="demo_user",
        embedding_provider="local"  # Will default to SentenceTransformers
    )
    
    # Pre-populate some memories
    print("\nAdding pre-populated facts...")
    memory.add("User's name is Alice", category="Personal", importance=0.9)
    memory.add("Alice prefers dark mode in all applications", category="Preference", importance=0.8)
    memory.add("Alice is building a Python package named MemLite", category="Project", importance=0.9)
    memory.add("Alice knows how to code in Python, Rust, and JavaScript", category="Skill", importance=0.85)
    
    print("Pre-population done!")
    
    while True:
        print("\n" + "-" * 50)
        print("Options:")
        print("1. Search/Retrieve memory")
        print("2. Add new memory statement")
        print("3. View all active memories")
        print("4. Trigger forgetting system cleanup")
        print("5. Exit")
        
        choice = input("\nEnter choice (1-5): ").strip()
        
        if choice == "1":
            query = input("Ask a question about the user: ").strip()
            if not query:
                continue
            
            print(f"\nSearching memory for: '{query}'...")
            start_time = time.time()
            result = memory.search(query, k=3)
            elapsed = time.time() - start_time
            
            print(f"Done in {elapsed:.4f}s")
            print(f"Confidence score: {result['confidence']}")
            print("\nMatched Memories:")
            for i, content in enumerate(result["memories"], 1):
                print(f"{i}. {content}")
                
            print("\nTechnical details:")
            for item in result["details"]:
                print(
                    f" - Content: '{item.content}'\n"
                    f"   Category: {item.category} | Hybrid Score: {item.score:.3f}\n"
                    f"   [Weights: Sim: {item.similarity:.3f}, Imp: {item.importance:.3f}, Rec: {item.recency:.3f}]"
                )
                
        elif choice == "2":
            statement = input("Enter a statement to remember (e.g., 'I love drinking green tea'): ").strip()
            if not statement:
                continue
                
            print("\nAdding memory...")
            item = memory.add(statement)
            print(f"Memory Saved!")
            print(f" - ID: {item.id}")
            print(f" - Categorized as: {item.category}")
            print(f" - Assigned Importance: {item.importance}")
            
        elif choice == "3":
            print("\nAll Active Memories in SQLite Database:")
            memories = memory.storage.get_all_memories(user_id="demo_user", include_archived=False)
            if not memories:
                print("No memories saved yet.")
            for item in memories:
                print(f"[{item.category}] {item.content} (Importance: {item.importance})")
                
        elif choice == "4":
            print("\nRunning forgetting system cleanup (decaying unused memories)...")
            archived = memory.cleanup()
            print(f"Forgetting cycle completed. Archived {archived} memories.")
            
        elif choice == "5":
            print("\nThank you for using MemLite! Goodbye.")
            break
        else:
            print("Invalid selection. Please choose between 1 and 5.")

if __name__ == "__main__":
    main()
