# Milestone 4.1 — Person & Person Search (theo mẫu face gốc)

> Trạng thái: **kế hoạch, chưa triển khai.** Bản trước (centroid, `known`/`discover`, gán face hàng loạt, merge/move) đã bị xoá và thay bằng thiết kế đơn giản hơn dưới đây. Độc lập với Milestone 4 (SigLIP): không đụng collection `images`.

Mục tiêu: tìm "ảnh nào chứa người này" tốt hơn search một khuôn mặt lẻ (`GET /faces/{face_id}/search`, Milestone 3), vốn phụ thuộc vào một embedding duy nhất — nhạy với góc mặt, ánh sáng, độ mờ.

Cách làm: người dùng **tự chọn 2–3 face tốt** từ database làm *mẫu* cho một person. Search = chạy search vector bằng **chính embedding gốc của từng mẫu**, rồi **gộp kết quả theo ảnh**. Không tính vector trung bình, không có embedding mới nào được sinh ra.

```
face tốt trong DB ──người dùng chọn──► person.sample_face_ids (2–3 face)
                                              │
                      mỗi mẫu: search vector của chính face đó (group theo ảnh)
                                              │
                      gộp theo image_id: score = max, matched_samples = số mẫu khớp
                                              │
        người dùng thấy ứng viên đúng ──"Thêm làm mẫu"──► person có thêm mẫu (extend)
```

## Quyết định thiết kế (và vì sao)

- **Mẫu là face gốc, search bằng embedding gốc.** Không có vector tổng hợp nào cần giải thích, kiểm chứng hay tính lại. Mỗi điểm số là cosine thật giữa 2 khuôn mặt thật, đối chiếu được bằng mắt.
- **Gộp theo ảnh bằng `max`, kèm `matched_samples`.** `max` cho recall; số mẫu khớp ≥ `min_score` là tín hiệu tin cậy (khớp 2/3 mẫu đáng tin hơn 1/3). Xếp hạng: `score` giảm dần, hoà thì `matched_samples` nhiều hơn xếp trước.
- **Extend là bước do người dùng quyết định.** Từ kết quả, bấm "Thêm làm mẫu" trên face khớp để person có thêm mẫu ở góc/ánh sáng khác. Không tự động thêm — tự thêm sai âm thầm là lỗi khó thấy nhất.
- **Person chỉ lưu danh sách id mẫu; không đụng collection `faces`.** Không `person_id` trên face, không migrate, không phải giữ đồng bộ 2 chiều. Hệ quả: không có khái niệm "face này đã thuộc người khác" (xem Rủi ro).
- **Giới hạn số mẫu (`PERSON_MAX_SAMPLES`, mặc định 5).** Chi phí search tuyến tính theo số mẫu; ở lần đo trước, N=5 không tốt hơn N=3 (xem "Tham khảo").

## Schema

### Collection `persons` (mới)

1 point / person, id = UUID. Vector giả 1 chiều (giống `images` ở Milestone 3, không search trên collection này).

| Payload | Ý nghĩa |
|---|---|
| `name` | Tên do người dùng đặt |
| `sample_face_ids` | Danh sách `face_id` (point id trong `faces`), thứ tự thêm vào. Keyword index để tra "face này là mẫu của ai" |
| `created_at`, `updated_at` | ISO 8601 |

`faces` không đổi schema.

## Thay đổi cần làm ở code Milestone 3 (phát hiện khi review)

1. ~~**Face point id phải ổn định khi sync lại ảnh.**~~ **Đã làm**, xem cuối [MILESTONE_3.md](MILESTONE_3.md). Lưu ý: face ingest trước đó vẫn mang id ngẫu nhiên đến lần sync lại kế tiếp; nếu cần, re-ingest một lần trước khi người dùng bắt đầu chọn mẫu.
2. **Xoá ảnh phải gỡ các mẫu thuộc ảnh đó.** `delete_image` xoá face nhưng person vẫn giữ id → cascade: lấy `face_id` của ảnh trước khi xoá, rồi gỡ khỏi `sample_face_ids` của person nào chứa (tra bằng keyword index).
3. **Đọc person phải chịu được mẫu mồ côi.** Dù đã cascade, `retrieve` thiếu id thì bỏ qua và đánh dấu `missing: true`, không 500; search chỉ dùng mẫu còn tồn tại.


