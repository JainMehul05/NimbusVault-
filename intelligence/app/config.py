from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    aws_region: str = "ap-southeast-2"
    aws_profile: str = "default"
    aws_auth_mode: Literal['profile', 'instance-role'] = 'profile'
    aws_expected_account: str = ''
    aws_min_credit_reserve_usd: float = 1.0
    runtime_mode: Literal['local', 'container'] = 'local'
    s3_bucket: str = ""
    s3_object_prefix: str = "cloudvault/files/"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    max_upload_mb: int = 25
    max_extracted_chars: int = 500_000
    max_chunks: int = 3000
    llm_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5:3b"
    llm_timeout: int = 120
    llm_threads: int = 4
    llm_correction_timeout: int = 30
    evidence_threshold: float = 0.28
    context_chars: int = 10000
    data_dir: Path = ROOT / "data"
    embedding_cache_dir: Path | None = None

    def model_post_init(self, context):
        project = ROOT
        if not self.data_dir.is_absolute():
            self.data_dir = (project / self.data_dir).resolve()
        if self.embedding_cache_dir is None:
            self.embedding_cache_dir = project / '.runtime/standalone-ai/embedding-cache'
        elif not self.embedding_cache_dir.is_absolute():
            self.embedding_cache_dir = (project / self.embedding_cache_dir).resolve()
        if not self.embedding_cache_dir.resolve().is_relative_to(project.resolve()):
            raise ValueError('Embedding cache must be inside the standalone project')
        allowed_llm_urls = {'http://127.0.0.1:11434'}
        if self.runtime_mode == 'container':
            allowed_llm_urls.add('http://ollama:11434')
        if self.llm_url not in allowed_llm_urls:
            raise ValueError("Generation must use the approved loopback runtime")
        if self.aws_min_credit_reserve_usd < 1:
            raise ValueError('Credit reserve cannot be less than USD1')
        if self.aws_auth_mode == 'instance-role' and self.aws_min_credit_reserve_usd < 10:
            raise ValueError('EC2 requires at least a USD10 credit reserve')
        if not 1 <= self.llm_correction_timeout <= 180:
            raise ValueError('Correction timeout must be bounded to 1–180 seconds')
        if self.llm_model != "qwen2.5:3b":
            raise ValueError("Use the validated local qwen2.5:3b model")
        if self.aws_region != "ap-southeast-2":
            raise ValueError("CloudVault is restricted to ap-southeast-2")
        if not self.s3_object_prefix.startswith(
            "cloudvault/"
        ) or not self.s3_object_prefix.endswith("/"):
            raise ValueError("Use a dedicated cloudvault/ object prefix ending in /")
        if not 1 <= self.max_upload_mb <= 100:
            raise ValueError("Maximum upload size must be between 1 and 100 MiB")


settings = Settings()
