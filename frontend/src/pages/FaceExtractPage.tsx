import { App, Card, Empty, Flex, Input, Space, Tag, Typography } from 'antd'
import { useState } from 'react'

import FaceBoundingBoxOverlay from '@/components/FaceBoundingBoxOverlay'
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

            <FaceBoundingBoxOverlay
              imageUrl={data.image_url}
              imageWidth={data.image_width}
              imageHeight={data.image_height}
              faces={data.faces.map((f) => ({ id: f.face_id, bbox: f.bbox, det_score: f.det_score }))}
            />
          </Flex>
        )}
      </Card>
    </Flex>
  )
}
