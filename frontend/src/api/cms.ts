import axios from 'axios'

import type { CmsPhotosResponse } from '@/types/cms'

export const cmsApi = {
  fetchPhotos: async (url: string, token: string): Promise<CmsPhotosResponse> => {
    const { data } = await axios.get<CmsPhotosResponse>(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20_000,
    })
    return data
  },
}
