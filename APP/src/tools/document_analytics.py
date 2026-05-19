"""
Document Analytics — extract text from a document, compute statistics,
and use the LLM gateway for AI-powered insights.

Supports: PDF, DOCX, TXT, MD, HTML
Local stats: word count, sentence count, paragraph count, unique words,
             reading time, top keywords, avg sentence length.
AI insights: summary, main topics, tone, key entities — via Groq LLM gateway.
"""
from __future__ import annotations

import json
import logging
import os
import re
import string
import requests
from collections import Counter
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Stopwords (English) ───────────────────────────────────────────────────────

_STOPWORDS: frozenset[str] = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "it",
    "its", "that", "this", "these", "those", "i", "we", "you", "he", "she",
    "they", "me", "us", "him", "her", "them", "my", "our", "your", "his",
    "their", "what", "which", "who", "when", "where", "how", "not", "no",
    "if", "then", "so", "than", "too", "very", "just", "about", "up",
    "out", "into", "over", "after", "before", "between", "through", "also",
    "more", "all", "any", "each", "other", "such", "only", "same", "also",
    "both", "because", "while", "although", "however", "therefore", "thus",
    "de", "la", "le", "les", "un", "une", "des", "du", "en", "et", "est",
    "il", "elle", "ils", "elles", "ce", "qui", "que", "ne", "pas", "plus",
})

_SENTENCE_RE = re.compile(r'[.!?]+\s+')


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_text(file_path: str) -> str:
    """Extract plain text from a document file."""
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == ".txt" or ext == ".md":
        return path.read_text(encoding="utf-8", errors="replace")

    if ext in (".html", ".htm"):
        return _extract_html(path)

    if ext in (".pdf",):
        return _extract_pdf(path)

    if ext in (".docx", ".doc"):
        return _extract_docx(path)

    raise ValueError(f"Unsupported file type: {ext}")


def _extract_html(path: Path) -> str:
    try:
        from bs4 import BeautifulSoup
        html = path.read_text(encoding="utf-8", errors="replace")
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "head"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)
    except ImportError:
        html = path.read_text(encoding="utf-8", errors="replace")
        return re.sub(r'<[^>]+>', ' ', html)


def _extract_pdf(path: Path) -> str:
    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text.strip():
                    pages.append(text)
        return "\n\n".join(pages)
    except ImportError:
        pass

    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(path))
        pages = [doc[i].get_text() for i in range(len(doc))]
        doc.close()
        return "\n\n".join(p for p in pages if p.strip())
    except ImportError:
        pass

    raise RuntimeError("PDF extraction requires pdfplumber or PyMuPDF. Install with: pip install pdfplumber")


def _extract_docx(path: Path) -> str:
    try:
        from docx import Document
        doc = Document(str(path))
        return "\n".join(p.text for p in doc.paragraphs)
    except ImportError:
        raise RuntimeError("DOCX extraction requires python-docx. Install with: pip install python-docx")


# ── Local statistics ──────────────────────────────────────────────────────────

