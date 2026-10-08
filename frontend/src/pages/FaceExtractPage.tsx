import { App, Card, Empty, Flex, Input, Space, Tag, Tooltip, Typography } from 'antd'
import { useState } from 'react'

import { useExtractFaces } from '@/hooks/useFaces'

export default function FaceExtractPage() {
  const { message } = App.useApp()
  const [imageUrl, setImageUrl] = useState('')
  const { data, mutate, isPending } = useExtractFaces()

  const handleExtract = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) {
      message.warning('Nhập URL ảnh')
      return
    }
    mutate(
      { image_url: trimmed },
      {
        onError: (err) => {
          message.error(err instanceof Error ? err.message : 'Trích xuất thất bại')
        },
      },
    )
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Face Extract
      </Typography.Title>

      <Card>
        <Input.Search
          value={imageUrl}
          placeholder="https://example.com/photo.jpg"
          enterButton="Trích xuất"
          size="large"
          loading={isPending}
          onChange={(e) => setImageUrl(e.target.value)}
          onSearch={handleExtract}
        />
      </Card>

      <Card title="Kết quả">
        {!data ? (
          <Empty description="Nhập URL ảnh và bấm Trích xuất" />
        ) : (
          <Flex vertical gap={12}>
            <Space>
              <Tag color={data.face_count > 0 ? 'green' : 'default'}>
                {data.face_count} khuôn mặt
              </Tag>
              <Typography.Text type="secondary">
                {data.image_width} x {data.image_height}px
              </Typography.Text>
            </Space>

            <div style={{ position: 'relative', width: '100%', maxWidth: 720 }}>
              <img
                src={data.image_url}
                alt="preview"
                style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4 }}
              />
              {data.faces.map((face) => {
                const [x1, y1, x2, y2] = face.bbox
                const left = (x1 / data.image_width) * 100
                const top = (y1 / data.image_height) * 100
                const width = ((x2 - x1) / data.image_width) * 100
                const height = ((y2 - y1) / data.image_height) * 100
                return (
                  <Tooltip key={face.face_id} title={`det_score: ${face.det_score.toFixed(3)}`}>
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
          </Flex>
        )}
      </Card>
    </Flex>
  )
}