## Backend

| File | Vai trò |
|---|---|
| `app/core/config.py` | `QDRANT_PERSONS_COLLECTION_NAME` (`persons`), `PERSON_MAX_SAMPLES` (5), `PERSON_SEARCH_MIN_SCORE`, `PERSON_SEARCH_DEFAULT_TOP_K` (dùng lại giá trị của face search ở bước đầu: 0.4 / 20) |
| `app/services/qdrant_service.py` | Collection `persons`; CRUD person; thêm/gỡ mẫu; `search_by_person`; cascade khi xoá ảnh; face id xác định |
| `app/schemas/person.py`, `app/api/routes/persons.py` | Schema + endpoint |

### Endpoints (`/api/v1/persons`)

| Endpoint | Mô tả |
|---|---|
| `POST /persons` `{name, face_ids}` | Tạo person với 1–`PERSON_MAX_SAMPLES` mẫu. `201`; `404` nếu face không tồn tại; `400` nếu quá giới hạn |
| `GET /persons` | Danh sách (cập nhật mới nhất trước), kèm thumbnail = mẫu đầu tiên |
| `GET /persons/{id}` | Chi tiết + `samples[]`: `face_id`, `image_id`, `image_url`, `bbox`, `det_score`, `missing` |
| `PATCH /persons/{id}` `{name}` | Đổi tên |
| `DELETE /persons/{id}` | Xoá person (face không bị ảnh hưởng) — `204` |
| `POST /persons/{id}/samples` `{face_id}` | Thêm mẫu. Idempotent nếu đã có; `409` nếu đã đủ `PERSON_MAX_SAMPLES`; `404` nếu face không tồn tại. Response kèm `warnings[]` nếu cosine với mọi mẫu hiện có thấp bất thường (chỉ cảnh báo, không chặn) |
| `DELETE /persons/{id}/samples/{face_id}` | Gỡ mẫu (`404` nếu không thuộc person) |
| `GET /persons/{id}/search?top_k=20&min_score=0.4` | Tìm ảnh, xem bên dưới |

### Search

1. `retrieve` vector của các mẫu còn tồn tại (`with_vectors=True`); không còn mẫu nào → `400` kèm thông báo rõ (không trả rỗng im lặng). Person không tồn tại → `404`.
2. Với **mỗi mẫu**: `query_points_groups` trên `faces`, `group_by=image_id`, `group_size=1`, `limit=top_k`, `score_threshold=min_score`. **Không** loại ảnh nguồn của mẫu — ảnh chứa mẫu là bằng chứng đã xác nhận; đánh dấu `is_sample_image` thay vì ẩn.
3. Gộp theo `image_id` ở app-side: `score = max`, `matched_samples = số mẫu có hit`, `matched_face_id` = face của hit tốt nhất, `by_sample = [{sample_face_id, score, matched_face_id}]` để FE giải thích vì sao ảnh này xuất hiện.
4. Sort `(score desc, matched_samples desc)`, cắt `top_k`, rồi `retrieve(images)` + gắn toàn bộ faces của ảnh (cùng cách như `search_similar_faces`).

N mẫu = N query Qdrant (≤ 5, mili-giây mỗi query); chưa cần batch hay recommend API (điểm số của nó không phải cosine thuần, khó giải thích).

Response: `person`, `items: [{score, matched_samples, matched_face_id, is_sample_image, by_sample, image: ImageRecord}]`, `total`.

## Frontend

| File | Vai trò |
|---|---|
| `pages/PersonsPage.tsx` | `/persons`: danh sách, tạo, xoá |
| `pages/PersonDetailPage.tsx` | `/persons/:id`: đổi tên, hàng mẫu (crop face + `det_score`, gỡ mẫu, cảnh báo mẫu yếu), nút tìm ảnh, kết quả kèm `matched_samples`, nút "Thêm làm mẫu" trên face khớp |
| `components/FaceSearchResultDrawer.tsx` | Thêm "Dùng làm mẫu cho người…" (chọn person có sẵn hoặc tạo mới) trên face đang xem |
| `components/FaceCrop.tsx`, `api/persons.ts`, `hooks/usePersons.ts`, `types/person.ts` | Dùng chung / gọi API |

