import pytest
from memlite.classifier import SemanticPrototypeClassifier
from memlite.embeddings import get_embedder

@pytest.fixture
def embedder():
    return get_embedder("fastembed")

def test_semantic_prototype_classifier(embedder):
    classifier = SemanticPrototypeClassifier(embedder)

    # 1. Test Preference classification without naive keywords
    cat_pref, conf_pref = classifier.classify("I always use dark mode in editors and dislike bright white themes")
    assert cat_pref == "Preference"
    assert conf_pref >= 0.40

    # 2. Test Skill / Tech classification
    cat_skill, conf_skill = classifier.classify("Writing asynchronous microservices with FastAPI, Python 3.11, and SQLite")
    assert cat_skill in ("Skill", "Project")
    assert conf_skill >= 0.40

    # 3. Test Personal classification
    cat_pers, conf_pers = classifier.classify("Sarah lives in Seattle and has a severe peanut allergy")
    assert cat_pers == "Personal"
    assert conf_pers >= 0.40

def test_gatekeeper_ephemeral_filtering():
    # Transient chatter that should be ignored
    assert SemanticPrototypeClassifier.is_memory_worthy("do it") is False
    assert SemanticPrototypeClassifier.is_memory_worthy("ok") is False
    assert SemanticPrototypeClassifier.is_memory_worthy("test it") is False
    assert SemanticPrototypeClassifier.is_memory_worthy("yes lets do it") is False
    assert SemanticPrototypeClassifier.is_memory_worthy("check this") is False

    # Declarative knowledge that should be remembered
    assert SemanticPrototypeClassifier.is_memory_worthy("I prefer single-color monochrome iconography over emoji") is True
    assert SemanticPrototypeClassifier.is_memory_worthy("FastAPI connects to PostgreSQL on port 5432") is True
