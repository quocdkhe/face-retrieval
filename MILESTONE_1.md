# Milestone 1 — Face Detection & Embedding Extraction

Mục tiêu: từ một URL ảnh, tải ảnh về, phát hiện khuôn mặt và sinh embedding cho từng khuôn mặt — làm nền cho việc index vào Qdrant và tìm kiếm tương đồng ở milestone sau.

```
image_url → download → decode → InsightFace (detect + embedding) → JSON
```

## Backend

### Model

- [InsightFace](https://github.com/deepinsight/insightface) `FaceAnalysis`, pretrained package **buffalo_l** (detector SCRFD + recognizer ArcFace).
- Embedding **512 chiều** — dimension lấy đúng theo model thực tế lúc runtime, không hard-code.
- Model **tự động download** lần đầu chạy, lưu ở `~/.insightface/models/buffalo_l` (~280MB, không commit vào repo).
- Chạy CPU qua `onnxruntime` CPUExecutionProvider, không cần GPU/CUDA.
- Model được load **một lần duy nhất** lúc FastAPI startup (`lifespan` trong `backend/app/main.py` gọi `face_service.load_model()`), không load lại mỗi request.

### Files

| File | Vai trò |
|---|---|
| `backend/app/services/face_service.py` | `FaceService` wrap `insightface.app.FaceAnalysis`, load model 1 lần (thread-safe), `extract_faces()` trả bbox/det_score/embedding dạng Python-native |
| `backend/app/schemas/face.py` | `FaceExtractRequest`, `FaceInfo`, `FaceExtractResponse` |
| `backend/app/api/routes/faces.py` | Route `/faces/extract`: validate URL → download (httpx) → kiểm tra status/content-type/size → decode OpenCV → gọi `FaceService` → build response |
| `backend/app/core/config.py` | `FACE_MODEL_NAME`, `FACE_DET_SIZE`, `FACE_PROVIDERS`, `IMAGE_DOWNLOAD_TIMEOUT_SECONDS`, `IMAGE_MAX_BYTES` |
| `backend/app/main.py` | `lifespan` load model lúc startup |

### Endpoint

`POST /api/v1/faces/extract`

Request:

```json
{ "image_url": "https://example.com/image.jpg" }
```

Response thành công (`face_count` có thể bằng 0 nếu không có khuôn mặt — không coi là lỗi):

```json
{
  "image_url": "https://example.com/image.jpg",
  "image_width": 290,
  "image_height": 340,
  "face_count": 1,
  "faces": [
    {
      "face_id": 0,
      "bbox": [94.02, 112.27, 194.73, 230.35],
      "det_score": 0.84,
      "embedding": [0.0123, -0.0456, "... 512 số thực"]
    }
  ]
}
```

- `bbox`: `[x1, y1, x2, y2]` theo pixel của ảnh gốc (không phải ảnh đã resize).
- `image_width`/`image_height`: kích thước ảnh gốc, dùng để FE quy đổi `bbox` sang % khi vẽ khung lên ảnh preview.

### Error handling

| Trường hợp | HTTP status |
|---|---|
| `image_url` không đúng format http/https | 400 |
| Download timeout / không kết nối được / DNS lỗi | 400 |
| HTTP status trả về không phải 2xx | 400 |
| `Content-Type` không phải `image/*` | 400 |
| Ảnh vượt `IMAGE_MAX_BYTES` (mặc định 15MB) | 400 |
| Không decode được ảnh (file hỏng/không phải ảnh) | 400 |
| Không tìm thấy khuôn mặt | 200, `face_count: 0`, `faces: []` |
| Lỗi model không mong muốn | 500 |

### Gọi thử bằng curl

```bash
curl -X POST http://127.0.0.1:8000/api/v1/faces/extract \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/path/to/photo.jpg"}'
```

### Test

```bash
cd backend
.venv/bin/pytest tests/ -v
```

`backend/tests/test_faces.py` mock bước HTTP download (`httpx.get`) để test không phụ thuộc network, nhưng dùng InsightFace **thật** (không mock model) để detect/embedding trên ảnh fixture ở `backend/tests/fixtures/` (ảnh mẫu nhỏ, lấy từ asset có sẵn trong package `insightface`). Cover: ảnh có 1 mặt, ảnh nhiều mặt, ảnh không có mặt, URL không hợp lệ, download lỗi, HTTP status lỗi, ảnh hỏng.

## Frontend

UI đơn giản 1 trang: ô input URL ảnh + nút trích xuất, phía dưới preview ảnh với khung bbox khoanh từng khuôn mặt, hover vào khung hiện `det_score`.

| File | Vai trò |
|---|---|
| `frontend/src/types/face.ts` | Types khớp `FaceExtractRequest`/`FaceExtractResponse` của backend |
| `frontend/src/api/faces.ts` | `facesApi.extract()` gọi `POST /faces/extract` |
| `frontend/src/hooks/useFaces.ts` | `useExtractFaces()` — `useMutation` wrapper (TanStack Query) |
| `frontend/src/pages/FaceExtractPage.tsx` | antd `Input.Search` nhận URL ảnh + nút "Trích xuất"; preview ảnh gốc, vẽ khung bbox cho từng khuôn mặt (tính theo % dựa trên `image_width`/`image_height` nên không cần đo kích thước ảnh render thực tế), hover vào khung hiện `det_score` qua antd `Tooltip` |

## Chạy thử end-to-end

```bash
# Terminal 1 — backend
cd backend
uv pip install -r requirements.txt   # lần đầu
.venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install                          # lần đầu
npm run dev                          # http://localhost:5173
```

Mở `http://localhost:5173`, dán URL ảnh công khai (http/https) vào ô input, bấm "Trích xuất" để xem kết quả.
