# Milestone 2 — Face Database (Qdrant)

Mục tiêu: lưu lại kết quả trích xuất khuôn mặt (Milestone 1) vào Qdrant, và có UI để xem/thêm/xoá — nền cho tìm kiếm tương đồng ở milestone sau.

```
image_url(s) → extract (Milestone 1) → lưu theo ẢNH vào Qdrant → UI xem/thêm/xoá
```

Đơn vị lưu trữ là **ảnh**, không phải từng khuôn mặt: mỗi ảnh là 1 record trong Qdrant, chứa `bbox`/`det_score` của **toàn bộ** khuôn mặt tìm được trong ảnh đó. Ảnh không có khuôn mặt thì không lưu.

## Qdrant

- Chạy qua Docker Compose (xem [docker-compose.yml](docker-compose.yml) và mục "Qdrant (vector DB)" ở [README.md](README.md)).
- Collection (`QDRANT_COLLECTION_NAME`, mặc định `faces`) được tạo **lazy** ở lần ingest đầu tiên, dimension lấy đúng theo embedding thực tế lúc đó (không hard-code), theo cùng nguyên tắc đã áp dụng ở Milestone 1 cho `FACE_MODEL_NAME`.
- Mỗi Qdrant point = 1 ảnh. Vì Qdrant point bắt buộc có đúng 1 vector, point dùng embedding của khuôn mặt **đầu tiên** làm vector đại diện (chỉ phục vụ lưu trữ ở milestone này, chưa dùng để search — search theo embedding sẽ làm ở milestone sau).
- Payload mỗi point: `image_url`, `image_width`, `image_height`, `face_count`, `faces: [{bbox, det_score}]`, `created_at` (ISO UTC).

## Backend

### Files

| File | Vai trò |
|---|---|
| `backend/app/services/qdrant_service.py` | `QdrantService` wrap `qdrant_client.QdrantClient`. `ensure_collection()` tạo collection lazy, `upsert_image()` lưu 1 ảnh (kèm toàn bộ faces), `list_images()` scroll + sort theo `created_at` desc + phân trang, `delete_image()` xoá theo id |
| `backend/app/schemas/face.py` | Thêm `FaceIngestRequest/ItemResult/Response`, `StoredFaceInfo`, `ImageRecord`, `ImageListResponse` |
| `backend/app/api/routes/faces.py` | Thêm 3 route: `/faces/ingest`, `GET /faces`, `DELETE /faces/{image_id}`. Refactor phần download/decode/extract của `/faces/extract` thành `_extract_faces_from_url()` dùng chung |
| `backend/app/core/config.py` | `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_COLLECTION_NAME` (đã thêm từ lúc setup Qdrant) |
| `backend/requirements.txt` | Thêm `qdrant-client` |

### Endpoints

> **Cập nhật (CMS sync feature):** `image_id` không còn tự sinh (`uuid4`) ở BE —
> caller phải cung cấp `id` cho từng ảnh (vd: id từ CMS, hoặc `crypto.randomUUID()`
> tự sinh ở FE cho flow nhập URL thủ công). Ingest lại cùng `id` sẽ ghi đè (xoá
> faces cũ rồi ghi faces mới), không tạo record trùng — phục vụ việc đồng bộ lại
> dữ liệu từ CMS nhiều lần.

`POST /api/v1/faces/ingest` — nhận nhiều `{id, image_url}`, trích xuất + lưu từng ảnh theo đúng `id`. Lỗi ở 1 item (download/decode/400/id không hợp lệ...) không làm hỏng cả batch — ghi vào `error` của item đó và tiếp tục các item còn lại.

Request:

```json
{
  "items": [
    { "id": "3380193", "image_url": "https://example.com/a.jpg" },
    { "id": "3380194", "image_url": "https://example.com/b.jpg" }
  ]
}
```

Response:

```json
{
  "results": [
    { "id": "3380193", "image_url": "https://example.com/a.jpg", "face_count": 3, "error": null },
    { "id": "3380194", "image_url": "https://example.com/b.jpg", "face_count": 0, "error": "Tải ảnh thất bại, HTTP status 404" }
  ],
  "total_faces_added": 3
}
```