def compute_stats(text: str) -> dict[str, Any]:
    """Compute document statistics from extracted plain text."""
    words_raw = text.split()
    word_count = len(words_raw)

    # Clean tokens for keyword/unique analysis
    clean = [w.strip(string.punctuation).lower() for w in words_raw]
    clean = [w for w in clean if w and not w.isdigit()]

    unique_words = len(set(clean))

    # Sentences (heuristic)
    sentences = [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]
    sentence_count = max(len(sentences), 1)

    # Paragraphs (blank-line separated)
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    paragraph_count = max(len(paragraphs), 1)

    # Averages
    avg_words_per_sentence = round(word_count / sentence_count, 1)
    avg_word_length = round(
        sum(len(w) for w in clean) / max(len(clean), 1), 2
    )

    # Reading time (average 238 wpm for adult readers)
    reading_time_min = round(word_count / 238, 2)

    # Estimated pages (250 words per page — standard manuscript)
    estimated_pages = round(word_count / 250, 2)

    # Character count (no spaces)
    char_count_no_spaces = len(text.replace(" ", "").replace("\n", ""))
    char_count = len(text)

    # Top 15 keywords (most frequent non-stopword tokens)
    keyword_tokens = [w for w in clean if w not in _STOPWORDS and len(w) > 2]
    top_keywords = [word for word, _ in Counter(keyword_tokens).most_common(15)]

    # Flesch reading ease approximation
    syllables = sum(_count_syllables(w) for w in clean)
    flesch = 206.835 - 1.015 * avg_words_per_sentence - 84.6 * (syllables / max(word_count, 1))
    flesch = round(max(0.0, min(100.0, flesch)), 1)

    return {
        "word_count": word_count,
        "character_count": char_count,
        "character_count_no_spaces": char_count_no_spaces,
        "sentence_count": sentence_count,
        "paragraph_count": paragraph_count,
        "unique_words": unique_words,
        "avg_words_per_sentence": avg_words_per_sentence,
        "avg_word_length": avg_word_length,
        "reading_time_min": reading_time_min,
        "estimated_pages": estimated_pages,
        "top_keywords": top_keywords,
        "flesch_reading_ease": flesch,
        "flesch_grade": _flesch_grade(flesch),
    }


def _count_syllables(word: str) -> int:
    """Rough English syllable counter using vowel-group heuristic."""
    word = word.lower().strip(string.punctuation)
    if not word:
        return 0
    vowels = "aeiouy"
    count = 0
    prev_vowel = False
    for ch in word:
        is_v = ch in vowels
        if is_v and not prev_vowel:
            count += 1
        prev_vowel = is_v
    if word.endswith("e") and count > 1:
        count -= 1
    return max(count, 1)


def _flesch_grade(score: float) -> str:
    if score >= 90: return "Very Easy (5th grade)"
    if score >= 80: return "Easy (6th grade)"
    if score >= 70: return "Fairly Easy (7th grade)"
    if score >= 60: return "Standard (8th–9th grade)"
    if score >= 50: return "Fairly Difficult (10th–12th grade)"
    if score >= 30: return "Difficult (College)"
    return "Very Difficult (Professional)"


# ── LLM insight via gateway ───────────────────────────────────────────────────

_LLM_GATEWAY = "http://127.0.0.1:8000"
_INSIGHT_WORD_LIMIT = 1500  # words sent to LLM — keeps context short so the model has room to respond

_SYSTEM_PROMPT = (
    "You are a document analysis assistant. "
    "You MUST respond with ONLY a raw JSON object — no markdown, no code fences, no explanation text. "
    "Your entire response must be valid JSON starting with { and ending with }."
)

_JSON_OBJECT_RE = re.compile(r'\{[\s\S]*\}', re.DOTALL)


def _extract_json(text: str) -> dict:
    """Try to extract and parse a JSON object from LLM response text."""
    text = text.strip()

    # 1. Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown fences
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.I)
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 3. Find the first {...} block in the response
    m = _JSON_OBJECT_RE.search(text)
    if m:
        return json.loads(m.group())

    raise json.JSONDecodeError("No JSON object found in LLM response", text, 0)


