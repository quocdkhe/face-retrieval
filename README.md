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

## Dummy API

Store in-memory (`backend/app/api/routes/persons.py`), seed 7 bản ghi — thay bằng database khi tích hợp thật.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/persons` | List, query `q`, `page`, `page_size` |
| GET | `/api/v1/persons/{id}` | Chi tiết (404 nếu không có) |
| POST | `/api/v1/persons` | Tạo mới → 201 |
| DELETE | `/api/v1/persons/{id}` | Xoá → 204 |

## Frontend layers

| File | Vai trò |
|---|---|
| `src/lib/axios.ts` | Axios instance, interceptor token + chuẩn hoá lỗi FastAPI (`detail`) |
| `src/types/person.ts` | Types khớp Pydantic schema |
| `src/api/persons.ts` | API functions + `personKeys` query keys |
| `src/hooks/usePersons.ts` | `useQuery` / `useMutation` wrappers, invalidate sau mutation |
| `src/pages/PersonsPage.tsx` | antd Table (search, phân trang server-side), Modal + Form tạo mới, Popconfirm xoá |
| `src/main.tsx` | QueryClientProvider, ConfigProvider (locale vi_VN, theme token), antd `App`, Devtools |

Alias `@/*` → `src/*` (cấu hình ở cả `vite.config.ts` và `tsconfig.app.json`).

## Env

`frontend/.env.development`:

```
VITE_API_BASE_URL=/api/v1
```

Trỏ thẳng backend (không qua proxy) thì đổi thành URL tuyệt đối, ví dụ `http://127.0.0.1:8000/api/v1`.