Cảnh báo chất lượng mẫu chỉ là gợi ý trên UI (không chặn): `det_score < 0.7` hoặc cạnh ngắn bbox < 60px. Hai ngưỡng này mượn từ lần làm trước, **chưa có căn cứ từ dữ liệu**; ~50% face trong DB có cạnh < 49px nên nhiều face sẽ bị cảnh báo.

Mutation invalidate `['persons']`. Không cần invalidate `['faces']` (face không mang thông tin person).

## Test

- `tests/test_person_search.py` (Qdrant thật + collection tạm, tự skip nếu Qdrant không chạy, theo mẫu `test_face_search.py`): tạo/đổi tên/xoá person, thêm/gỡ mẫu, vượt giới hạn → `409`/`400`, search trả ảnh khác chứa người đó, ảnh xuất hiện đúng 1 lần dù nhiều mẫu khớp, `matched_samples` đúng, ảnh chứa mẫu được đánh dấu `is_sample_image`, person không còn mẫu → `400`, id lạ → `404`.
- Test cho face id ổn định: ingest lại cùng ảnh + cùng bbox → `face_id` không đổi, mẫu vẫn search được; xoá ảnh → mẫu bị gỡ khỏi person.
- Test M1–M3 không đổi hành vi.

## Tham khảo: số đo từ lần làm trước (đã xoá code, không tái lập được)

Nhãn 99 face / 3 người (Tô Lâm, Hồ Chí Minh, Phạm Minh Chính), leave-one-out, mức ảnh. Dùng làm gợi ý, **không phải bằng chứng**:

| Phương pháp | AP | P@5 | P@10 | P@20 |
|---|---|---|---|---|
| Face lẻ (M3) | 0.679 | 0.773 | 0.739 | 0.650 |
| Person N=3 `max` (≈ cách làm hiện tại) | 0.756 | 1.000 | 0.927 | 0.730 |
| Person N=3 centroid (đã bỏ) | 0.771 | 1.000 | 0.925 | 0.746 |

- `max` N=3 chỉ kém centroid 0.015 AP — đủ để đổi lấy sự đơn giản và giải thích được.
- Chọn **một** mẫu duy nhất thất thường (Hồ Chí Minh N=1: 0.629 < face lẻ 0.858) → lý do yêu cầu nhiều mẫu và cho phép gỡ/thêm mẫu.
- `max` nhạy với một mẫu xấu (Hồ Chí Minh N=5 `max` kém N=3 `max`) → `matched_samples` + `by_sample` trên UI để người dùng thấy mẫu nào gây nhiễu và gỡ nó.
- Hạn chế: chỉ 3 người nhiều ảnh, mặt rõ; nhãn không đầy đủ nên precision tuyệt đối bị đánh giá thấp. Thư mục `backend/scripts/person_eval/` hiện chỉ còn thư mục `data/` rỗng — xoá hoặc dựng lại nếu cần đo.

## Rủi ro & việc còn mở

- **Mẫu sai người làm bẩn kết quả.** `max` lan lỗi của 1 mẫu sang mọi kết quả. Giảm thiểu: `by_sample` cho thấy mẫu nào sinh ra ảnh nào; cảnh báo khi thêm mẫu có cosine thấp với các mẫu còn lại. Ngưỡng cảnh báo chưa đo — đặt sau khi có dữ liệu.
- **Cùng một face có thể là mẫu của nhiều person.** Không có ràng buộc ở 4.1 (đổi lại không phải migrate `faces`). Nếu cần "face này thuộc ai" thì tra qua index `sample_face_ids`.
- **`PERSON_SEARCH_MIN_SCORE` = 0.4 chưa được chuẩn hoá** cho cosine face-vs-face đơn lẻ (số đo cũ tính với centroid). Cần thêm nhãn (7–10 người, ưu tiên ít ảnh, mặt nhỏ/nghiêng) để chốt.
- **Chỉ search được ảnh đã ingest.** Không có tìm bằng ảnh upload ngoài DB (như Milestone 3).
- **Chưa có** clustering gợi ý, tự gán khi ingest, phát hiện outlier tự động — dành cho milestone sau, chỉ khi đã có ngưỡng an toàn đo được.