def get_llm_insights(text: str, word_count: int) -> dict[str, Any]:
    """
    Call the Groq LLM gateway to get AI-powered document insights.
    Returns a dict with keys: summary, topics, tone, entities, error.
    """
    words = text.split()
    excerpt = " ".join(words[:_INSIGHT_WORD_LIMIT])
    truncated = word_count > _INSIGHT_WORD_LIMIT

    prompt = (
        f"{'[Document is truncated to first 1500 words]' if truncated else ''}"
        f"\n\nDocument text:\n{excerpt}\n\n"
        "Return a JSON object with these exact keys:\n"
        '  "summary"  : string — 2 to 4 sentence summary\n'
        '  "topics"   : array of 3-7 strings — main topics\n'
        '  "tone"     : one of formal | informal | technical | narrative | persuasive | academic\n'
        '  "entities" : array of up to 8 strings — key named entities (people, places, orgs)\n'
    )

    try:
        resp = requests.post(
            f"{_LLM_GATEWAY}/api/ai/llm/generate",
            json={
                "prompt": prompt,
                "system": _SYSTEM_PROMPT,
                "temperature": 0.2,
                "max_output_tokens": 1024,
            },
            timeout=(5, 90),
        )
        resp.raise_for_status()
        result_text = resp.json().get("text", "")
        insights = _extract_json(result_text)
        return {
            "summary": str(insights.get("summary", "")),
            "topics": list(insights.get("topics", [])),
            "tone": str(insights.get("tone", "")),
            "entities": list(insights.get("entities", [])),
            "truncated": truncated,
            "error": None,
        }
    except requests.exceptions.ConnectionError:
        return {"error": "LLM Gateway not running (port 8000)", "summary": "", "topics": [], "tone": "", "entities": [], "truncated": truncated}
    except requests.exceptions.Timeout:
        return {"error": "LLM Gateway timed out (90 s)", "summary": "", "topics": [], "tone": "", "entities": [], "truncated": truncated}
    except json.JSONDecodeError:
        raw = resp.json().get("text", "")[:200] if 'resp' in dir() else ""
        return {"error": f"LLM returned unparseable response: {raw!r}", "summary": "", "topics": [], "tone": "", "entities": [], "truncated": truncated}
    except Exception as exc:
        return {"error": str(exc), "summary": "", "topics": [], "tone": "", "entities": [], "truncated": truncated}


# ── Public execute() ─────────────────────────────────────────────────────────

def execute(params: dict) -> str:
    """
    Execute document analytics.

    Parameters
    ----------
    params : dict
        filePath      — absolute path to the document
        includeLLM    — bool, whether to call the LLM gateway (default True)

    Returns
    -------
    JSON string with keys: success, stats, llm_insights, text_preview, error
    """
    file_path: str = params.get("filePath", "")
    include_llm: bool = params.get("includeLLM", True)

    if not file_path or not os.path.isfile(file_path):
        return json.dumps({"success": False, "error": "File not found or invalid path."})

    try:
        text = extract_text(file_path)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Text extraction failed: {exc}"})

    if not text.strip():
        return json.dumps({"success": False, "error": "No readable text found in the document."})

    stats = compute_stats(text)

    llm_insights: dict[str, Any] = {}
    if include_llm:
        llm_insights = get_llm_insights(text, stats["word_count"])

    # Short preview for the frontend (first 500 chars)
    text_preview = text[:500].strip() + ("…" if len(text) > 500 else "")

    return json.dumps({
        "success": True,
        "stats": stats,
        "llm_insights": llm_insights,
        "text_preview": text_preview,
        "file_path": file_path,
        "file_name": os.path.basename(file_path),
        "file_size": os.path.getsize(file_path),
        "file_ext": Path(file_path).suffix.lower(),
    }, ensure_ascii=False)


# ── Agent DEFINITION ──────────────────────────────────────────────────────────

DEFINITION = {
    "name": "document_analytics",
    "description": (
        "Analyze a document file (PDF, DOCX, TXT, MD, HTML) and return detailed statistics "
        "plus AI-powered insights: word count, reading time, top keywords, Flesch readability, "
        "paragraph and sentence structure, and a Groq LLM summary of the document content."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "filePath": {"type": "string", "description": "Absolute path to the document file."},
            "includeLLM": {
                "type": "boolean",
                "description": "Whether to include LLM-powered insights (summary, topics, tone). Default true.",
            },
        },
        "required": ["filePath"],
    },
    "input_instructions": (
        "filePath: use ask_user(input_type='file') to let the user pick a document. "
        "Accepted formats: .pdf, .docx, .txt, .md, .html, .htm"
    ),
    "output_description": (
        "JSON {success, stats: {word_count, sentence_count, paragraph_count, unique_words, "
        "reading_time_min, estimated_pages, avg_words_per_sentence, avg_word_length, "
        "top_keywords, flesch_reading_ease, flesch_grade}, "
        "llm_insights: {summary, topics, tone, entities}, text_preview}"
    ),
}
