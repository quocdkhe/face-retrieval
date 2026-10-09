export interface FaceExtractRequest {
  image_url: string
}

export interface FaceInfo {
  face_id: number
  bbox: [number, number, number, number]
  det_score: number
  embedding: number[]
}

export interface FaceExtractResponse {
  image_url: string
  image_width: number
  image_height: number
  face_count: number
  faces: FaceInfo[]
}

export interface FaceIngestItem {
  id: string
  image_url: string
}

export interface FaceIngestRequest {
  items: FaceIngestItem[]
}

export interface FaceIngestItemResult {
  id: string
  image_url: string
  face_count: number
  error: string | null
}

export interface FaceIngestResponse {
  results: FaceIngestItemResult[]
  total_faces_added: number
}

export interface StoredFaceInfo {
  bbox: [number, number, number, number]
  det_score: number
}

export interface ImageRecord {
  id: string
  image_url: string
  image_width: number
  image_height: number
  face_count: number
  faces: StoredFaceInfo[]
  created_at: string
}

export interface ImageListResponse {
  items: ImageRecord[]
  total: number
}
