import os
import fitz  # PyMuPDF
from docx import Document


def extract_text(file_path: str, filename: str) -> tuple[str, int]:
    """Extract text from PDF or DOCX. Returns (text, num_pages)."""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        doc = fitz.open(file_path)
        text = "".join(page.get_text() for page in doc)
        pages = len(doc)
        doc.close()
        return text, pages

    elif ext in (".docx", ".doc"):
        doc = Document(file_path)
        text = "\n".join(p.text for p in doc.paragraphs)
        pages = max(1, len(text) // 3000)
        return text, pages

    else:
        raise ValueError(f"Formato non supportato: {ext}")
