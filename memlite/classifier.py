import numpy as np
from typing import Dict, Tuple, Optional, List

class SemanticPrototypeClassifier:
    """
    Zero-shot semantic category classifier using prototype embeddings.
    Measures conceptual distance against pre-computed category prototypes
    instead of fragile keyword/substring matching.
    """

    PROTOTYPES = {
        "Preference": (
            "User personal preferences, UI theme tastes, design guidelines, "
            "visual style rules, coding style habits, monochrome aesthetics, "
            "and workflow constraints."
        ),
        "Skill": (
            "Programming languages, software frameworks, developer toolchains, "
            "libraries, coding skills, technical syntax, and engineering tools."
        ),
        "Project": (
            "Repository architecture, database schemas, system design, "
            "API endpoints, file layout, configurations, and deployment pipelines."
        ),
        "Personal": (
            "User biographical details, personal identity, location, "
            "health conditions, food allergies, calendar dates, and family."
        )
    }

    # Transient / non-reusable chatter phrases to filter out at the gatekeeper
    EPHEMERAL_PATTERNS = {
        "do it", "ok", "okay", "yes", "no", "sure", "thanks", "thank you",
        "wait", "hold on", "next", "continue", "proceed", "test it",
        "check it", "check this", "see this", "done", "cancel", "stop",
        "what now", "how to test", "run it", "show me", "lets do it",
        "yes lets do it", "fix it", "why not", "try again"
    }

    def __init__(self, embedder):
        self.embedder = embedder
        self._prototype_embeddings: Dict[str, np.ndarray] = {}
        self._initialize_prototypes()

    def _initialize_prototypes(self):
        """Compute and normalize reference prototype vectors."""
        try:
            for cat, desc in self.PROTOTYPES.items():
                emb = self.embedder.embed_text(desc)
                vec = np.array(emb, dtype=np.float32)
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
                self._prototype_embeddings[cat] = vec
        except Exception:
            self._prototype_embeddings = {}

    def classify(self, text: str, threshold: float = 0.40) -> Tuple[str, float]:
        """
        Classify text into a category based on semantic proximity to prototypes.
        Returns: (category, confidence_score)
        """
        if not text or not text.strip() or not self._prototype_embeddings:
            return "General", 0.0

        try:
            emb = self.embedder.embed_text(text)
            vec = np.array(emb, dtype=np.float32)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm

            best_category = "General"
            best_score = -1.0

            for cat, proto_vec in self._prototype_embeddings.items():
                sim = float(np.dot(vec, proto_vec))
                if sim > best_score:
                    best_score = sim
                    best_category = cat

            if best_score >= threshold:
                return best_category, round(best_score, 3)
            return "General", round(best_score, 3)
        except Exception:
            return "General", 0.0

    @classmethod
    def is_memory_worthy(cls, text: str) -> bool:
        """
        Gatekeeper: Determines if a conversation turn is an actual reusable
        memory/fact, or just transient conversational debug chatter.
        """
        cleaned = text.strip().lower()
        if len(cleaned) < 12:
            return False

        # Check against ephemeral phrases
        stripped_punct = "".join(c for c in cleaned if c.isalnum() or c.isspace()).strip()
        if stripped_punct in cls.EPHEMERAL_PATTERNS:
            return False

        # Pure imperatives / single commands without declarative information
        words = stripped_punct.split()
        if len(words) <= 3 and any(w in {"do", "run", "test", "check", "fix", "show", "open"} for w in words):
            return False

        return True
