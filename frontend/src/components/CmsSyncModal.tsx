import { useQueryClient } from '@tanstack/react-query'
import { Alert, Flex, Input, Modal, Progress, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'

import { facesApi } from '@/api/faces'
import { cmsApi } from '@/api/cms'
import type { CmsPhoto } from '@/types/cms'

const DEFAULT_CMS_URL = 'https://api-cms.dantri.dev/photos?limit=60&page=1'

type CrawlState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; count: number }
  | { status: 'error'; message: string }

type RowStatus = 'pending' | 'processing' | 'success' | 'error'

interface SyncRow {
  id: string
  image_url: string
  name?: string
  status: RowStatus
  face_count?: number
  error?: string
}

interface CmsSyncModalProps {
  open: boolean
  onClose: () => void
}

export default function CmsSyncModal({ open, onClose }: CmsSyncModalProps) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(DEFAULT_CMS_URL)
  const [token, setToken] = useState('')
  const [crawlState, setCrawlState] = useState<CrawlState>({ status: 'idle' })
  const [rows, setRows] = useState<SyncRow[]>([])
  const [isSyncing, setIsSyncing] = useState(false)

  const isBusy = crawlState.status === 'loading' || isSyncing

  const updateRow = (id: string, patch: Partial<SyncRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const handleClose = () => {
    if (isBusy) return
    onClose()
    setCrawlState({ status: 'idle' })
    setRows([])
  }

  const handleSync = async () => {
    if (!token.trim()) return

    setCrawlState({ status: 'loading' })
    setRows([])

    let photos: CmsPhoto[]
    try {
      const data = await cmsApi.fetchPhotos(url, token.trim())
      photos = (data.photos ?? []).filter((p) => !!p.fullUrl)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Crawl CMS thất bại, kiểm tra URL/token'
      setCrawlState({ status: 'error', message })
      return
    }

    setCrawlState({ status: 'success', count: photos.length })
    const initialRows: SyncRow[] = photos.map((p) => ({
      id: p.id,
      image_url: p.fullUrl,
      name: p.name ?? p.originalName,
      status: 'pending',
    }))
    setRows(initialRows)

    setIsSyncing(true)
    for (const row of initialRows) {
      updateRow(row.id, { status: 'processing' })
      try {
        const result = await facesApi.ingest({ items: [{ id: row.id, image_url: row.image_url }] })
        const item = result.results[0]
        if (item?.error) {
          updateRow(row.id, { status: 'error', error: item.error })
        } else {
          updateRow(row.id, { status: 'success', face_count: item?.face_count ?? 0 })
        }
      } catch (err) {
        updateRow(row.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Lưu thất bại',
        })
      }
    }
    setIsSyncing(false)
    queryClient.invalidateQueries({ queryKey: ['faces'] })
  }

  const doneCount = rows.filter((r) => r.status === 'success' || r.status === 'error').length

  const columns: ColumnsType<SyncRow> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 110, ellipsis: true },
    { title: 'Tên', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 200,
      render: (_, row) => {
        if (row.status === 'pending') return <Tag>Chờ xử lý</Tag>
        if (row.status === 'processing') return <Tag color="processing">Đang embed...</Tag>
        if (row.status === 'success') return <Tag color="success">{row.face_count} khuôn mặt</Tag>
        return <Tag color="error">{row.error}</Tag>
      },
    },
  ]

  return (
    <Modal
      title="Đồng bộ ảnh từ CMS"
      open={open}
      onCancel={handleClose}
      onOk={handleSync}
      okText="Crawl & Đồng bộ"
      cancelText="Đóng"
      confirmLoading={isBusy}
      okButtonProps={{ disabled: isBusy || !token.trim() }}
      cancelButtonProps={{ disabled: isBusy }}
      closable={!isBusy}
      maskClosable={!isBusy}
      width={720}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Crawl danh sách ảnh từ CMS, sau đó trích xuất khuôn mặt + lưu vào Qdrant theo đúng{' '}
          <code>id</code> của CMS (đồng bộ lại nhiều lần với cùng ảnh sẽ ghi đè, không bị trùng).
        </Typography.Paragraph>

        <Flex vertical gap={4}>
          <Typography.Text>URL CMS</Typography.Text>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_CMS_URL}
            disabled={isBusy}
          />
        </Flex>

        <Flex vertical gap={4}>
          <Typography.Text>
            Bearer token <Typography.Text type="danger">*</Typography.Text>
          </Typography.Text>
          <Input.Password
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Nhập access token của CMS"
            disabled={isBusy}
          />
        </Flex>

        {crawlState.status === 'loading' && <Alert type="info" showIcon message="Đang crawl CMS..." />}
        {crawlState.status === 'error' && (
          <Alert type="error" showIcon message="Crawl CMS thất bại" description={crawlState.message} />
        )}
        {crawlState.status === 'success' && (
          <Alert
            type="success"
            showIcon
            message={`Crawl thành công ${crawlState.count} ảnh từ CMS`}
          />
        )}

        {rows.length > 0 && (
          <Flex vertical gap={8}>
            <Progress percent={Math.round((doneCount / rows.length) * 100)} status={isSyncing ? 'active' : undefined} />
            <Table<SyncRow>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={rows}
              pagination={{ pageSize: 8 }}
              scroll={{ y: 320 }}
            />
          </Flex>
        )}
      </Flex>
    </Modal>
  )
}
