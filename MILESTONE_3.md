# Milestone 3 — Face Search (thiết kế schema)

> Trạng thái: **thiết kế, chưa code.** File này ghi lại quyết định đổi schema Qdrant trước khi triển khai search theo vector khuôn mặt.

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

## Việc cần làm khi triển khai (chưa code trong milestone này)

- Thêm keyword index trên `faces.image_id` để filter nhanh.
- Migrate: dữ liệu cũ trong collection `faces` (schema Milestone 2) không khôi phục được embedding mặt 2+ → cần **ingest lại** toàn bộ ảnh cũ sau khi đổi schema, không có đường migrate tự động.
- Đổi `qdrant_service.py`: `upsert_image()` tách thành ghi 2 collection (`images` + `faces`); `delete_image()` cascade xoá theo `image_id`; thêm `search_faces(vector, top_k)` dùng cho search.
