"""Chunk-level dense + FTS evidence retrieval; original search contracts stay intact."""

from functools import lru_cache
import re
import os
import threading
import numpy as np
from .config import settings
from .database import connect
from .embeddings import engine
from .cloud import dense_scores

STOP = set(
    "a an the is are was were what which who how why when where can could would should does do did to of in on for and or by with from my me please explain describe tell about information documents document files file according uploaded all compare summarize summary".split()
)
_lock = threading.Lock()
_cache = None


def terms(text):
    return [t for t in re.findall(r"[\w-]+", text.casefold()) if len(t) > 1 and t not in STOP]


@lru_cache(maxsize=96)
def _query(model, text):
    return engine.encode([text])[0]


def snapshot():
    global _cache
    with _lock, connect() as db:
        fingerprint = (
            str(settings.data_dir.resolve()),
            settings.embedding_model,
            tuple(
                tuple(r)
                for r in db.execute(
                    "SELECT id,status,indexed_at,chunk_count,name FROM files ORDER BY id"
                )
            ),
        )
        if _cache is None or _cache[0] != fingerprint:
            rows = [
                dict(r)
                for r in db.execute(
                    "SELECT c.*, f.name,f.original_name,f.extension FROM chunks c JOIN files f ON f.id=c.file_id WHERE f.status='indexed' ORDER BY c.id"
                )
            ]
            rows = [
                r for r in rows if r["model"] == settings.embedding_model and r["dimension"] == 384
            ]
            matrix = (
                np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows])
                if rows
                else np.empty((0, 384), dtype=np.float32)
            )
            for row in rows:
                row.pop("vector")
            _cache = (fingerprint, rows, matrix)
        return _cache[1], _cache[2]


