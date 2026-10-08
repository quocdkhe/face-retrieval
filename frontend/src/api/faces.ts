import { http } from '@/lib/axios'
import type { FaceExtractRequest, FaceExtractResponse } from '@/types/face'

export const facesApi = {
  extract: async (payload: FaceExtractRequest): Promise<FaceExtractResponse> => {
    const { data } = await http.post<FaceExtractResponse>('/faces/extract', payload)
    return data
  },
}
