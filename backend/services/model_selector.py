_COMPLEX_TERMS = {
    "penalty", "liability", "termination", "indemnification",
    "penale", "responsabilità", "rescissione", "indennizzo",
    "liquidated damages", "force majeure", "arbitration",
}


def select_model(text: str) -> str:
    """Return claude-haiku for simple docs, claude-sonnet for complex ones."""
    word_count = len(text.split())
    text_lower = text.lower()

    has_complex = any(term in text_lower for term in _COMPLEX_TERMS)

    if word_count > 1500 or has_complex:
        return "claude-sonnet-4-6"
    return "claude-haiku-4-5-20251001"
