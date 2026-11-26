import asyncio
import json
import re
import time
from collections import deque
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool
from .database import connect
from .services import now
from .retrieval import retrieve, terms
from .embeddings import engine
from . import llm

router = APIRouter(prefix="/api/ai", tags=["Document intelligence"])
generation_lock = asyncio.Lock()
cancelled_requests = deque(maxlen=128)


class Cancellation(BaseModel):
    request_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")


@router.post("/cancel")
async def cancel(payload: Cancellation):
    cancelled_requests.append(payload.request_id)
    return {"cancellation_requested": True}


class Ask(BaseModel):
    request_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{36}$")
    question: str = Field(min_length=2, max_length=1500)
    file_ids: list[str] = Field(default_factory=list, max_length=30)
    conversation_id: str | None = None
    extractive: bool = False

    @field_validator("question")
    @classmethod
    def question_valid(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("Enter a question")
        return value.strip()

    @field_validator("file_ids")
    @classmethod
    def ids_valid(cls, value):
        for key in value:
            if len(key) > 64:
                raise ValueError("Invalid file scope")
        return list(dict.fromkeys(value))


def normalize_quote(text):
    return " ".join(text.casefold().split())


def validate_claims(answer, sources):
    available = {s["citation"]: s for s in sources}
    accepted = []
    for claim in answer.claims:
        if not claim.sources or len(claim.sources) != len(claim.quotes):
            continue
        valid = True
        numbers = set(re.findall(r"\d+(?:\.\d+)?", claim.text))
        quoted_numbers = set(re.findall(r"\d+(?:\.\d+)?", " ".join(claim.quotes)))
        if not numbers.issubset(quoted_numbers):
            valid = False
        if re.search(r"\brespectively\b", claim.text, re.I) and not any(
            re.search(r"\brespectively\b", quote, re.I) for quote in claim.quotes
        ):
            valid = False
        for identifier, quote in zip(claim.sources, claim.quotes):
            source = available.get(identifier)
            if (
                not source
                or len(quote.strip()) < 12
                or normalize_quote(quote) not in normalize_quote(source["passage"])
                or not (set(terms(claim.text)) & set(terms(quote)))
            ):
                valid = False
                break
            # Embedding similarity alone can accept plausible outside knowledge.
            # Require most content words to be anchored in the exact quotation.
            # This is deliberately conservative; a rejected paraphrase gets one
            # correction opportunity, then the explicit extractive fallback.
            content = set(terms(claim.text))
            anchored = content & set(terms(quote))
            if content and len(anchored) / len(content) < 0.6:
                valid = False
                break
        # A relevant quotation is required as well as a genuine one. This catches
        # unrelated citations; similarity is still not a proof of entailment.
        if valid:
            try:
                vectors = engine.encode([claim.text, *claim.quotes])
                valid = all(float(vectors[0] @ vector) >= 0.35 for vector in vectors[1:])
            except ValueError:
                valid = False
        if valid and not re.search(r"https?://|<script|\[\d+\]", claim.text, re.I):
            accepted.append(
                {
                    "text": claim.text,
                    "citations": list(dict.fromkeys(claim.sources)),
                    "quotes": claim.quotes,
                }
            )
    return accepted


@router.get("/status")
async def ai_status():
    result = await llm.status()
    result["busy"] = generation_lock.locked()
    return result


def history_context(conversation_id):
    if not conversation_id:
        return None, []
    with connect() as db:
        conversation = db.execute(
            "SELECT * FROM conversations WHERE id=?", (conversation_id,)
        ).fetchone()
        if not conversation:
            raise HTTPException(404, "Conversation not found")
        previous = [
            dict(r)
            for r in db.execute(
                "SELECT question FROM exchanges WHERE conversation_id=? ORDER BY id DESC LIMIT 2",
                (conversation_id,),
            )
        ]
    return dict(conversation), previous


async def wait_for_generation(task, request, request_id):
    while not task.done():
        await asyncio.sleep(0.2)
        if request_id in cancelled_requests or await request.is_disconnected():
            task.cancel()
            raise HTTPException(499, "Answer preparation interrupted")
    return await task


@router.post("/ask")
async def ask(payload: Ask, request: Request):
    if generation_lock.locked():
        raise HTTPException(
            409, "One answer is already being prepared. Wait or stop it before starting another."
        )
    async with generation_lock:
        started = time.perf_counter()
        conversation, previous = history_context(payload.conversation_id)
        scope = payload.file_ids
        if conversation:
            stored = json.loads(conversation["scope"])
            if scope and scope != stored:
                raise HTTPException(409, "Start a new conversation to change document scope")
            scope = stored
        if scope:
            with connect() as db:
                known = {r["id"]: r["status"] for r in db.execute("SELECT id,status FROM files")}
            if any(known.get(key) != "indexed" for key in scope):
                raise HTTPException(400, "Selected documents must exist and be indexed")
        question = payload.question
        # Follow-ups re-retrieve using prior USER questions, never prior generated factual claims.
        retrieval_query = question
        if previous and (
            len(terms(question)) < 3
            or re.search(r"\b(it|its|they|their|that|those)\b", question, re.I)
        ):
            retrieval_query = (
                "Follow-up: "
                + question
                + "\nPrevious user questions: "
                + "\n".join(p["question"] for p in previous)[:1400]
            )
        # The legacy standalone route uses [] for its single-user collection. The private
        # NimbusVault boundary rejects an empty authorized scope before reaching this route.
        sources, coverage = await run_in_threadpool(retrieve, retrieval_query, scope or None)
        if payload.request_id in cancelled_requests:
            raise HTTPException(499, "Answer preparation interrupted")
        retrieval_ms = (time.perf_counter() - started) * 1000
        result = {
            "mode": "insufficient",
            "answer": "The indexed documents do not contain enough relevant evidence to answer this question.",
            "claims": [],
            "sources": sources,
            "coverage": coverage,
            "question": question,
            "retrieval_query": retrieval_query,
            "model": None,
            "warning": None,
            "timings": {"retrieval_ms": round(retrieval_ms, 2)},
        }
        if sources:
            result["mode"] = "extractive"
            result["answer"] = (
                "Relevant source passages are shown below. This is an extractive response, not generated synthesis."
            )
            result["claims"] = [
                {"text": s["passage"], "citations": [s["citation"]], "quotes": [s["passage"]]}
                for s in sources[:4]
            ]
            if not payload.extractive:
                diagnostic = await llm.status()
                if diagnostic["available"]:
                    task = asyncio.create_task(llm.generate(retrieval_query, sources))
                    try:
                        generated, timing = await wait_for_generation(
                            task, request, payload.request_id
                        )
                        claims = await run_in_threadpool(validate_claims, generated, sources)
                        if not generated.insufficient and (
                            not claims or len(claims) != len(generated.claims)
                        ):
                            result["timings"]["initial_generation"] = timing
                            result["timings"]["correction_attempted"] = True
                            correction = (
                                retrieval_query
                                + "\nCitation correction: Produce fewer strictly supported claims. Each claim must cite exactly one supplied source and copy one short exact relevant quote. Do not add numbers absent from that quotation. Answer the original question; abstain if evidence is insufficient."
                            )
                            task = asyncio.create_task(
                                asyncio.wait_for(llm.generate(correction, sources), timeout=30)
                            )
                            generated, timing = await wait_for_generation(
                                task, request, payload.request_id
                            )
                            claims = await run_in_threadpool(validate_claims, generated, sources)
                        if generated.insufficient:
                            result.update(
                                mode="insufficient",
                                answer="The retrieved passages do not provide enough evidence to answer this question.",
                                claims=[],
                            )
                        elif claims:
                            used = {key for claim in claims for key in claim["citations"]}
                            result.update(
                                mode="generated",
                                answer="\n\n".join(
                                    c["text"] + " " + "".join(f"[{n}]" for n in c["citations"])
                                    for c in claims
                                ),
                                claims=claims,
                                sources=[s for s in sources if s["citation"] in used],
                                model=llm.settings.llm_model,
                            )
                            if len(claims) != len(generated.claims):
                                result["warning"] = (
                                    "Only statements that passed source verification are shown; some generated details were omitted."
                                )
                        else:
                            result["warning"] = (
                                "Generated claims did not pass citation/quotation validation. Showing source excerpts instead."
                            )
                        result["timings"]["generation"] = timing
                    except HTTPException:
                        raise
                    except Exception:
                        result["warning"] = (
                            "Local generation failed or timed out. Source excerpts remain available; retry when the runtime is ready."
                        )
                    finally:
                        if not task.done():
                            task.cancel()
                else:
                    result["warning"] = diagnostic["reason"]
        if payload.request_id in cancelled_requests:
            raise HTTPException(499, "Answer preparation interrupted")
        result["timings"]["total_ms"] = round((time.perf_counter() - started) * 1000, 2)
        conversation_id = payload.conversation_id or str(uuid4())
        timestamp = now()
        result["conversation_id"] = conversation_id
        with connect() as db:
            if not conversation:
                db.execute(
                    "INSERT INTO conversations VALUES(?,?,?,?,?)",
                    (conversation_id, question[:80], json.dumps(scope), timestamp, timestamp),
                )
            db.execute(
                "INSERT INTO exchanges(conversation_id,question,answer_json,created_at) VALUES(?,?,?,?)",
                (conversation_id, question, json.dumps(result), timestamp),
            )
            db.execute(
                "UPDATE conversations SET updated_at=? WHERE id=?", (timestamp, conversation_id)
            )
        return result


@router.get("/conversations")
def conversations():
    with connect() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,title,created_at,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50"
            )
        ]


@router.get("/conversations/{conversation_id}")
def conversation_detail(conversation_id: str):
    with connect() as db:
        row = db.execute("SELECT * FROM conversations WHERE id=?", (conversation_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Conversation not found")
        exchanges = [
            {"question": r["question"], "response": json.loads(r["answer_json"])}
            for r in db.execute(
                "SELECT * FROM exchanges WHERE conversation_id=? ORDER BY id", (conversation_id,)
            )
        ]
    return {**dict(row), "file_ids": json.loads(row["scope"]), "exchanges": exchanges}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, confirm: bool = False):
    if not confirm:
        raise HTTPException(400, "Confirm deletion of local conversation history")
    with connect() as db:
        db.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
    return {"deleted": conversation_id}
