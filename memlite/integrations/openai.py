import logging

logger = logging.getLogger("memlite.integrations.openai")

try:
    import openai
    from openai import OpenAI as OriginalOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    # Create a dummy class to prevent crash if openai is not installed
    class OriginalOpenAI:
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "The openai package is required to use this integration. "
                "Install it using `pip install openai` or `pip install memlite[openai]`."
            )
    OPENAI_AVAILABLE = False

class OpenAI(OriginalOpenAI):
    def __init__(self, memory, *args, **kwargs):
        """
        Wrapped OpenAI client.
        
        Args:
            memory: An instance of the MemLite Memory class.
        """
        if not OPENAI_AVAILABLE:
            raise ImportError(
                "The openai package is required to use this integration. "
                "Install it using `pip install openai` or `pip install memlite[openai]`."
            )
            
        self.memory = memory
        super().__init__(*args, **kwargs)
        
        # Override the completions create method to inject and record memories
        self.chat.completions.create = self._wrap_create(self.chat.completions.create)

    def _wrap_create(self, original_create):
        def wrapper(*args, **kwargs):
            messages = kwargs.get("messages", [])
            if not messages:
                return original_create(*args, **kwargs)
                
            # Extract user query (the last message from the user)
            user_messages = [m for m in messages if m.get("role") == "user"]
            if not user_messages:
                return original_create(*args, **kwargs)
                
            query = user_messages[-1].get("content", "")
            
            # 1. Retrieve relevant memories for the query
            try:
                search_res = self.memory.search(query)
                memories = search_res.get("memories", [])
            except Exception as e:
                logger.warning(f"Failed to retrieve memories during OpenAI wrapper call: {e}")
                memories = []
                
            # 2. Inject memories as a system context instructions
            if memories:
                context_str = "\n".join([f"- {m}" for m in memories])
                context_prompt = (
                    f"You have access to the following relevant user facts and memories:\n{context_str}\n"
                    "Use this information to customize and personalize your response if relevant. "
                    "Do not explicitly mention you have memory unless asked."
                )
                
                # Clone messages list to modify it
                new_messages = list(messages)
                
                # If first message is system, append the memories
                if new_messages and new_messages[0].get("role") == "system":
                    original_content = new_messages[0].get("content", "")
                    new_messages[0] = {
                        "role": "system",
                        "content": f"{original_content}\n\n{context_prompt}"
                    }
                else:
                    # Otherwise prepend system message
                    new_messages.insert(0, {
                        "role": "system",
                        "content": context_prompt
                    })
                    
                kwargs["messages"] = new_messages
                
            # 3. Perform original completion request
            response = original_create(*args, **kwargs)
            
            # 4. Asynchronously extract new memories from the latest turn and save them
            try:
                if response and hasattr(response, "choices") and response.choices:
                    assistant_msg = response.choices[0].message.content
                    latest_turn = [
                        {"role": "user", "content": query},
                        {"role": "assistant", "content": assistant_msg}
                    ]
                    # Automatically extract & add new memories
                    self.memory.compress_conversation(latest_turn)
            except Exception as e:
                logger.warning(f"Failed to auto-save memory after OpenAI response: {e}")
                
            return response
        return wrapper
