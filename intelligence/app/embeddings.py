import threading
import numpy as np
from .config import settings


class Embeddings:
    def __init__(self):
        self.model = None
        self.lock = threading.RLock()
        self.error = None

    def load(self):
        with self.lock:
            if self.model is None:
                try:
                    import torch
                    from sentence_transformers import SentenceTransformer

                    torch.set_num_threads(2)
                    cache = settings.data_dir / "models"
                    cached_model = (
                        cache
                        / ("models--" + settings.embedding_model.replace("/", "--"))
                        / "snapshots"
                    )
                    self.model = SentenceTransformer(
                        settings.embedding_model,
                        device="cpu",
                        cache_folder=str(settings.data_dir / "models"),
                        trust_remote_code=False,
                        local_files_only=cached_model.exists() and any(cached_model.iterdir()),
                    )
                    self.error = None
                except Exception:
                    self.error = "Local embedding model unavailable. Run setup with internet access and retry."
                    raise
            return self.model

    def encode(self, texts):
        with self.lock:
            model = self.load()
            limit = model.max_seq_length
            if any(len(model.tokenizer.encode(t, add_special_tokens=True)) > limit for t in texts):
                raise ValueError(f"Text exceeds model token limit ({limit}); shorten your query")
            return np.asarray(
                model.encode(
                    texts, normalize_embeddings=True, show_progress_bar=False, batch_size=16
                ),
                dtype=np.float32,
            )

    def chunks(self, sections):
        model = self.load()
        tokenizer = model.tokenizer
        limit = min(220, model.max_seq_length - 2)
        chunks = []
        for section, text in sections:
            # Fast tokenizer offsets retain the original text instead of decoding wordpieces.
            offsets = tokenizer(
                text,
                add_special_tokens=False,
                return_offsets_mapping=True,
                truncation=False,
                verbose=False,
            )["offset_mapping"]
            for start in range(0, len(offsets), limit - 32):
                end = min(start + limit, len(offsets))
                snippet = text[offsets[start][0] : offsets[end - 1][1]]
                # Tokenization at a new chunk boundary can change token count.
                while len(tokenizer.encode(snippet)) > model.max_seq_length and end > start + 1:
                    end -= 1
                    snippet = text[offsets[start][0] : offsets[end - 1][1]]
                chunks.append((section, snippet))
                if len(chunks) > settings.max_chunks:
                    raise ValueError("Document exceeds chunk limit")
                if end == len(offsets):
                    break
        return chunks


engine = Embeddings()
