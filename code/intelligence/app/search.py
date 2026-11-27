from .database import connect, public_file
from .retrieval import snapshot, _query
from .config import settings
from .cloud import dense_scores


def snippet(text, query):
    index = text.casefold().find(query.casefold())
    start = max(0, index - 100) if index >= 0 else 0
    return (
        ("…" if start else "")
        + text[start : start + 450]
        + ("…" if len(text) > start + 450 else "")
    )


def search(query, mode, top_k, threshold, extension=""):
    with connect() as db:
        files = {
            r["id"]: dict(r)
            for r in db.execute("SELECT * FROM files")
            if not extension or r["extension"] == extension
        }
    semantic, literal = {}, {}
    provider = {"provider": "local_lexical", "aws_calls": 0, "fallback": False}
    if mode in {"keyword", "hybrid", "filename"}:
        for file_id, record in files.items():
            text = record["name"] if mode == "filename" else record["extracted_text"]
            count = text.casefold().count(query.casefold())
            if count:
                literal[file_id] = {
                    "score": float(count),
                    "snippet": snippet(text, query),
                    "section": "Filename" if mode == "filename" else "Content",
                }
    if mode in {"semantic", "hybrid"}:
        vector = _query(settings.embedding_model, query)
        compatible, matrix = snapshot()
        if compatible:
            scores, provider = dense_scores(compatible, matrix, vector)
            for chunk, score in zip(compatible, scores):
                if chunk["file_id"] not in files:
                    continue
                key = chunk["file_id"]
                if score >= threshold and (key not in semantic or score > semantic[key]["score"]):
                    semantic[key] = {
                        "score": float(score),
                        "snippet": snippet(chunk["text"], query),
                        "section": chunk["section"],
                    }

    def ranked(values):
        return sorted(values, key=lambda k: values[k]["score"], reverse=True)

    if mode == "hybrid":
        fused = {}
        for values in (semantic, literal):
            for rank, key in enumerate(ranked(values), 1):
                fused[key] = fused.get(key, 0) + 1 / (60 + rank)
        keys = sorted(fused, key=fused.get, reverse=True)
    else:
        values = semantic if mode == "semantic" else literal
        keys = ranked(values)
    results = []
    for key in keys[:top_k]:
        match = literal.get(key) or semantic[key]
        results.append(
            {
                "file": public_file(files[key]),
                "snippet": match["snippet"],
                "section": match["section"],
                "score": fused[key] if mode == "hybrid" else match["score"],
                "similarity": semantic.get(key, {}).get("score"),
                "score_kind": "RRF"
                if mode == "hybrid"
                else "cosine similarity"
                if mode == "semantic"
                else "literal occurrences",
            }
        )
    return {
        "results": results,
        "total": len(keys),
        "mode": mode,
        "query": query,
        "retrieval_backend": provider,
    }
