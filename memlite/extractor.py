import re
from typing import Optional, List
from memlite.models import UniversalAnchors

# Global singleton cache for spaCy NLP model
_SPACY_NLP = None
_SPACY_TRIED = False

def get_spacy_nlp():
    global _SPACY_NLP, _SPACY_TRIED
    if not _SPACY_TRIED:
        _SPACY_TRIED = True
        try:
            import spacy
            try:
                _SPACY_NLP = spacy.load("en_core_web_sm")
            except Exception:
                # If model not installed, try blank english with sentencizer
                try:
                    _SPACY_NLP = spacy.blank("en")
                except Exception:
                    _SPACY_NLP = None
        except ImportError:
            _SPACY_NLP = None
    return _SPACY_NLP

class EntityAnchorExtractor:
    """
    Extracts Universal Cognitive Anchors (Who, Where, When, What) from natural language.
    Uses spaCy when available, with a fast heuristic fallback for zero-dependency portability.
    """

    # Common English stop-words to exclude from 'what' concepts
    STOP_WORDS = {
        "the", "a", "an", "this", "that", "these", "those", "is", "are", "was", "were",
        "be", "been", "being", "have", "has", "had", "do", "does", "did", "to", "at",
        "in", "on", "by", "for", "with", "about", "against", "between", "into", "through",
        "during", "before", "after", "above", "below", "from", "up", "down", "of", "off",
        "over", "under", "again", "further", "then", "once", "here", "there", "when",
        "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
        "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than",
        "too", "very", "can", "will", "just", "don", "should", "now", "it", "its", "our",
        "my", "me", "we", "us", "you", "your", "they", "them", "their", "he", "him", "his",
        "she", "her", "i"
    }

    # Temporal indicator regexes for heuristic fallback
    TIME_PATTERNS = re.compile(
        r"\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        r"morning|afternoon|evening|tonight|thanksgiving|christmas|halloween|new year|"
        r"january|february|march|april|may|june|july|august|september|october|november|december|"
        r"\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4})\b",
        re.IGNORECASE
    )

    @classmethod
    def extract_anchors(cls, text: str) -> UniversalAnchors:
        """Extract Universal Anchors: Who, Where, When, What."""
        if not text or not text.strip():
            return UniversalAnchors()

        nlp = get_spacy_nlp()
        if nlp is not None and hasattr(nlp, "pipe_names") and "ner" in nlp.pipe_names:
            return cls._extract_with_spacy(nlp, text)
        else:
            return cls._extract_with_heuristics(text)

    @classmethod
    def _extract_with_spacy(cls, nlp, text: str) -> UniversalAnchors:
        doc = nlp(text)
        who: List[str] = []
        where: List[str] = []
        when: List[str] = []
        what: List[str] = []

        for ent in doc.ents:
            cleaned = ent.text.strip()
            if not cleaned or len(cleaned) < 2:
                continue

            label = ent.label_
            if label in ("PERSON", "PER"):
                if cleaned not in who:
                    who.append(cleaned)
            elif label in ("GPE", "LOC", "FAC"):
                if cleaned not in where:
                    where.append(cleaned)
            elif label in ("DATE", "TIME"):
                if cleaned not in when:
                    when.append(cleaned)
            elif label in ("ORG", "PRODUCT", "EVENT", "WORK_OF_ART", "LAW", "LANGUAGE"):
                if cleaned not in what:
                    what.append(cleaned)

        # Also extract significant noun chunks if 'what' is sparse
        if len(what) < 2 and hasattr(doc, "noun_chunks"):
            for chunk in doc.noun_chunks:
                chunk_str = chunk.text.strip()
                words = [w.lower() for w in chunk_str.split() if w.lower() not in cls.STOP_WORDS]
                if words and len(" ".join(words)) > 2:
                    val = " ".join(words).title()
                    if val not in what and val not in who and val not in where:
                        what.append(val)

        return UniversalAnchors(who=who, where=where, when=when, what=what[:6])

    @classmethod
    def _extract_with_heuristics(cls, text: str) -> UniversalAnchors:
        """Lightweight regex & capitalization heuristic fallback."""
        who: List[str] = []
        where: List[str] = []
        when: List[str] = []
        what: List[str] = []

        # Find temporal anchors
        for match in cls.TIME_PATTERNS.finditer(text):
            t_val = match.group(0).title()
            if t_val not in when:
                when.append(t_val)

        # Capitalized words (potential names/places/tools)
        tokens = re.findall(r"\b[A-Z][a-zA-Z0-9_\-\.]+\b", text)
        for tok in tokens:
            if tok.lower() in cls.STOP_WORDS or tok in when:
                continue
            if len(tok) > 2 and tok not in what:
                what.append(tok)

        # Check quoted expressions (e.g. commands, specific names)
        quoted = re.findall(r"['\"`]([^'\"`]+)['\"`]", text)
        for q in quoted:
            q_clean = q.strip()
            if q_clean and len(q_clean) > 2 and q_clean not in what:
                what.append(q_clean)

        return UniversalAnchors(who=who, where=where, when=when, what=what[:6])
