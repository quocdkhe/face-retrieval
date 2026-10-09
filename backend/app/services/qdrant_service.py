import logging
from datetime import UTC, datetime
from uuid import uuid4

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import settings

logger = logging.getLogger(__name__)


class QdrantService:
    """Wraps QdrantClient for the image collection (one point per source image,
    payload holds every face's bbox/det_score). Collection is created lazily on
    first upsert, once the real embedding dimension is known."""

    def __init__(self) -> None:
        self._client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
        self._collection_ready = False

    def ensure_collection(self, vector_size: int) -> None:
        if self._collection_ready:
            return
        if not self._client.collection_exists(settings.QDRANT_COLLECTION_NAME):
            logger.info(
                "Creating Qdrant collection '%s' (vector_size=%d)",
                settings.QDRANT_COLLECTION_NAME,
                vector_size,
            )
            self._client.create_collection(
                collection_name=settings.QDRANT_COLLECTION_NAME,
                vectors_config=qmodels.VectorParams(
                    size=vector_size, distance=qmodels.Distance.COSINE
                ),
            )
        self._collection_ready = True

    def upsert_image(
        self,
        vector: list[float],
        image_url: str,
        image_width: int,
        image_height: int,
        faces: list[dict],
    ) -> str:
        """Store one record per image, with the bbox/det_score of every face found in it.
        `vector` is the embedding of one representative face (needed because Qdrant
        points require a vector), used only for storage today - no search yet."""
        image_id = str(uuid4())
        payload = {
            "image_url": image_url,
            "image_width": image_width,
            "image_height": image_height,
            "face_count": len(faces),
            "faces": [{"bbox": f["bbox"], "det_score": f["det_score"]} for f in faces],
            "created_at": datetime.now(UTC).isoformat(),
        }
        self._client.upsert(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            points=[qmodels.PointStruct(id=image_id, vector=vector, payload=payload)],
        )
        return image_id

    def list_images(self, limit: int, offset: int) -> tuple[list[dict], int]:
        if not self._client.collection_exists(settings.QDRANT_COLLECTION_NAME):
            return [], 0

        points: list[qmodels.Record] = []
        next_offset = None
        while True:
            batch, next_offset = self._client.scroll(
                collection_name=settings.QDRANT_COLLECTION_NAME,
                limit=256,
                offset=next_offset,
                with_payload=True,
                with_vectors=False,
            )
            points.extend(batch)
            if next_offset is None:
                break

        points.sort(key=lambda p: p.payload.get("created_at", ""), reverse=True)
        total = len(points)
        page = points[offset : offset + limit]

        items = [{"id": str(p.id), **p.payload} for p in page]
        return items, total

    def delete_image(self, image_id: str) -> bool:
        if not self._client.collection_exists(settings.QDRANT_COLLECTION_NAME):
            return False
        existing = self._client.retrieve(
            collection_name=settings.QDRANT_COLLECTION_NAME, ids=[image_id]
        )
        if not existing:
            return False
        self._client.delete(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            points_selector=qmodels.PointIdsList(points=[image_id]),
        )
        return True


qdrant_service = QdrantService()
