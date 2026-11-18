---
domains: [ai]
topics: [ai/rag]
---

# Chunking notes

- Small chunks find the passage, big chunks answer the question: search on ~1,000-character chunks and hand
  the model their parent section instead.
- Overlap (10–15 %) keeps a sentence that straddles a boundary findable from both sides.
- Split on headings first, then paragraphs, then sentences; never in the middle of a code block or table row.
- Prefix each chunk with a one-sentence context of where it sits in the document before embedding; it helps
  most for chunks that only make sense next to their heading.
¡
