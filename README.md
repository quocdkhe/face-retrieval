# Face Retrieval

Monorepo: FastAPI backend + React/Vite/TypeScript frontend (Ant Design, TanStack Query, Axios).

```
backend/    FastAPI app
frontend/   Vite + React 19 + TS + antd + TanStack Query
```

## Versions đã cài

| | version |
|---|---|
| FastAPI | 0.142.4 |
| Pydantic | 2.13.5 |
| React | 19.2 |
| Vite | 8.3 |
| TypeScript | 6.0 |
| Ant Design | 6.6 |
| TanStack Query | 5.104 |
| Axios | 1.20 |

## Chạy backend

`uv` được dùng để tạo venv (Python hệ thống không có `pip`/`ensurepip`).

```bash
cd backend
uv venv --python 3.14 .venv
uv pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

- API: http://127.0.0.1:8000/api/v1
- Swagger: http://127.0.0.1:8000/docs

## Chạy frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

Vite proxy `/api` → `http://127.0.0.1:8000`, nên frontend gọi thẳng `/api/v1/...` mà không cần CORS khi dev.

Scripts khác: `npm run build` (tsc -b + vite build), `npm run preview`, `npm run lint`.

## API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/faces/extract` | Trích xuất khuôn mặt (bbox + embedding) từ URL ảnh — xem chi tiết dưới |

## Face Retrieval — Milestone 1: trích xuất khuôn mặt từ URL

Pipeline: `image_url → download → decode → InsightFace (detect + embedding) → JSON`.

- Model: [InsightFace](https://github.com/deepinsight/insightface) `FaceAnalysis`, pretrained package **buffalo_l** (detector SCRFD + recognizer ArcFace, embedding 512 chiều — dimension trả về đúng theo model thực tế, không hard-code).
- Model **tự động download** lần đầu chạy, lưu ở `~/.insightface/models/buffalo_l` (không commit vào repo, không cần GPU — chạy CPU qua `onnxruntime` CPUExecutionProvider).
- Model được load **một lần duy nhất** lúc FastAPI startup (`lifespan` trong `app/main.py` gọi `face_service.load_model()`), không load lại mỗi request. Xem `backend/app/services/face_service.py`.

### Endpoint

`POST /api/v1/faces/extract`

Request:

```json
{ "image_url": "https://example.com/image.jpg" }
```

Response (thành công, `face_count` có thể bằng 0 nếu không có khuôn mặt):

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

Error handling:

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

Cấu hình liên quan (`backend/app/core/config.py`): `FACE_MODEL_NAME`, `FACE_DET_SIZE`, `FACE_PROVIDERS`, `IMAGE_DOWNLOAD_TIMEOUT_SECONDS`, `IMAGE_MAX_BYTES`.

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

`backend/tests/test_faces.py` mock bước HTTP download (`httpx.get`) để test không phụ thuộc network, nhưng dùng InsightFace thật (không mock model) để detect/embedding trên ảnh fixture ở `backend/tests/fixtures/` (ảnh mẫu nhỏ, lấy từ asset có sẵn trong package `insightface`). Cover: ảnh có 1 mặt, ảnh nhiều mặt, ảnh không có mặt, URL không hợp lệ, download lỗi, HTTP status lỗi, ảnh hỏng.

## Frontend layers

| File | Vai trò |
|---|---|
| `src/lib/axios.ts` | Axios instance, interceptor token + chuẩn hoá lỗi FastAPI (`detail`) |
| `src/types/face.ts` | Types khớp `FaceExtractRequest`/`FaceExtractResponse` của backend |
| `src/api/faces.ts` | `facesApi.extract()` gọi `POST /faces/extract` |
| `src/hooks/useFaces.ts` | `useExtractFaces()` — `useMutation` wrapper |
| `src/pages/FaceExtractPage.tsx` | Input URL ảnh + nút Trích xuất (antd `Input.Search`); preview ảnh gốc, khoanh vùng từng khuôn mặt bằng `bbox` (tính % theo `image_width`/`image_height` nên không cần đo kích thước ảnh render), hover vào khung hiện `det_score` (antd `Tooltip`) |
| `src/main.tsx` | QueryClientProvider, ConfigProvider (locale vi_VN, theme token), antd `App`, Devtools |

Alias `@/*` → `src/*` (cấu hình ở cả `vite.config.ts` và `tsconfig.app.json`).

## Env

`frontend/.env.development`:

```
VITE_API_BASE_URL=/api/v1
```

Trỏ thẳng backend (không qua proxy) thì đổi thành URL tuyệt đối, ví dụ `http://127.0.0.1:8000/api/v1`.
