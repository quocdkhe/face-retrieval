# Milestone 4 — Image Search (SigLIP image embedding)

> Trạng thái: **kế hoạch, chưa code.** Cần review các mục "Quyết định cần chốt" ở cuối trước khi triển khai.

Mục tiêu: ngoài tìm theo khuôn mặt (Milestone 3), cho phép tìm **ảnh** theo nội dung tổng thể — "ảnh nào trông giống ảnh này" và "ảnh nào khớp với mô tả này". Nền tảng: mỗi ảnh có thêm một vector embedding của **cả ảnh** sinh bởi SigLIP, lưu ngay trong bảng `images`.

```
image_url → download → decode ─┬─ InsightFace → faces (Milestone 1-3, không đổi)
                               └─ SigLIP     → image_embedding  ──► cột mới ở `images`
```

## Vì sao SigLIP

- Face embedding (ArcFace) chỉ biểu diễn **danh tính** khuôn mặt; không nói được gì về bối cảnh, vật thể, màu sắc, bố cục của ảnh. Ảnh không có mặt thì không có vector nào để search.
- SigLIP là model contrastive ảnh–văn bản: image encoder và text encoder cùng không gian vector → một embedding ảnh dùng được cho cả **image→image** lẫn **text→image** mà không cần train thêm.
- Mọi ảnh đều có embedding (kể cả ảnh `face_count: 0`, nay đã được lưu — xem Milestone 3).

## Thay đổi schema

Hiện collection `images` chỉ có 1 vector giả 1 chiều (`_IMAGES_DUMMY_VECTOR_SIZE`, không search). "Cột image embed" chính là thay vector giả đó bằng **vector SigLIP thật**:

| image_id (PK) | image_url | image_width | image_height | face_count | created_at | **vector (SigLIP, mới)** |
|---|---|---|---|---|---|---|
| 3380193 | a.jpg | 1280 | 886 | 3 | 2026-10-09T… | embedding cả ảnh (L2-normalized) |

- Collection `faces` **không đổi**.
- Dimension lấy theo model thực tế lúc runtime (không hard-code), cùng nguyên tắc với `FACE_MODEL_NAME`.
- Distance: cosine (embedding đã L2-normalize).
- Payload thêm `image_model` (tên model sinh embedding) để sau này đổi model biết vector nào cần re-embed.

### Vì sao phải tạo lại collection

Qdrant không đổi được kích thước vector của collection đã tạo (1 → N chiều). Nên:

1. Tạo `images` mới với vector thật, lazy ở lần ingest đầu tiên (giống `faces` hiện tại).
2. Dữ liệu cũ: viết script `backend/scripts/reindex_images.py` — scroll `images` cũ (lấy `id` + payload) → tải lại ảnh → SigLIP embed → upsert vào collection mới (giữ nguyên `id`, `created_at`, không đụng `faces`). Với ảnh sync từ CMS, chạy lại "Đồng bộ từ CMS" cũng đủ vì ingest ghi đè theo `id`; script cần cho ảnh nhập tay (id là UUID).

## Backend

### Files

| File | Thay đổi |
|---|---|
| `backend/app/services/image_embedding_service.py` (mới) | `ImageEmbeddingService` wrap SigLIP (HuggingFace `transformers`: `AutoModel` + `AutoProcessor`), load 1 lần thread-safe giống `FaceService`. `embed_image(bgr_ndarray) -> list[float]`, `embed_text(str) -> list[float]`, cả hai L2-normalize. |
| `backend/app/core/config.py` | `IMAGE_MODEL_NAME`, `IMAGE_SEARCH_DEFAULT_TOP_K` |
| `backend/app/main.py` | `lifespan` load thêm model SigLIP lúc startup |
| `backend/app/services/qdrant_service.py` | `images` dùng vector thật (`ensure_collections` nhận thêm `image_vector_size`), `upsert_image(..., image_embedding)`, thêm `search_images(vector, top_k, exclude_id=None)`, `get_image_vector(image_id)` |
| `backend/app/api/routes/faces.py` | `ingest`: sau khi decode, embed ảnh bằng SigLIP và truyền vào `upsert_image` (decode 1 lần, dùng cho cả 2 model) |
| `backend/app/api/routes/images.py` (mới) | Các endpoint search ảnh bên dưới |
| `backend/app/schemas/image.py` (mới) | Request/response của search ảnh |
| `backend/requirements.txt` | `torch` (CPU), `transformers`, `pillow` |
| `backend/scripts/reindex_images.py` (mới) | Backfill vector cho ảnh đã lưu |

### Pipeline ingest

- Vẫn **download + decode 1 lần**; ảnh BGR (OpenCV) → InsightFace như cũ, đồng thời → RGB → SigLIP.
- Lỗi ở bước SigLIP cho ảnh nào thì ghi `error` của item đó (giống cách xử lý lỗi hiện tại), không hỏng cả batch.
- Chi phí: thêm ~0.2–0.5s/ảnh trên CPU với base model — crawl 60 ảnh từ CMS sẽ chậm hơn rõ rệt; bảng tiến trình ở `CmsSyncModal` đã xử lý tuần tự từng ảnh nên không cần đổi.

### Endpoints

Prefix `/api/v1/images`.

| Endpoint | Mô tả |
|---|---|
| `POST /images/search/text` `{ "query": "người đàn ông mặc vest", "top_k": 20 }` | text → ảnh. SigLIP text encoder → search `images`. |
| `POST /images/search/image` `{ "image_url": "…", "top_k": 20 }` | ảnh query ngoài database (tải về → embed → search). |
| `GET /images/{image_id}/similar?top_k=20` | ảnh tương tự một ảnh **đã lưu**: dùng luôn vector đã có, không chạy lại model; loại chính ảnh đó khỏi kết quả. |

