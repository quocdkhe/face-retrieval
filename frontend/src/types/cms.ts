export interface CmsPhoto {
  id: string
  zoneId?: number
  name?: string
  originalName?: string
  url?: string
  fullUrl: string
  status?: number
  size?: string
  createdAt?: string
}

export interface CmsPhotosResponse {
  photos: CmsPhoto[]
}
