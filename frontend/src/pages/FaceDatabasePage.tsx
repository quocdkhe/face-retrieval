import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Drawer,
  Flex,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'

import FaceBoundingBoxOverlay from '@/components/FaceBoundingBoxOverlay'
import { useDeleteImage, useImageList, useIngestFaces } from '@/hooks/useFaces'
import type { FaceIngestResponse, ImageRecord } from '@/types/face'

export default function FaceDatabasePage() {
  const { message, notification } = App.useApp()
  const [page, setPage] = useState({ current: 1, pageSize: 10 })
  const [detailRecord, setDetailRecord] = useState<ImageRecord | null>(null)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [form] = Form.useForm<{ image_urls: string[] }>()

  const { data, isLoading } = useImageList({
    limit: page.pageSize,
    offset: (page.current - 1) * page.pageSize,
  })
  const deleteImage = useDeleteImage()
  const ingestFaces = useIngestFaces()

  const handleDelete = (id: string) => {
    deleteImage.mutate(id, {
      onSuccess: () => message.success('Đã xoá ảnh'),
      onError: (err) => message.error(err instanceof Error ? err.message : 'Xoá thất bại'),
    })
  }

  const showIngestResult = (result: FaceIngestResponse) => {
    const ok = result.results.filter((r) => !r.error)
    const failed = result.results.filter((r) => r.error)
    notification.open({
      message: `Đã lưu ${result.total_faces_added} khuôn mặt từ ${ok.length} ảnh`,
      description: (
        <Flex vertical gap={4}>
          {ok.map((r) => (
            <Typography.Text key={r.image_url}>
              <Tag color="success">✓</Tag> {r.face_count} khuôn mặt — {r.image_url}
            </Typography.Text>
          ))}
          {failed.map((r) => (
            <Typography.Text key={r.image_url} type="danger">
              <Tag color="error">✗</Tag> {r.error} — {r.image_url}
            </Typography.Text>
          ))}
        </Flex>
      ),
      duration: 8,
    })
  }

  const handleIngestSubmit = async () => {
    const values = await form.validateFields()
    const image_urls = values.image_urls.map((u) => u.trim()).filter(Boolean)
    if (image_urls.length === 0) {
      message.warning('Nhập ít nhất 1 URL ảnh')
      return
    }
    ingestFaces.mutate(
      { image_urls },
      {
        onSuccess: (result) => {
          setIngestOpen(false)
          form.resetFields()
          showIngestResult(result)
        },
        onError: (err) => {
          message.error(err instanceof Error ? err.message : 'Trích xuất thất bại')
        },
      },
    )
  }

  const columns: ColumnsType<ImageRecord> = [
    {
      title: 'Preview',
      key: 'preview',
      width: 90,
      render: (_, record) => (
        <Image
          src={record.image_url}
          width={64}
          height={64}
          style={{ objectFit: 'cover', borderRadius: 6 }}
          alt="preview"
        />
      ),
    },
    {
      title: 'Ảnh gốc',
      dataIndex: 'image_url',
      key: 'image_url',
      ellipsis: true,
      render: (url: string) => (
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      ),
    },
    {
      title: 'Khuôn mặt',
      dataIndex: 'face_count',
      key: 'face_count',
      width: 120,
      render: (count: number) => <Tag color={count > 0 ? 'green' : 'default'}>{count} khuôn mặt</Tag>,
    },
    {
      title: 'Lưu lúc',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (iso: string) => new Date(iso).toLocaleString('vi-VN'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Flex gap={8}>
          <Button size="small" onClick={() => setDetailRecord(record)}>
            Xem chi tiết
          </Button>
          <Popconfirm
            title="Xoá ảnh này khỏi database?"
            onConfirm={() => handleDelete(record.id)}
            okText="Xoá"
            okButtonProps={{ danger: true }}
            cancelText="Huỷ"
          >
            <Button size="small" danger loading={deleteImage.isPending}>
              Xoá
            </Button>
          </Popconfirm>
        </Flex>
      ),
    },
  ]

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Face Database
        </Typography.Title>
        <Button
          type="primary"
          onClick={() => {
            form.resetFields()
            setIngestOpen(true)
          }}
        >
          Thêm
        </Button>
      </Flex>

      <Card>
        <Table<ImageRecord>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          columns={columns}
          pagination={{
            current: page.current,
            pageSize: page.pageSize,
            total: data?.total ?? 0,
            onChange: (current, pageSize) => setPage({ current, pageSize }),
            showSizeChanger: true,
          }}
        />
      </Card>

      <Drawer
        title="Chi tiết ảnh"
        width={720}
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        destroyOnHidden
      >
        {detailRecord && (
          <Flex vertical gap={12}>
            <Space>
              <Tag color={detailRecord.face_count > 0 ? 'green' : 'default'}>
                {detailRecord.face_count} khuôn mặt
              </Tag>
              <Typography.Text type="secondary">
                {detailRecord.image_width} x {detailRecord.image_height}px
              </Typography.Text>
            </Space>

            <FaceBoundingBoxOverlay
              imageUrl={detailRecord.image_url}
              imageWidth={detailRecord.image_width}
              imageHeight={detailRecord.image_height}
              faces={detailRecord.faces.map((f, idx) => ({
                id: idx,
                bbox: f.bbox,
                det_score: f.det_score,
              }))}
              maxWidth={680}
            />

            <Flex vertical gap={4}>
              <Typography.Text>
                <strong>Lưu lúc:</strong> {new Date(detailRecord.created_at).toLocaleString('vi-VN')}
              </Typography.Text>
              <Typography.Text>
                <strong>Ảnh gốc:</strong>{' '}
                <a href={detailRecord.image_url} target="_blank" rel="noreferrer">
                  {detailRecord.image_url}
                </a>
              </Typography.Text>
            </Flex>
          </Flex>
        )}
      </Drawer>

      <Modal
        title="Thêm ảnh vào Face Database"
        open={ingestOpen}
        onCancel={() => setIngestOpen(false)}
        onOk={handleIngestSubmit}
        okText="Trích xuất & Lưu"
        cancelText="Huỷ"
        confirmLoading={ingestFaces.isPending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Nhập danh sách URL ảnh. Mỗi ảnh sẽ được trích xuất toàn bộ khuôn mặt và lưu vào Qdrant theo ảnh.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ image_urls: [''] }}>
          <Form.List name="image_urls">
            {(fields, { add, remove }) => (
              <Flex vertical gap={8}>
                {fields.map((field, index) => (
                  <Form.Item
                    {...field}
                    key={field.key}
                    rules={[{ required: true, whitespace: true, message: 'Nhập URL ảnh hoặc xoá dòng này' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      placeholder="https://example.com/photo.jpg"
                      addonAfter={
                        fields.length > 1 ? (
                          <MinusCircleOutlined
                            onClick={() => remove(index)}
                            style={{ color: 'var(--ant-color-error)' }}
                          />
                        ) : null
                      }
                    />
                  </Form.Item>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>
                  Thêm URL
                </Button>
              </Flex>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Flex>
  )
}
