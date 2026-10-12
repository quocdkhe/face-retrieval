import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import settings

logger = logging.getLogger(__name__)

# Vector của collection `images` không dùng để search (xem MILESTONE_3.md) - mỗi
# point chỉ cần 1 vector hợp lệ về mặt kỹ thuật, dùng 1 chiều cho nhẹ.
_IMAGES_DUMMY_VECTOR_SIZE = 1


def _to_point_id(image_id: str) -> int | str:
    """Qdrant point id chỉ nhận unsigned int hoặc UUID string. `image_id` do caller
    cung cấp (id từ CMS, hoặc UUID tự sinh ở FE) nên phải ép về 1 trong 2 dạng này."""
    if image_id.isdigit():
        return int(image_id)
    try:
        UUID(image_id)
    except ValueError as exc:
        raise ValueError(
            f"id '{image_id}' không hợp lệ cho Qdrant, cần là số hoặc UUID"
        ) from exc
    return image_id


class QdrantService:
    """Wraps QdrantClient cho 2 collection quan hệ 1-nhiều (xem MILESTONE_3.md):
    - `images`: 1 point / ảnh, vector giả (không search), payload là metadata ảnh.
    - `faces`: 1 point / khuôn mặt, vector là embedding thật để search theo sau,
      payload có `image_id` (khoá ngoại) + bbox/det_score.
    Cả 2 collection được tạo lazy ở lần ingest đầu tiên, dimension của `faces`
    lấy từ model (`face_service.embedding_dim`), không phụ thuộc ảnh nào.
    """

    def __init__(self) -> None:
        self._client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
        self._collections_ready = False

    def ensure_collections(self, face_vector_size: int) -> None:
        if self._collections_ready:
            return

        if not self._client.collection_exists(settings.QDRANT_IMAGES_COLLECTION_NAME):
            logger.info("Creating Qdrant collection '%s'", settings.QDRANT_IMAGES_COLLECTION_NAME)
            self._client.create_collection(
                collection_name=settings.QDRANT_IMAGES_COLLECTION_NAME,
                vectors_config=qmodels.VectorParams(
                    size=_IMAGES_DUMMY_VECTOR_SIZE, distance=qmodels.Distance.COSINE
                ),
            )

        if not self._client.collection_exists(settings.QDRANT_FACES_COLLECTION_NAME):
            logger.info(
                "Creating Qdrant collection '%s' (vector_size=%d)",
                settings.QDRANT_FACES_COLLECTION_NAME,
                face_vector_size,
            )
            self._client.create_collection(
                collection_name=settings.QDRANT_FACES_COLLECTION_NAME,
                vectors_config=qmodels.VectorParams(
                    size=face_vector_size, distance=qmodels.Distance.COSINE
                ),
            )
            self._client.create_payload_index(
                collection_name=settings.QDRANT_FACES_COLLECTION_NAME,
                field_name="image_id",
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )

        self._collections_ready = True

    def upsert_image(
        self,
        image_id: str,
        image_url: str,
        image_width: int,
        image_height: int,
        faces: list[dict],
    ) -> str:
        """Lưu 1 ảnh theo `image_id` do caller cung cấp (vd: id từ CMS) - không tự
        sinh id nữa, để sync lại nhiều lần với cùng id không tạo record trùng.
        Ghi 1 point ở `images` (metadata, upsert = overwrite) + 1 point/khuôn mặt ở
        `faces` (vector embedding thật + bbox/det_score, kèm image_id để join
        app-side). Face points của lần sync trước (nếu có) bị xoá trước khi ghi lại,
        vì point id của chúng là ngẫu nhiên nên không thể "overwrite" theo image_id."""
        point_id = _to_point_id(image_id)

        self._delete_faces_by_image_id(image_id)

        image_payload = {
            "image_url": image_url,
            "image_width": image_width,
            "image_height": image_height,
            "face_count": len(faces),
            "created_at": datetime.now(UTC).isoformat(),
        }
        self._client.upsert(
            collection_name=settings.QDRANT_IMAGES_COLLECTION_NAME,
            points=[
                qmodels.PointStruct(
                    id=point_id, vector=[0.0] * _IMAGES_DUMMY_VECTOR_SIZE, payload=image_payload
                )
            ],
        )

        if faces:
            face_points = [
                qmodels.PointStruct(
                    id=str(uuid4()),
                    vector=face["embedding"],
                    payload={
                        "image_id": image_id,
                        "bbox": face["bbox"],
                        "det_score": face["det_score"],
                    },
                )
                for face in faces
            ]
            self._client.upsert(
                collection_name=settings.QDRANT_FACES_COLLECTION_NAME, points=face_points
            )

        return image_id

    def _delete_faces_by_image_id(self, image_id: str) -> None:
        if not self._client.collection_exists(settings.QDRANT_FACES_COLLECTION_NAME):
            return
        self._client.delete(
            collection_name=settings.QDRANT_FACES_COLLECTION_NAME,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[qmodels.FieldCondition(key="image_id", match=qmodels.MatchValue(value=image_id))]
                )
            ),
        )

    def _list_faces_by_image_ids(self, image_ids: list[str]) -> dict[str, list[dict]]:
        if not image_ids or not self._client.collection_exists(settings.QDRANT_FACES_COLLECTION_NAME):
            return {}

        faces_by_image: dict[str, list[dict]] = {image_id: [] for image_id in image_ids}
        next_offset = None
        while True:
            batch, next_offset = self._client.scroll(
                collection_name=settings.QDRANT_FACES_COLLECTION_NAME,
                scroll_filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="image_id", match=qmodels.MatchAny(any=image_ids)
                        )
                    ]
                ),
                limit=256,
                offset=next_offset,
                with_payload=True,
                with_vectors=False,
            )
            for point in batch:
                faces_by_image[point.payload["image_id"]].append(
                    {
                        "face_id": str(point.id),
                        "bbox": point.payload["bbox"],
                        "det_score": point.payload["det_score"],
                    }
                )
            if next_offset is None:
                break

        return faces_by_image

    def list_images(self, limit: int, offset: int) -> tuple[list[dict], int]:
        if not self._client.collection_exists(settings.QDRANT_IMAGES_COLLECTION_NAME):
            return [], 0

        points: list[qmodels.Record] = []
        next_offset = None
        while True:
            batch, next_offset = self._client.scroll(
                collection_name=settings.QDRANT_IMAGES_COLLECTION_NAME,
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

        faces_by_image = self._list_faces_by_image_ids([str(p.id) for p in page])
        items = [
            {"id": str(p.id), **p.payload, "faces": faces_by_image.get(str(p.id), [])}
            for p in page
        ]
        return items, total

    def delete_image(self, image_id: str) -> bool:
        if not self._client.collection_exists(settings.QDRANT_IMAGES_COLLECTION_NAME):
            return False
        point_id = _to_point_id(image_id)
        existing = self._client.retrieve(
            collection_name=settings.QDRANT_IMAGES_COLLECTION_NAME, ids=[point_id]
        )
        if not existing:
            return False

        self._client.delete(
            collection_name=settings.QDRANT_IMAGES_COLLECTION_NAME,
            points_selector=qmodels.PointIdsList(points=[point_id]),
        )
        self._delete_faces_by_image_id(image_id)
        return True

    def search_similar_faces(
        self, face_id: str, top_k: int, min_score: float
    ) -> dict | None:
        """Tìm các ảnh (khác ảnh nguồn) chứa khuôn mặt giống `face_id`.

        Search trên `faces` bằng vector của chính face đó, group theo `image_id` để
        mỗi ảnh chỉ xuất hiện 1 lần (với face khớp nhất), rồi "join" app-side với
        `images` + toàn bộ faces của ảnh để FE vẽ bbox. Ảnh nguồn bị loại bằng
        filter vì face nguồn luôn tự khớp score 1.0.

        Trả `None` nếu `face_id` không tồn tại.
        """
        faces_collection = settings.QDRANT_FACES_COLLECTION_NAME
        images_collection = settings.QDRANT_IMAGES_COLLECTION_NAME
        if not self._client.collection_exists(faces_collection):
            return None
        try:
            UUID(face_id)
        except ValueError:
            return None

        source = self._client.retrieve(
            collection_name=faces_collection, ids=[face_id], with_vectors=True
        )
        if not source:
            return None
        source_image_id = source[0].payload["image_id"]
        query_face = {
            "face_id": face_id,
            "image_id": source_image_id,
            "bbox": source[0].payload["bbox"],
            "det_score": source[0].payload["det_score"],
        }

        result = self._client.query_points_groups(
            collection_name=faces_collection,
            query=source[0].vector,
            group_by="image_id",
            group_size=1,
            limit=top_k,
            score_threshold=min_score,
            query_filter=qmodels.Filter(
                must_not=[
                    qmodels.FieldCondition(
                        key="image_id", match=qmodels.MatchValue(value=source_image_id)
                    )
                ]
            ),
            with_payload=True,
            with_vectors=False,
        )
        # Qdrant đã sort group theo score của hit tốt nhất, giảm dần.
        hits = [(str(g.id), g.hits[0]) for g in result.groups if g.hits]
        if not hits:
            return {"query_face": query_face, "items": []}

        image_ids = [image_id for image_id, _ in hits]
        image_points = self._client.retrieve(
            collection_name=images_collection,
            ids=[_to_point_id(image_id) for image_id in image_ids],
            with_payload=True,
        )
        images_by_id = {str(p.id): p for p in image_points}
        faces_by_image = self._list_faces_by_image_ids(image_ids)

        items = []
        for image_id, hit in hits:
            image_point = images_by_id.get(image_id)
            if image_point is None:  # face mồ côi (image đã bị xoá) - bỏ qua
                continue
            items.append(
                {
                    "score": hit.score,
                    "matched_face_id": str(hit.id),
                    "image": {
                        "id": image_id,
                        **image_point.payload,
                        "faces": faces_by_image.get(image_id, []),
                    },
                }
            )
        return {"query_face": query_face, "items": items}


qdrant_service = QdrantService()