Response chung:

```json
{
  "items": [
    { "score": 0.83, "image": { "id": "…", "image_url": "…", "image_width": 1280, "image_height": 886, "face_count": 3, "faces": [], "created_at": "…" } }
  ],
  "total": 1
}
```

- Sort theo score giảm dần, không phân trang (nhất quán với Milestone 3).
- Lỗi: `400` (URL/ảnh không hợp lệ, query rỗng), `404` (`image_id` không tồn tại).
- **Không dùng ngưỡng `min_score` cố định** như face search (0.4): cosine text↔image của SigLIP thường thấp hơn nhiều (~0.1–0.3) và khác thang với image↔image. Giai đoạn đầu chỉ lấy `top_k`; ngưỡng (nếu cần) sẽ tinh chỉnh bằng dữ liệu thật và tách riêng cho từng loại query.

## Frontend

| File | Thay đổi |
|---|---|
| `frontend/src/pages/ImageSearchPage.tsx` (mới) | Route `/search`, mục menu "Tìm kiếm ảnh". `Tabs`: **Theo mô tả** (Input.Search) / **Theo ảnh** (nhập URL ảnh, có preview). Kết quả là lưới ảnh (`Card` + `Image`) kèm tag % giống nhau. |
| `frontend/src/pages/FaceDatabasePage.tsx` | Thêm action "Tìm ảnh tương tự" ở mỗi row → gọi `/images/{id}/similar`, hiển thị bằng cùng component kết quả (drawer). |
| `frontend/src/components/ImageResultGrid.tsx` (mới) | Component dùng chung cho 3 luồng trên; click 1 ảnh mở lại Drawer chi tiết hiện có (có sẵn tìm theo khuôn mặt). |
| `frontend/src/api/images.ts`, `hooks/useImageSearch.ts`, `types/image.ts` (mới) | Gọi 3 endpoint, TanStack Query như `useFaces`. |
| `frontend/src/App.tsx` | Thêm route + menu |

Có đủ trạng thái loading / empty / error như drawer search khuôn mặt.

## Test

- `tests/test_image_search.py`: Qdrant thật + collection tạm (như `test_face_search.py`), SigLIP thật trên ảnh fixture, mock HTTP download.
  - ingest lưu vector đúng dimension model;
  - `similar` loại ảnh nguồn, ảnh trùng nội dung xếp hạng đầu;
  - text search trả kết quả, query rỗng → 400;
  - ảnh `face_count: 0` vẫn tìm được;
  - script reindex giữ nguyên `id`/`created_at`.
- Test hiện có không đổi hành vi (face pipeline giữ nguyên).

## Các bước triển khai

1. `ImageEmbeddingService` + config + lifespan; thử embed ảnh fixture, kiểm dimension.
2. Schema `images` vector thật + `upsert_image` nhận embedding; ingest gọi SigLIP.
3. `search_images`, 3 endpoint + test.
4. Script reindex + chạy trên dữ liệu dev.
5. FE: trang tìm kiếm, action "Tìm ảnh tương tự", component kết quả dùng chung.
6. Cập nhật tài liệu / README (cài torch, dung lượng model).

## Rủi ro

- **Môi trường Python:** venv đang dùng Python 3.14 — cần kiểm tra `torch` có wheel cho 3.14 trên macOS; nếu không, hạ Python (3.12) cho venv hoặc đổi sang chạy SigLIP qua ONNX Runtime (đã có sẵn cho InsightFace).
- **Tài nguyên:** base model ~400MB tải lần đầu (`~/.cache/huggingface`), thêm RAM khi chạy cùng buffalo_l; model large (so400m) chính xác hơn nhưng nặng và chậm hơn nhiều trên CPU.
- **Ngôn ngữ truy vấn:** SigLIP gốc huấn luyện chủ yếu bằng tiếng Anh — query tiếng Việt cho kết quả kém (xem câu hỏi 1).
- **Mất dữ liệu `images` nếu quên backfill:** tạo collection mới trống; phải chạy reindex/sync lại, nên làm theo đúng thứ tự bước 4.
- **Quy mô:** `list_images` vẫn scroll toàn bộ `images` rồi sort app-side — không ảnh hưởng search nhưng sẽ chậm khi dữ liệu lớn (ngoài phạm vi milestone này).

## Quyết định cần chốt

1. **Model:** `google/siglip-base-patch16-224` (768 chiều, nhẹ, chủ yếu tiếng Anh) hay `google/siglip2-base-patch16-224` (SigLIP 2, đa ngôn ngữ — hợp query tiếng Việt hơn)? Đề xuất SigLIP 2 base; cần xác nhận bản đang tải được và chất lượng thực tế với query tiếng Việt trước khi chốt.
2. **Phạm vi search:** làm cả text→ảnh và ảnh→ảnh, hay chỉ ảnh→ảnh trước? Đề xuất làm cả hai vì text encoder đi kèm model, chi phí thêm nhỏ.
3. **Ảnh query ngoài database:** chỉ nhận URL (nhất quán với toàn hệ thống) hay thêm upload file (multipart)? Đề xuất URL trước, upload để sau.
4. **Vector trong `images`:** 1 vector không tên (đơn giản, đề xuất) hay named vector để sau này thêm loại embedding khác?
5. **Kết hợp face + image** (lọc ảnh theo người rồi xếp hạng theo nội dung) **không** nằm trong milestone này.
