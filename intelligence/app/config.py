from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    aws_region: str = "ap-southeast-2"
    aws_profile: str = "default"
    s3_bucket: str = "cloudvault-d0c2b49b4347"
    s3_object_prefix: str = "cloudvault/files/"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    max_upload_mb: int = 25
    max_extracted_chars: int = 500_000
    max_chunks: int = 3000
    llm_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5:3b"
    llm_timeout: int = 120
    evidence_threshold: float = 0.28
    context_chars: int = 10000
    data_dir: Path = ROOT / "data"

    def model_post_init(self, context):
        if self.llm_url != "http://127.0.0.1:11434":
            raise ValueError("Generation must use the approved loopback runtime")
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
