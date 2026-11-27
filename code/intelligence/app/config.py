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
    # Generation provider. 'ollama' keeps the private local Qwen runtime (default, unchanged).
    # 'groq' sends ONLY the question and authorized retrieved excerpts to Groq Cloud (Free tier).
    llm_provider: Literal['ollama', 'groq'] = 'ollama'
    ollama_fallback_enabled: bool = True
    groq_model: str = 'openai/gpt-oss-20b'
    groq_api_key_file: Path | None = None
    groq_timeout: int = 30
    groq_max_completion_tokens: int = 900
    groq_reasoning_effort: Literal['low', 'medium', 'high'] = 'low'
    # Application budgets, kept below the verified Free-tier organization limits
    # (gpt-oss: 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD).
    groq_minute_requests: int = 20
    groq_minute_tokens: int = 6000
    groq_daily_requests: int = 400
    groq_daily_tokens: int = 120_000
    groq_user_daily_requests: int = 40
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
        if self.groq_api_key_file is None:
            self.groq_api_key_file = project / '.runtime/secrets/groq-api-key'
        import re as _re
        if not _re.fullmatch(r'[a-z0-9][a-z0-9._/-]{2,80}', self.groq_model):
            raise ValueError('Invalid Groq model identifier')
        if not 5 <= self.groq_timeout <= 60:
            raise ValueError('Groq timeout must be 5-60 seconds')
        if not 200 <= self.groq_max_completion_tokens <= 4000:
            raise ValueError('Groq completion budget must be 200-4000 tokens')
        if not (0 < self.groq_minute_requests < 30 and 0 < self.groq_minute_tokens < 8000
                and 0 < self.groq_daily_requests < 1000 and 0 < self.groq_daily_tokens < 200_000):
            raise ValueError('Groq budgets must stay below the Free-tier limits')
        if self.aws_region != "ap-southeast-2":
            raise ValueError("CloudVault is restricted to ap-southeast-2")
        if not self.s3_object_prefix.startswith(
            "cloudvault/"
        ) or not self.s3_object_prefix.endswith("/"):
            raise ValueError("Use a dedicated cloudvault/ object prefix ending in /")
        if not 1 <= self.max_upload_mb <= 100:
            raise ValueError("Maximum upload size must be between 1 and 100 MiB")


settings = Settings()
