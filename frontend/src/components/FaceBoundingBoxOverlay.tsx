import { Tooltip } from 'antd'

export interface OverlayFace {
  id: string | number
  bbox: [number, number, number, number]
  det_score: number
}

interface FaceBoundingBoxOverlayProps {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  faces: OverlayFace[]
  maxWidth?: number
}

export default function FaceBoundingBoxOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  faces,
  maxWidth = 720,
}: FaceBoundingBoxOverlayProps) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth }}>
      <img
        src={imageUrl}
        alt="preview"
        style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4 }}
      />
      {faces.map((face) => {
        const [x1, y1, x2, y2] = face.bbox
        const left = (x1 / imageWidth) * 100
        const top = (y1 / imageHeight) * 100
        const width = ((x2 - x1) / imageWidth) * 100
        const height = ((y2 - y1) / imageHeight) * 100
        return (
          <Tooltip key={face.id} title={`det_score: ${face.det_score.toFixed(3)}`}>
            <div
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                border: '2px solid #52c41a',
                borderRadius: 4,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                cursor: 'pointer',
              }}
            />
          </Tooltip>
        )
      })}
    </div>
  )
}
