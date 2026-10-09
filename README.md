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
| POST | `/api/v1/faces/extract` | Trích xuất khuôn mặt (bbox + embedding) từ URL ảnh |
| POST | `/api/v1/faces/ingest` | Trích xuất + lưu nhiều ảnh (theo ảnh) vào Qdrant |
| GET | `/api/v1/faces` | Danh sách ảnh đã lưu (phân trang) |
| DELETE | `/api/v1/faces/{image_id}` | Xoá 1 ảnh khỏi Qdrant |

Chi tiết pipeline, model, request/response, error handling, test và frontend UI: xem **[MILESTONE_1.md](MILESTONE_1.md)** (trích xuất) và **[MILESTONE_2.md](MILESTONE_2.md)** (Face Database — Qdrant).

## Qdrant (vector DB)

```bash
docker compose up -d qdrant
```

- REST + dashboard: http://localhost:6333/dashboard
- gRPC: localhost:6334
- Data lưu ở Docker volume `qdrant_data`, không mất khi container restart.

Cấu hình liên quan (`backend/app/core/config.py`): `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_COLLECTION_NAME`.

## Frontend layers

| File | Vai trò |
|---|---|
| `src/lib/axios.ts` | Axios instance, interceptor token + chuẩn hoá lỗi FastAPI (`detail`) |
| `src/main.tsx` | QueryClientProvider, ConfigProvider (locale vi_VN, theme token), antd `App`, Devtools, `BrowserRouter` |
| `src/App.tsx` | `Layout` + `Menu` điều hướng giữa trang Face Database (`/`) và trang trích xuất thử (`/extract`) |

Alias `@/*` → `src/*` (cấu hình ở cả `vite.config.ts` và `tsconfig.app.json`).

## Env

`frontend/.env.development`:

```
VITE_API_BASE_URL=/api/v1
```

Trỏ thẳng backend (không qua proxy) thì đổi thành URL tuyệt đối, ví dụ `http://127.0.0.1:8000/api/v1`.
