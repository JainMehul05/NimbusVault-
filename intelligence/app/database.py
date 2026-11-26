from contextlib import contextmanager
import sqlite3
from .config import settings


@contextmanager
def connect():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.data_dir / "cloudvault.db", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY, original_name TEXT NOT NULL, name TEXT NOT NULL,
          object_key TEXT UNIQUE NOT NULL, size INTEGER NOT NULL,
          mime TEXT NOT NULL, extension TEXT NOT NULL, sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          status TEXT NOT NULL, error TEXT, chunk_count INTEGER DEFAULT 0,
          owned INTEGER NOT NULL DEFAULT 1, extracted_text TEXT DEFAULT '', indexed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          text TEXT NOT NULL, section TEXT NOT NULL, vector BLOB NOT NULL,
          model TEXT NOT NULL, dimension INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
        """)
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version < 2:
            # Backup through SQLite before an additive migration, including WAL data.
            backup_dir = settings.data_dir / "backups"
            backup_dir.mkdir(exist_ok=True)
            backup_path = backup_dir / "schema-before-v2.db"
            if not backup_path.exists():
                target = sqlite3.connect(backup_path)
                try:
                    db.backup(target)
                finally:
                    target.close()
            db.execute("BEGIN IMMEDIATE")
            columns = {r["name"] for r in db.execute("PRAGMA table_info(files)")}
            if "starred" not in columns:
                db.execute("ALTER TABLE files ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")
            db.execute(
                "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY,title TEXT NOT NULL,scope TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS exchanges (id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,question TEXT NOT NULL,answer_json TEXT NOT NULL,created_at TEXT NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS exchanges_conversation ON exchanges(conversation_id,id)"
            )
            db.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(text,content='chunks',content_rowid='id',tokenize='unicode61')"
            )
            db.execute(
                "CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunk_fts(rowid,text) VALUES(new.id,new.text); END"
            )
            db.execute(
                "CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN INSERT INTO chunk_fts(chunk_fts,rowid,text) VALUES('delete',old.id,old.text); END"
            )
            db.execute(
                "CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE OF text ON chunks BEGIN INSERT INTO chunk_fts(chunk_fts,rowid,text) VALUES('delete',old.id,old.text); INSERT INTO chunk_fts(rowid,text) VALUES(new.id,new.text); END"
            )
            db.execute("INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')")
            db.execute("PRAGMA user_version=2")
        if version < 3:
            db.commit()
            backup_dir = settings.data_dir / "backups"
            backup_dir.mkdir(exist_ok=True)
            backup_path = backup_dir / "schema-before-v3.db"
            if not backup_path.exists():
                target = sqlite3.connect(backup_path)
                try:
                    db.backup(target)
                finally:
                    target.close()
            db.execute(
                "CREATE TABLE IF NOT EXISTS cloud_outbox(file_id TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL)"
            )
            db.execute("PRAGMA user_version=3")
        db.execute(
            "UPDATE files SET status='failed', error='Indexing interrupted by restart. Retry indexing.' WHERE status IN ('pending','processing')"
        )


def get_file(file_id):
    with connect() as db:
        row = db.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    return dict(row) if row else None


def public_file(row):
    return {k: v for k, v in dict(row).items() if k != "extracted_text"}
