import os
from memlite import Memory
from memlite.integrations.openai import OpenAI

def main():
    print("=" * 60)
    print("🧠 MemLite OpenAI Integration Assistant Demo")
    print("=" * 60)
    
    # Check for OpenAI API key
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("WARNING: OPENAI_API_KEY environment variable is not set.")
        print("To run this demo fully, please set it. For this dry run, we will guide you through how it operates.")
        api_key = "dummy-key-for-demonstration"
        
    # 1. Initialize Memory engine
    print("\nInitializing Memory...")
    memory = Memory(
        user_id="user_ritik",
        embedding_provider="openai",
        openai_api_key=api_key
    )
    
    # 2. Add some facts to memory
    print("Adding facts to memory...")
    memory.add("User's name is Ritik", user_id="user_ritik")
    memory.add("Ritik prefers backend development with Python", user_id="user_ritik")
    memory.add("Ritik is highly allergic to peanuts", user_id="user_ritik")
    
    # 3. Instantiate the wrapped OpenAI client
    print("Initializing wrapped OpenAI client...")
    client = OpenAI(memory=memory, api_key=api_key)
    
    print("\nBelow is the code snippet of how you use it:")
    print("-" * 60)
    print("""
    from memlite import Memory
    from memlite.integrations.openai import OpenAI
    
    memory = Memory(user_id="user_ritik", embedding_provider="openai")
    client = OpenAI(memory=memory)
    
    # When you call chat.completions.create, MemLite automatically:
    # 1. Searches user_ritik's memory for keywords like 'backend design' or 'allergies'
    # 2. Injects relevant memories as system instructions
    # 3. Executes the completion
    # 4. Compresses the response to extract and save new facts
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Suggest a dinner menu for me. Keep in mind what I do and my health issues."}
        ]
    )
    """)
    print("-" * 60)
    
    # If the user has a real key, they can run this. Otherwise we stop.
    if api_key == "dummy-key-for-demonstration":
        print("\nSet a valid OPENAI_API_KEY environment variable to execute the live completion.")
    else:
        print("\nRunning live chat completion...")
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": "Suggest a dinner menu for me. Keep in mind what I do and my health issues."}
                ]
            )
            print("\nAssistant Response:")
            print(response.choices[0].message.content)
            
            print("\nChecking updated memories after conversation compression:")
            active = memory.storage.get_all_memories(user_id="user_ritik")
            for item in active:
                print(f" - [{item.category}] {item.content}")
        except Exception as e:
            print(f"\nExecution failed: {e}")
            print("Make sure your API key is valid and you have network connectivity.")

if __name__ == "__main__":
    main()
