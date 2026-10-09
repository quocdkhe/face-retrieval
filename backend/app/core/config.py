from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "Face Retrieval API"
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Face detection/embedding (InsightFace)
    FACE_MODEL_NAME: str = "buffalo_l"
    FACE_DET_SIZE: list[int] = [640, 640]
    FACE_PROVIDERS: list[str] = ["CPUExecutionProvider"]

    # Image download (POST /faces/extract)
    IMAGE_DOWNLOAD_TIMEOUT_SECONDS: float = 10.0
    IMAGE_MAX_BYTES: int = 15 * 1024 * 1024

    # Qdrant (vector DB for face embedding index/search)
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    # 2 collection quan hệ 1-nhiều: images (1 point/ảnh, không search) và faces
    # (1 point/khuôn mặt, vector thật dùng để search) — xem MILESTONE_3.md
    QDRANT_IMAGES_COLLECTION_NAME: str = "images"
    QDRANT_FACES_COLLECTION_NAME: str = "faces"


settings = Settings()
