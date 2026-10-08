import axios, { type AxiosError } from 'axios'

export interface ApiErrorBody {
  detail?: string | { msg: string }[]
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    // Chuẩn hoá message để UI chỉ cần đọc `error.message`.
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') {
      error.message = detail
    } else if (Array.isArray(detail) && detail.length > 0) {
      error.message = detail.map((d) => d.msg).join(', ')
    }
    return Promise.reject(error)
  },
)
