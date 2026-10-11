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
  /** Có truyền thì bbox thành clickable (vd: click để search theo khuôn mặt). */
  onFaceClick?: (face: OverlayFace) => void
  tooltipHint?: string
  /** Có truyền thì chỉ các face này được tô nổi bật, các face còn lại làm mờ. */
  highlightedFaceIds?: Array<string | number>
}

const DEFAULT_COLOR = '#52c41a'
const HIGHLIGHT_COLOR = '#f5222d'

export default function FaceBoundingBoxOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  faces,
  maxWidth = 720,
  onFaceClick,
  tooltipHint,
  highlightedFaceIds,
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
        const dimmed = !!highlightedFaceIds && !highlightedFaceIds.includes(face.id)
        const highlighted = !!highlightedFaceIds && !dimmed
        const title = `det_score: ${face.det_score.toFixed(3)}`
        return (
          <Tooltip key={face.id} title={tooltipHint ? `${title} — ${tooltipHint}` : title}>
            <div
              onClick={onFaceClick ? () => onFaceClick(face) : undefined}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                border: `${highlighted ? 3 : 2}px solid ${highlighted ? HIGHLIGHT_COLOR : DEFAULT_COLOR}`,
                borderRadius: 4,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                cursor: 'pointer',
                opacity: dimmed ? 0.35 : 1,
              }}
            />
          </Tooltip>
        )
      })}
    </div>
  )
}
