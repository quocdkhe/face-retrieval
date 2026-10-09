import logging
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas.face import (
    FaceExtractRequest,
    FaceExtractResponse,
    FaceIngestItemResult,
    FaceIngestRequest,
    FaceIngestResponse,
    FaceInfo,
    ImageListResponse,
    ImageRecord,
)
from app.services.face_service import face_service
from app.services.qdrant_service import qdrant_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/faces", tags=["faces"])

_ALLOWED_SCHEMES = {"http", "https"}


def _validate_url(image_url: str) -> None:
    parsed = urlparse(image_url)
    if parsed.scheme not in _ALLOWED_SCHEMES or not parsed.netloc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="image_url không hợp lệ, cần là URL http/https",
        )


def _download_image(image_url: str) -> bytes:
    try:
        response = httpx.get(
            image_url,
            timeout=settings.IMAGE_DOWNLOAD_TIMEOUT_SECONDS,
            follow_redirects=True,
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Timeout khi tải ảnh từ image_url"
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Không thể tải ảnh từ image_url: {exc}",
        ) from exc

    if not response.is_success:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Tải ảnh thất bại, HTTP status {response.status_code}",
        )

    content_type = response.headers.get("content-type", "")
    if content_type and not content_type.lower().startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Content-Type không hợp lệ, cần là image/*: {content_type}",
        )

    if len(response.content) > settings.IMAGE_MAX_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ảnh vượt quá kích thước tối đa cho phép",
        )

    return response.content


def _decode_image(image_bytes: bytes) -> np.ndarray:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Không thể decode ảnh, file không hợp lệ hoặc không được hỗ trợ",
        )
    return image


def _extract_faces_from_url(image_url: str) -> tuple[list[dict], int, int]:
    """Download → decode → detect/embed. Raises HTTPException on any failure."""
    _validate_url(image_url)
    image_bytes = _download_image(image_url)
    image = _decode_image(image_bytes)

    try:
        faces = face_service.extract_faces(image)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Lỗi không mong muốn khi trích xuất khuôn mặt")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Lỗi nội bộ khi xử lý ảnh",
        ) from exc

    image_height, image_width = image.shape[:2]
    return faces, image_width, image_height


@router.post("/extract", response_model=FaceExtractResponse)
def extract_faces(payload: FaceExtractRequest) -> FaceExtractResponse:
    faces, image_width, image_height = _extract_faces_from_url(payload.image_url)

    return FaceExtractResponse(
        image_url=payload.image_url,
        image_width=image_width,
        image_height=image_height,
        face_count=len(faces),
        faces=[FaceInfo(**f) for f in faces],
    )


@router.post("/ingest", response_model=FaceIngestResponse)
def ingest_faces(payload: FaceIngestRequest) -> FaceIngestResponse:
    results: list[FaceIngestItemResult] = []
    total_faces_added = 0

    for image_url in payload.image_urls:
        try:
            faces, image_width, image_height = _extract_faces_from_url(image_url)
        except HTTPException as exc:
            results.append(FaceIngestItemResult(image_url=image_url, face_count=0, error=exc.detail))
            continue

        if faces:
            # Qdrant point cần đúng 1 vector; dùng embedding của mặt đầu tiên làm đại
            # diện lưu trữ (chưa phục vụ search ở milestone này).
            qdrant_service.ensure_collection(len(faces[0]["embedding"]))
            qdrant_service.upsert_image(
                vector=faces[0]["embedding"],
                image_url=image_url,
                image_width=image_width,
                image_height=image_height,
                faces=faces,
            )

        results.append(FaceIngestItemResult(image_url=image_url, face_count=len(faces)))
        total_faces_added += len(faces)

    return FaceIngestResponse(results=results, total_faces_added=total_faces_added)


@router.get("", response_model=ImageListResponse)
def list_images(limit: int = 20, offset: int = 0) -> ImageListResponse:
    items, total = qdrant_service.list_images(limit=limit, offset=offset)
    return ImageListResponse(items=[ImageRecord(**item) for item in items], total=total)


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(image_id: str) -> None:
    deleted = qdrant_service.delete_image(image_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Không tìm thấy ảnh")
