import logging
import threading

import numpy as np
from insightface.app import FaceAnalysis

from app.core.config import settings

logger = logging.getLogger(__name__)


class FaceService:
    """Wraps InsightFace FaceAnalysis. Model is loaded once and reused across requests."""

    def __init__(self) -> None:
        self._app: FaceAnalysis | None = None
        self._lock = threading.Lock()

    def load_model(self) -> None:
        if self._app is not None:
            return
        with self._lock:
            if self._app is not None:
                return
            logger.info(
                "Loading InsightFace model '%s' (providers=%s)...",
                settings.FACE_MODEL_NAME,
                settings.FACE_PROVIDERS,
            )
            app = FaceAnalysis(name=settings.FACE_MODEL_NAME, providers=settings.FACE_PROVIDERS)
            app.prepare(ctx_id=0, det_size=tuple(settings.FACE_DET_SIZE))
            self._app = app
            logger.info("InsightFace model loaded.")

    @property
    def embedding_dim(self) -> int:
        """Số chiều embedding do model recognition khai báo - không phụ thuộc ảnh nào."""
        self.load_model()
        assert self._app is not None
        dim = self._app.models["recognition"].output_shape[1]
        if not isinstance(dim, int):
            raise RuntimeError(f"Không xác định được embedding dimension của model: {dim!r}")
        return dim

    def extract_faces(self, image: np.ndarray) -> list[dict]:
        """Detect faces in a BGR OpenCV image and return bbox/score/embedding per face."""
        self.load_model()
        assert self._app is not None

        faces = self._app.get(image)
        results = []
        for idx, face in enumerate(faces):
            embedding = face.normed_embedding if face.normed_embedding is not None else face.embedding
            results.append(
                {
                    "face_id": idx,
                    "bbox": [round(float(c), 2) for c in face.bbox],
                    "det_score": float(face.det_score),
                    "embedding": [float(x) for x in embedding],
                }
            )
        return results


face_service = FaceService()
