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
    only_with_faces: bool = Field(
        default=False,
        description="True: ảnh không có khuôn mặt bị bỏ qua (không lưu, trả `skipped=true`). "
        "False (mặc định): vẫn lưu ảnh face_count=0 để biết ảnh đã được xử lý.",
    )


class FaceIngestItemResult(BaseModel):
    id: str
    image_url: str
    face_count: int
    error: str | None = None
    skipped: bool = Field(default=False, description="Ảnh không có khuôn mặt và bị bỏ qua do only_with_faces")


class FaceIngestResponse(BaseModel):
    results: list[FaceIngestItemResult]
    total_faces_added: int


class StoredFaceInfo(BaseModel):
    face_id: str = Field(..., description="Point id của khuôn mặt trong collection faces")
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


class QueryFaceInfo(BaseModel):
    face_id: str
    image_id: str
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    det_score: float


class FaceSearchItem(BaseModel):
    score: float = Field(..., description="Cosine similarity giữa khuôn mặt query và khuôn mặt khớp nhất trong ảnh")
    matched_face_id: str
    image: ImageRecord


class FaceSearchResponse(BaseModel):
    query_face: QueryFaceInfo
    items: list[FaceSearchItem]
    total: int
