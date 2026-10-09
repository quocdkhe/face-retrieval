import { http } from '@/lib/axios'
import type {
  FaceExtractRequest,
  FaceExtractResponse,
  FaceIngestRequest,
  FaceIngestResponse,
  ImageListResponse,
} from '@/types/face'

export const facesApi = {
  extract: async (payload: FaceExtractRequest): Promise<FaceExtractResponse> => {
    const { data } = await http.post<FaceExtractResponse>('/faces/extract', payload)
    return data
  },
  list: async (params: { limit: number; offset: number }): Promise<ImageListResponse> => {
    const { data } = await http.get<ImageListResponse>('/faces', { params })
    return data
  },
  ingest: async (payload: FaceIngestRequest): Promise<FaceIngestResponse> => {
    const { data } = await http.post<FaceIngestResponse>('/faces/ingest', payload)
    return data
  },
  remove: async (id: string): Promise<void> => {
    await http.delete(`/faces/${id}`)
  },
}