def retrieve(question, file_ids=None, limit=7, mode="hybrid"):
    rows, matrix = snapshot()
    # None is the legacy single-user contract; an explicit empty trusted scope denies all.
    if file_ids is not None:
        selected_indices = [i for i, r in enumerate(rows) if r["file_id"] in set(file_ids)]
        matrix = matrix[selected_indices]
        rows = [rows[i] for i in selected_indices]
    if not rows:
        return [], {"indexed_files": 0, "candidate_chunks": 0}
    allowed = set(file_ids or [])
    indices = [i for i, r in enumerate(rows) if not allowed or r["file_id"] in allowed]
    if not indices:
        return [], {"indexed_files": 0, "candidate_chunks": 0}
    # Long questions use a bounded token-aware query, never silent model truncation.
    query_text = question
    if len(engine.load().tokenizer.encode(query_text)) > engine.load().max_seq_length:
        query_text = engine.chunks([("Question", question)])[0][1]
    vector = _query(settings.embedding_model, query_text)
    all_scores, provider = dense_scores(rows, matrix, vector, file_ids)
    intent_eligible = set()
    # A single averaged query can erase one topic of a multi-part question. Preserve
    # each explicit local query clause without lowering the evidence threshold or
    # widening the already-filtered document scope. Never multiply AWS queries.
    if os.environ.get("NIMBUS_LOCAL_RETRIEVAL") == "true":
        parts = [
            part.strip()
            for part in re.split(r"\s+(?:and|versus|vs\.?)[ ]+|;[ ]*", question, flags=re.I)
            if len(terms(part)) >= 2
        ][:3]
        if len(parts) > 1:
            for part in parts:
                if len(engine.load().tokenizer.encode(part)) > engine.load().max_seq_length:
                    part = engine.chunks([("Question", part)])[0][1]
                part_scores = matrix @ _query(settings.embedding_model, part)
                part_floor = max(settings.evidence_threshold, float(part_scores.max()) * 0.70)
                intent_eligible.update(
                    i for i, score in enumerate(part_scores) if float(score) >= part_floor
                )
                if mode != "semantic":
                    part_terms = set(terms(part))
                    for i, row in enumerate(rows):
                        overlap = len(part_terms & set(terms(row["text"])))
                        if (
                            overlap >= 2
                            and overlap / max(1, len(part_terms)) >= 0.5
                            and float(part_scores[i]) >= 0.18
                        ):
                            intent_eligible.add(i)
                all_scores = np.maximum(all_scores, part_scores)
            provider = {**provider, "query_parts": len(parts)}
    scores = all_scores[indices]
    dense = sorted(zip(indices, scores), key=lambda p: float(p[1]), reverse=True)[:40]
    lexical = []
    tokens = list(dict.fromkeys(terms(question)))[:24]
    if tokens and mode != "semantic":
        expression = " OR ".join('"' + t.replace('"', '""') + '"' for t in tokens)
        scoped_files = sorted({r["file_id"] for r in rows})
        placeholders = ",".join("?" for _ in scoped_files)
        with connect() as db:
            lexical = [
                r["rowid"]
                for r in db.execute(
                    f"SELECT rowid FROM chunk_fts WHERE chunk_fts MATCH ? AND rowid IN (SELECT id FROM chunks WHERE file_id IN ({placeholders})) ORDER BY bm25(chunk_fts) LIMIT 60",
                    (expression, *scoped_files),
                )
            ]
    scoped_chunk_ids = {r["id"] for r in rows}
    lexical = [key for key in lexical if key in scoped_chunk_ids][:60]
    lexical_rank = {key: rank for rank, key in enumerate(lexical, 1)}
    # Lexical candidates can rescue exact terminology outside the dense top 40.
    dense_indices = {i for i, _ in dense}
    score_by_index = dict(zip(indices, scores))
    dense.extend(
        (i, score_by_index[i])
        for i in indices
        if i not in dense_indices and rows[i]["id"] in lexical_rank
    )
    ranking = []
    relative_floor = max(settings.evidence_threshold, float(scores.max()) * 0.70)
    for rank, (i, score) in enumerate(dense, 1):
        row = rows[i]
        overlap = len(set(tokens) & set(terms(row["text"])))
        # Lexical matches alone must not manufacture strong evidence from common words.
        if (
            i not in intent_eligible
            and float(score) < relative_floor
            and not (overlap >= 2 and float(score) >= max(0.18, relative_floor - 0.05))
        ):
            continue
        rrf = 1 / (60 + rank) + (
            1 / (60 + lexical_rank[row["id"]]) if row["id"] in lexical_rank else 0
        )
        ranking.append({**row, "similarity": float(score), "rrf": rrf, "lexical_terms": overlap})
    ranking.sort(key=lambda r: r["rrf"], reverse=True)
    selected = []
    per_file = {}
    seen = set()
    budget = 0
    # First pass gives complementary files a place before adjacent chunks of one file.
    for unique_only in (True, False):
        for row in ranking:
            key = row["file_id"]
            normalized = " ".join(row["text"].casefold().split())
            if row["id"] in {r["id"] for r in selected} or normalized in seen:
                continue
            if unique_only and key in per_file:
                continue
            if per_file.get(key, 0) >= 2:
                continue
            if budget + len(row["text"]) > settings.context_chars:
                continue
            selected.append(row)
            seen.add(normalized)
            per_file[key] = per_file.get(key, 0) + 1
            budget += len(row["text"])
            if len(selected) >= limit:
                break
        if len(selected) >= limit:
            break
    sources = [
        {
            "citation": i,
            "file_id": r["file_id"],
            "chunk_id": r["id"],
            "filename": r["name"],
            "original_name": r["original_name"],
            "section": r["section"],
            "passage": r["text"],
            "similarity": r["similarity"],
            "rrf": r["rrf"],
        }
        for i, r in enumerate(selected, 1)
    ]
    return sources, {
        "indexed_files": len({rows[i]["file_id"] for i in indices}),
        "candidate_chunks": len(indices),
        "selected_chunks": len(sources),
        "context_characters": budget,
        "retrieval_backend": provider,
    }
