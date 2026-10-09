from pydantic import BaseModel, Field


class FaceExtractRequest(BaseModel):
    # str (không dùng AnyHttpUrl) để tự kiểm soát validation và trả HTTP 400 thay vì 422.
    image_url: str = Field(..., min_length=1, description="URL công khai của ảnh cần trích xuất khuôn mặt")


class FaceInfo(BaseModel):
    face_id: int
    bbox: list[float] = Field(..., min_length=4, max_length=4, description="[x1, y1, x2, y2] theo pixel ảnh gốc")
    det_score: float
    embedding: list[float] = Field(..., description="Face embedding vector, dimension tuỳ theo model")


class FaceExtractResponse(BaseModel):
    image_url: str
    image_width: int
    image_height: int
    face_count: int
    faces: list[FaceInfo]


class FaceIngestItem(BaseModel):
    id: str = Field(..., min_length=1, description="ID ảnh do caller cung cấp (vd: id từ CMS), dùng làm point id trong Qdrant")
    image_url: str = Field(..., min_length=1)


class FaceIngestRequest(BaseModel):
    items: list[FaceIngestItem] = Field(..., min_length=1, description="Danh sách ảnh (id + url) cần trích xuất và lưu")


class FaceIngestItemResult(BaseModel):
    id: str
    image_url: str
    face_count: int
    error: str | None = None


class FaceIngestResponse(BaseModel):
    results: list[FaceIngestItemResult]
    total_faces_added: int


class StoredFaceInfo(BaseModel):
    bbox: list[float] = Field(..., min_length=4, max_length=4, description="[x1, y1, x2, y2] theo pixel ảnh gốc")
    det_score: float


class ImageRecord(BaseModel):
    id: str
    image_url: str
    image_width: int
    image_height: int
    face_count: int
    faces: list[StoredFaceInfo]
    created_at: str


class ImageListResponse(BaseModel):
    items: list[ImageRecord]
    total: int