`GET /api/v1/faces?limit=20&offset=0` — danh sách ảnh đã lưu, sort theo thời gian lưu mới nhất trước.

```json
{
  "items": [
    {
      "id": "uuid",
      "image_url": "https://example.com/a.jpg",
      "image_width": 1280,
      "image_height": 886,
      "face_count": 3,
      "faces": [{ "bbox": [466.08, 268.62, 573.59, 415.53], "det_score": 0.92 }, "..."],
      "created_at": "2026-10-09T02:32:42.111730+00:00"
    }
  ],
  "total": 1
}
```

`DELETE /api/v1/faces/{image_id}` — xoá 1 ảnh (và toàn bộ faces của nó) khỏi Qdrant. `204` nếu xoá được, `404` nếu không tìm thấy.

### Gọi thử bằng curl

```bash
curl -X POST http://127.0.0.1:8000/api/v1/faces/ingest \
  -H "Content-Type: application/json" \
  -d '{"items": [{"id": "3380193", "image_url": "https://example.com/photo.jpg"}]}'

curl http://127.0.0.1:8000/api/v1/faces

curl -X DELETE http://127.0.0.1:8000/api/v1/faces/<image_id>
```

## Frontend

UI mới "Face Database" trở thành trang chủ (`/`), trang trích xuất thử của Milestone 1 chuyển sang `/extract`. Điều hướng qua `Menu` trong `Layout.Header` (dùng `react-router-dom`, trước đó có cài nhưng chưa dùng tới).

| File | Vai trò |
|---|---|
| `frontend/src/components/FaceBoundingBoxOverlay.tsx` | Component dùng chung: ảnh + khoanh vùng bbox + tooltip `det_score`, tách ra từ `FaceExtractPage.tsx` để dùng lại ở cả 2 trang |
| `frontend/src/pages/FaceDatabasePage.tsx` | Trang chính: `Table` (1 row/ảnh — preview, link ảnh, số khuôn mặt, actions), nút "Thêm" mở `Modal` nhập nhiều URL (`Form.List`), `Drawer` xem chi tiết (ảnh đầy đủ + khoanh **tất cả** bbox của ảnh đó, giống hệt cách hiển thị của `FaceExtractPage`), `Popconfirm` khi xoá |
| `frontend/src/pages/FaceExtractPage.tsx` | Không đổi hành vi, chỉ dùng lại `FaceBoundingBoxOverlay` |
| `frontend/src/types/face.ts` | Thêm `FaceIngestRequest/ItemResult/Response`, `StoredFaceInfo`, `ImageRecord`, `ImageListResponse` |
| `frontend/src/api/faces.ts` | Thêm `facesApi.list()`, `.ingest()`, `.remove()` |
| `frontend/src/hooks/useFaces.ts` | Thêm `useImageList()` (TanStack Query), `useIngestFaces()`, `useDeleteImage()` — 2 mutation sau tự `invalidateQueries(['faces'])` để table refresh |
| `frontend/src/App.tsx`, `frontend/src/main.tsx` | Wire `react-router-dom`: `BrowserRouter` + `Menu`/`Routes` cho 2 trang `/` và `/extract` |

## Chạy thử end-to-end

```bash
docker compose up -d qdrant   # nếu chưa chạy

cd backend
.venv/bin/uvicorn app.main:app --reload --port 8000

cd frontend
npm run dev   # http://localhost:5173
```

Mở `http://localhost:5173`, bấm "Thêm" ở trang Face Database, dán 1 hoặc nhiều URL ảnh, bấm "Trích xuất & Lưu" — xem notification tóm tắt kết quả theo từng URL, table tự refresh. Bấm "Xem chi tiết" để xem ảnh gốc với khung bbox từng khuôn mặt (hover ra `det_score`); bấm "Xoá" (có xác nhận) để xoá ảnh khỏi Qdrant.
