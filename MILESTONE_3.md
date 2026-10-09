# Milestone 3 — Face Search (thiết kế schema)

> Trạng thái: **tạm dừng ở đây.** Đã refactor storage sang 2 collection + đổi
> ingest sang `id` do caller cung cấp + thêm luồng đồng bộ ảnh từ CMS (phần
> dưới). Search theo vector (`search_faces`, endpoint, UI) **chưa code** — sẽ
> làm ở bước tiếp theo khi quay lại milestone này.

Mục tiêu: search được "ảnh nào trong database chứa khuôn mặt giống với khuôn mặt query" — nền tảng cần thiết là mỗi khuôn mặt phải có vector riêng để Qdrant search, chứ không chỉ 1 vector đại diện cho cả ảnh như Milestone 2.

## Vấn đề với schema Milestone 2

Milestone 2 lưu theo ảnh: 1 Qdrant point = 1 ảnh, payload chứa mảng `faces: [{bbox, det_score}]` cho mọi khuôn mặt, nhưng Qdrant point **chỉ cho phép 1 vector/point** — nên chỉ embedding của khuôn mặt đầu tiên được lưu làm vector, embedding của các khuôn mặt còn lại **không được lưu ở đâu cả** (chỉ còn bbox/det_score, mất vector).

Bảng dữ liệu minh họa (1 collection `faces`, point = 1 ảnh):

| id (PK) | image_url | image_width | image_height | face_count | faces (payload lồng) | vector |
|---|---|---|---|---|---|---|
| img-1 | a.jpg | 1280 | 886 | 3 | `[{bbox:[466,268,573,415], det_score:0.92}, {bbox:[745,338,845,479], det_score:0.91}, {bbox:[268,145,372,267], det_score:0.88}]` | embedding của mặt #1 (duy nhất) |
| img-2 | b.jpg | 640 | 480 | 1 | `[{bbox:[94,112,194,230], det_score:0.84}]` | embedding của mặt duy nhất |

→ Không thể search đúng nghĩa ("mặt nào giống mặt query") vì chỉ có 1 vector/ảnh; 2 khuôn mặt còn lại của `img-1` không tồn tại dưới dạng vector để so khớp.

## Schema mới — 2 collection quan hệ 1-nhiều

Tách thành 2 collection, nối qua `image_id` (giống khoá ngoại trong DB quan hệ — Qdrant không có JOIN, phần ghép dữ liệu giữa 2 collection phải tự làm ở application code).

Bảng `images` (collection `images`, point = 1 ảnh — vẫn là "nguồn sự thật" cho trang list):

| image_id (PK) | image_url | image_width | image_height | face_count | created_at |
|---|---|---|---|---|---|
| img-1 | a.jpg | 1280 | 886 | 3 | 2026-10-09T02:32:42Z |
| img-2 | b.jpg | 640 | 480 | 1 | 2026-10-09T02:40:11Z |

Bảng `faces` (collection `faces`, point = 1 khuôn mặt — vector là embedding thật):

| face_id (PK) | image_id (FK → images.image_id) | bbox | det_score | vector |
|---|---|---|---|---|
| face-1 | img-1 | [466,268,573,415] | 0.92 | embedding mặt 1 |
| face-2 | img-1 | [745,338,845,479] | 0.91 | embedding mặt 2 |
| face-3 | img-1 | [268,145,372,267] | 0.88 | embedding mặt 3 |
| face-4 | img-2 | [94,112,194,230] | 0.84 | embedding mặt 4 |

## Vì sao chọn hướng này

1. **Không mất embedding.** Mỗi khuôn mặt là 1 point riêng trong `faces`, có vector thật — thay vì chỉ mặt đầu tiên như schema cũ. Đây là điều kiện bắt buộc để search theo từng mặt.
2. **Search theo vector trở nên khả thi và đúng nghĩa.** `search(faces, query_vector)` trả về đúng những *khuôn mặt* giống nhất (kèm `bbox`, `image_id`) — thứ mà schema cũ (1 vector/ảnh) không làm được.
3. **Tách đúng đơn vị truy vấn cho từng nhu cầu**, tránh đọc/giải nén payload lồng:
   - List ảnh (trang Face Database) → đọc trực tiếp `images`, không đụng `faces`.
   - Lấy toàn bộ khuôn mặt của 1 ảnh → filter `faces` theo `image_id`, không cần biết trước bbox/face_id.
   - Search theo khuôn mặt query → search `faces`, rồi "join" app-side bằng `retrieve(images, ids=unique(image_id))` để lấy lại `image_url`/kích thước hiển thị.
