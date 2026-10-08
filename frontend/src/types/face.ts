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
