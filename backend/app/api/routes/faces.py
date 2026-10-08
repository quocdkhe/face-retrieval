import logging
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas.face import FaceExtractRequest, FaceExtractResponse, FaceInfo
from app.services.face_service import face_service

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


@router.post("/extract", response_model=FaceExtractResponse)
def extract_faces(payload: FaceExtractRequest) -> FaceExtractResponse:
    _validate_url(payload.image_url)
    image_bytes = _download_image(payload.image_url)
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

    return FaceExtractResponse(
        image_url=payload.image_url,
        image_width=image_width,
        image_height=image_height,
        face_count=len(faces),
        faces=[FaceInfo(**f) for f in faces],
    )