4. **Không trùng lặp dữ liệu ảnh.** `image_url`/kích thước chỉ lưu 1 lần ở `images`, không lặp lại trên từng point `faces` như cách denormalize đã cân nhắc trước đó — đổi lại phải trả giá 2 round-trip (search `faces` rồi retrieve `images`) vì Qdrant không có JOIN, nhưng đây là chi phí hợp lý cho một DB vector-only.
5. **Xoá/toàn vẹn dữ liệu rõ ràng hơn.** Xoá 1 ảnh = xoá 1 point ở `images` + xoá toàn bộ point ở `faces` có `image_id` khớp (filter-delete) — tương đương cascade delete, rõ ràng hơn so với sửa 1 payload lồng.

## Việc đã triển khai (phần storage)

- `backend/app/core/config.py`: thay `QDRANT_COLLECTION_NAME` bằng `QDRANT_IMAGES_COLLECTION_NAME` (mặc định `images`) và `QDRANT_FACES_COLLECTION_NAME` (mặc định `faces`).
- `backend/app/services/qdrant_service.py`:
  - `ensure_collections(face_vector_size)` tạo lazy cả 2 collection; `images` dùng vector giả 1 chiều (không search); `faces` dùng dimension embedding thật, có keyword index trên `image_id`.
  - `upsert_image()` ghi 1 point vào `images` (metadata ảnh) + N point vào `faces` (mỗi khuôn mặt 1 vector thật, payload có `image_id` + `bbox`/`det_score`).
  - `list_images()` scroll `images` rồi "join" app-side: filter `faces` theo `image_id` của từng trang để gắn lại `faces: [{bbox, det_score}]` — API response giữ nguyên hình dạng cũ (`ImageRecord`), FE không cần đổi.
  - `delete_image()` cascade: xoá point ở `images` + filter-delete toàn bộ point ở `faces` có `image_id` khớp.
- Đã xoá collection `faces` cũ (schema Milestone 2, point=ảnh) trên Qdrant dev local — không migrate được, đã verify bằng ingest lại 2 ảnh fixture (7 khuôn mặt) + list + cascade delete qua API thật.
- Đã verify: `images` points_count và `faces` points_count tách đúng, `GET /faces` trả đúng cấu trúc cũ.

## Việc đã triển khai (đồng bộ ảnh từ CMS)

Cần sync dữ liệu ảnh từ 1 hệ thống CMS ngoài, mỗi ảnh phải giữ đúng `id` của CMS
trong Qdrant (để sync lại không tạo record trùng) → đổi ingest từ tự sinh
`image_id` sang nhận `id` bắt buộc từ caller:

- `backend/app/schemas/face.py`: `FaceIngestRequest.items: [{id, image_url}]` (`id` bắt buộc) thay cho `image_urls: string[]` cũ.
- `backend/app/services/qdrant_service.py`:
  - `_to_point_id(image_id)`: ép `id` về `int` (nếu toàn số, như id CMS) hoặc UUID hợp lệ — 2 dạng duy nhất Qdrant chấp nhận làm point id.
  - `upsert_image(image_id, ...)` giờ xoá face cũ theo `image_id` trước khi ghi mới, nên re-sync cùng `id` nhiều lần (ảnh đổi nội dung/khuôn mặt) ghi đè đúng, không tích lũy face rác.
- `backend/app/api/routes/faces.py`: `ingest_faces` lặp theo `item.id`; `id` không hợp lệ cho Qdrant trả `error` per-item (không hỏng cả batch) thay vì 500.
- Frontend:
  - `frontend/src/api/cms.ts`, `types/cms.ts`: gọi trực tiếp URL CMS bằng axios thuần (không qua `http` instance của app) kèm `Authorization: Bearer <token>`.
  - `frontend/src/components/CmsSyncModal.tsx`: modal nhập URL CMS (mặc định `https://api-cms.dantri.dev/photos?limit=60&page=1`, sửa page/limit ngay trong URL) + Bearer token bắt buộc. Bấm "Crawl & Đồng bộ" → crawl CMS (Alert loading/success/error) → lần lượt gọi `/faces/ingest` cho từng ảnh theo đúng `id` CMS → bảng tiến trình live từng ảnh (chờ/đang embed/thành công kèm số mặt/lỗi) + progress bar. Khoá đóng modal khi đang chạy.
  - `frontend/src/pages/FaceDatabasePage.tsx`: thêm nút "Đồng bộ từ CMS" mở modal trên; modal "Thêm" thủ công (dán URL tay) tự sinh `id` bằng `crypto.randomUUID()` client-side để tương thích contract mới.
- Rủi ro đã biết: crawl CMS gọi trực tiếp từ browser có thể bị **CORS** chặn nếu domain CMS không cho phép origin của FE — nếu gặp, cần đổi sang proxy crawl qua BE.

## Còn lại (chưa code)

- `search_faces(vector, top_k)` ở `qdrant_service.py` + endpoint search theo khuôn mặt query (search `faces` rồi `retrieve(images, ids=...)` để lấy `image_url`/kích thước).
- FE: trang/luồng upload ảnh query + hiển thị kết quả search.
