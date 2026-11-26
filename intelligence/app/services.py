import logging
import threading
from datetime import datetime, timezone
from .database import connect, get_file
from .extractor import extract
from .embeddings import engine
from .config import settings
from . import storage
from . import cloud

logger = logging.getLogger("cloudvault")
index_lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def index_file(file_id):
    # Serialize CPU inference and deletion/reindex to avoid stale index resurrection.
    with index_lock:
        record = get_file(file_id)
        if not record:
            return
        try:
            with connect() as db:
                db.execute(
                    "UPDATE files SET status='processing', error=NULL WHERE id=?", (file_id,)
                )
            cloud.enqueue(file_id)
            sections = extract(record["original_name"], storage.read(record["object_key"]))
            status = "unsupported" if sections is None else "empty" if not sections else "indexed"
            chunks, vectors = [], []
            if status == "indexed":
                chunks = engine.chunks(sections)
                if not chunks:
                    status = "empty"
                else:
                    vectors = engine.encode([text for _, text in chunks])
            with connect() as db:
                db.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
                for (section, text), vector in zip(chunks, vectors):
                    db.execute(
                        "INSERT INTO chunks(file_id,text,section,vector,model,dimension) VALUES(?,?,?,?,?,?)",
                        (
                            file_id,
                            text,
                            section,
                            vector.tobytes(),
                            settings.embedding_model,
                            len(vector),
                        ),
                    )
                db.execute(
                    "UPDATE files SET status=?, chunk_count=?, extracted_text=?, indexed_at=?, updated_at=? WHERE id=?",
                    (
                        status,
                        len(chunks),
                        "\n\n".join(t for _, t in sections or []),
                        now(),
                        now(),
                        file_id,
                    ),
                )
        except Exception as error:
            logger.warning("Indexing failed: %s", type(error).__name__)
            message = (
                str(error)[:250]
                if isinstance(error, ValueError)
                else "Indexing failed. Check AWS session, document integrity and local model availability, then retry."
            )
            with connect() as db:
                db.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
                db.execute(
                    "UPDATE files SET status='failed', error=?, chunk_count=0 WHERE id=?",
                    (message, file_id),
                )
        try:
            cloud.sync_file(file_id)
        except Exception as error:
            logger.warning("Cloud synchronization pending: %s", type(error).__name__)
