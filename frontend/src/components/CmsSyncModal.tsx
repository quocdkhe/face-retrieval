import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Checkbox, Flex, Input, InputNumber, Modal, Progress, Select, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useRef, useState } from 'react'

import { facesApi } from '@/api/faces'
import { cmsApi } from '@/api/cms'
import type { CmsPhoto } from '@/types/cms'

const DEFAULT_CMS_URL = 'https://api-cms.dantri.dev/photos?page=1'
/** CMS chỉ cho tối đa 100 ảnh / lần query (`limit`). */
const BATCH_SIZE = 100
const MAX_ERROR_LOG = 200
/** Từ khoá mặc định: ảnh có tên file chứa các từ này là ảnh đã crop/chỉnh sửa, không phải ảnh gốc. */
const DEFAULT_EXCLUDE_KEYWORDS = ['cropped', 'crop', 'edited']

type RowStatus = 'pending' | 'processing' | 'success' | 'skipped' | 'error'

interface SyncRow {
  id: string
  image_url: string
  name?: string
  status: RowStatus
  face_count?: number
  error?: string
}

interface Stats {
  /** Số ảnh đã quét xong (thành công + bỏ qua + lỗi). */
  scanned: number
  saved: number
  faces: number
  skipped: number
  /** Ảnh bị loại vì tên file chứa từ khoá loại trừ (cropped/crop/edited...) — không gửi xuống BE. */
  excluded: number
  errors: number
  batchesDone: number
  batchesTotal: number
  /** Page CMS đang/đã xử lý gần nhất — dùng để chạy tiếp từ đó khi bị dừng. */
  currentPage: number | null
}

const EMPTY_STATS: Stats = {
  scanned: 0,
  saved: 0,
  faces: 0,
  skipped: 0,
  excluded: 0,
  errors: 0,
  batchesDone: 0,
  batchesTotal: 0,
  currentPage: null,
}

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; reason: 'completed' | 'stopped' | 'end_of_data' }
  | { status: 'error'; message: string }

interface CmsSyncModalProps {
  open: boolean
  onClose: () => void
}

function parseCmsUrl(raw: string): { base: URL; startPage: number } {
  const base = new URL(raw.trim())
  const page = Number(base.searchParams.get('page'))
  return { base, startPage: Number.isInteger(page) && page >= 1 ? page : 1 }
}

/** Ảnh bị loại: tên file (của fullUrl, name hoặc originalName) chứa 1 trong các từ khoá (không phân biệt hoa/thường). */
function matchesExcludeKeyword(photo: CmsPhoto, keywords: string[]): boolean {
  if (keywords.length === 0) return false
  let urlFileName = ''
  try {
    urlFileName = decodeURIComponent(new URL(photo.fullUrl).pathname.split('/').pop() ?? '')
  } catch {
    urlFileName = photo.fullUrl ?? ''
  }
  const names = [urlFileName, photo.name, photo.originalName].filter((n): n is string => !!n).map((n) => n.toLowerCase())
  return keywords.some((k) => names.some((n) => n.includes(k)))
}

function pageUrl(base: URL, page: number): string {
  const u = new URL(base)
  u.searchParams.set('limit', String(BATCH_SIZE))
  u.searchParams.set('page', String(page))
  return u.toString()
}

export default function CmsSyncModal({ open, onClose }: CmsSyncModalProps) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(DEFAULT_CMS_URL)
  const [token, setToken] = useState('')
  const [totalImages, setTotalImages] = useState<number>(BATCH_SIZE)
  const [onlyWithFaces, setOnlyWithFaces] = useState(true)
  const [skipExcluded, setSkipExcluded] = useState(true)
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(DEFAULT_EXCLUDE_KEYWORDS)
  const [runState, setRunState] = useState<RunState>({ status: 'idle' })
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  /** Chỉ giữ rows của batch hiện tại (≤100) để UI không nặng khi chạy hàng chục nghìn ảnh. */
  const [rows, setRows] = useState<SyncRow[]>([])
  const [errorLog, setErrorLog] = useState<{ id: string; message: string }[]>([])
  const stopRef = useRef(false)

  const isRunning = runState.status === 'running'
  const batchesPlanned = Math.ceil((totalImages || 0) / BATCH_SIZE)

  const updateRow = (id: string, patch: Partial<SyncRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  const bump = (patch: Partial<Record<Exclude<keyof Stats, 'currentPage'>, number>>) => {
    setStats((prev) => {
      const next = { ...prev }
      for (const [key, value] of Object.entries(patch) as [Exclude<keyof Stats, 'currentPage'>, number][]) {
        next[key] = prev[key] + value
      }
      return next
    })
  }

  const handleClose = () => {
    if (isRunning) return
    onClose()
    setRunState({ status: 'idle' })
    setStats(EMPTY_STATS)
    setRows([])
    setErrorLog([])
  }

  const handleSync = async () => {
    if (!token.trim() || !totalImages || totalImages < 1) return

    let parsed: ReturnType<typeof parseCmsUrl>
    try {
      parsed = parseCmsUrl(url)
    } catch {
      setRunState({ status: 'error', message: 'URL CMS không hợp lệ' })
      return
    }

    const batchesTotal = Math.ceil(totalImages / BATCH_SIZE)
    stopRef.current = false
    setRunState({ status: 'running' })
    setStats({ ...EMPTY_STATS, batchesTotal })
    setRows([])
    setErrorLog([])

    const seen = new Set<string>()
    const keywords = skipExcluded
      ? Array.from(new Set(excludeKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean)))
      : []
    let remaining = totalImages
    let endedBecause: 'completed' | 'stopped' | 'end_of_data' = 'completed'

    try {
      for (let b = 0; b < batchesTotal && remaining > 0; b++) {
        if (stopRef.current) {
          endedBecause = 'stopped'
          break
        }
        const page = parsed.startPage + b
        setStats((prev) => ({ ...prev, currentPage: page }))

        let photos: CmsPhoto[]
        try {
          const data = await cmsApi.fetchPhotos(pageUrl(parsed.base, page), token.trim())
          photos = data.photos ?? []
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Crawl CMS thất bại, kiểm tra URL/token'
          setRunState({ status: 'error', message: `Page ${page}: ${message}` })
          return
        }

        const fetchedCount = photos.length
        // CMS luôn trả theo page 100; batch cuối chỉ lấy phần còn thiếu của số lượng nhập.
        const window = photos.slice(0, remaining)
        remaining -= window.length
        const candidates = window.filter((p) => !matchesExcludeKeyword(p, keywords))
        const excludedCount = window.length - candidates.length
        const batch = candidates.filter((p) => !!p.fullUrl && !seen.has(p.id))
        batch.forEach((p) => seen.add(p.id))
        if (excludedCount > 0) bump({ scanned: excludedCount, excluded: excludedCount })
        // Ảnh thiếu fullUrl hoặc trùng id (CMS dịch trang giữa các lần query) tính là bỏ qua.
        const dropped = candidates.length - batch.length
        if (dropped > 0) bump({ scanned: dropped, skipped: dropped })

        setRows(
          batch.map((p) => ({
            id: p.id,
            image_url: p.fullUrl,
            name: p.name ?? p.originalName,
            status: 'pending' as const,
          })),
        )

        for (const photo of batch) {
          if (stopRef.current) {
            endedBecause = 'stopped'
            break
          }
          updateRow(photo.id, { status: 'processing' })
          try {
            const result = await facesApi.ingest({
              items: [{ id: photo.id, image_url: photo.fullUrl }],
              only_with_faces: onlyWithFaces,
            })
            const item = result.results[0]
            if (item?.error) {
              updateRow(photo.id, { status: 'error', error: item.error })
              bump({ scanned: 1, errors: 1 })
              setErrorLog((prev) => [...prev, { id: photo.id, message: item.error as string }].slice(-MAX_ERROR_LOG))
            } else if (item?.skipped) {
              updateRow(photo.id, { status: 'skipped', face_count: 0 })
              bump({ scanned: 1, skipped: 1 })
            } else {
              const faces = item?.face_count ?? 0
              updateRow(photo.id, { status: 'success', face_count: faces })
              bump({ scanned: 1, saved: 1, faces })
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Lưu thất bại'
            updateRow(photo.id, { status: 'error', error: message })
            bump({ scanned: 1, errors: 1 })
            setErrorLog((prev) => [...prev, { id: photo.id, message }].slice(-MAX_ERROR_LOG))
          }
        }
        if (endedBecause === 'stopped') break

        bump({ batchesDone: 1 })
        // CMS hết dữ liệu: trả ít hơn 1 batch đầy đủ → không còn page tiếp theo.
        if (fetchedCount < BATCH_SIZE) {
          endedBecause = 'end_of_data'
          break
        }
      }
      setRunState({ status: 'done', reason: endedBecause })
    } finally {
      queryClient.invalidateQueries({ queryKey: ['faces'] })
    }
  }

  const progressPercent = totalImages > 0 ? Math.min(100, Math.round((stats.scanned / totalImages) * 100)) : 0

  const columns: ColumnsType<SyncRow> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 110, ellipsis: true },
    { title: 'Tên', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 220,
      render: (_, row) => {
        if (row.status === 'pending') return <Tag>Chờ xử lý</Tag>
        if (row.status === 'processing') return <Tag color="processing">Đang embed...</Tag>
        if (row.status === 'success') return <Tag color="success">{row.face_count} khuôn mặt</Tag>
        if (row.status === 'skipped') return <Tag>Bỏ qua (không có mặt)</Tag>
        return <Tag color="error">{row.error}</Tag>
      },
    },
  ]

  const doneAlert = () => {
    if (runState.status !== 'done') return null
    if (runState.reason === 'stopped') {
      return (
        <Alert
          type="warning"
          showIcon
          message="Đã dừng theo yêu cầu"
          description={
            stats.currentPage
              ? `Dừng ở page ${stats.currentPage}. Muốn chạy tiếp, đặt page=${stats.currentPage} trong URL CMS (ảnh đã lưu sẽ được ghi đè, không bị trùng).`
              : undefined
          }
        />
      )
    }
    if (runState.reason === 'end_of_data') {
      return <Alert type="info" showIcon message="CMS đã hết ảnh trước khi đủ số lượng yêu cầu" />
    }
    return <Alert type="success" showIcon message="Hoàn tất đồng bộ" />
  }

  return (
    <Modal
      title="Đồng bộ ảnh từ CMS"
      open={open}
      onCancel={handleClose}
      onOk={handleSync}
      okText="Crawl & Đồng bộ"
      cancelText="Đóng"
      confirmLoading={isRunning}
      okButtonProps={{ disabled: isRunning || !token.trim() || !totalImages }}
      cancelButtonProps={{ disabled: isRunning }}
      closable={!isRunning}
      maskClosable={!isRunning}
      width={760}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Quét ảnh từ CMS theo từng batch {BATCH_SIZE} ảnh, trích xuất khuôn mặt và lưu vào Qdrant theo đúng{' '}
          <code>id</code> của CMS (đồng bộ lại cùng ảnh sẽ ghi đè, không bị trùng).
        </Typography.Paragraph>

        <Flex vertical gap={4}>
          <Typography.Text>URL CMS</Typography.Text>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_CMS_URL}
            disabled={isRunning}
          />
          <Typography.Text type="secondary">
            <code>limit</code> luôn được đặt thành {BATCH_SIZE}; <code>page</code> trong URL là page bắt đầu
            (mặc định 1).
          </Typography.Text>
        </Flex>

        <Flex vertical gap={4}>
          <Typography.Text>Số lượng ảnh cần quét</Typography.Text>
          <Flex align="center" gap={12}>
            <InputNumber
              min={1}
              step={BATCH_SIZE}
              precision={0}
              value={totalImages}
              onChange={(v) => setTotalImages(v ?? 0)}
              disabled={isRunning}
              style={{ width: 160 }}
            />
            <Typography.Text type="secondary">
              {batchesPlanned > 0 ? `= ${batchesPlanned} batch × tối đa ${BATCH_SIZE} ảnh` : ''}
            </Typography.Text>
          </Flex>
          <Typography.Text type="secondary">
            Đây là số ảnh được <strong>quét</strong> từ CMS, không phải số ảnh có khuôn mặt cần thu thập — bật
            lọc thì số ảnh thực sự lưu có thể ít hơn.
          </Typography.Text>
        </Flex>

        <Checkbox
          checked={onlyWithFaces}
          onChange={(e) => setOnlyWithFaces(e.target.checked)}
          disabled={isRunning}
        >
          Chỉ lưu ảnh có khuôn mặt (bỏ qua ảnh không có mặt)
        </Checkbox>

        <Flex vertical gap={4}>
          <Checkbox
            checked={skipExcluded}
            onChange={(e) => setSkipExcluded(e.target.checked)}
            disabled={isRunning}
          >
            Bỏ qua ảnh đã crop/chỉnh sửa (tên file chứa từ khoá bên dưới, không gửi xuống BE)
          </Checkbox>
          <Select
            mode="tags"
            value={excludeKeywords}
            onChange={setExcludeKeywords}
            tokenSeparators={[',', ' ']}
            placeholder="Nhập từ khoá rồi Enter"
            disabled={isRunning || !skipExcluded}
            open={false}
            suffixIcon={null}
          />
          <Typography.Text type="secondary">
            So khớp chuỗi con, không phân biệt hoa/thường, trên tên file ảnh, <code>name</code> và{' '}
            <code>originalName</code>. Lưu ý từ khoá ngắn như <code>crop</code> cũng khớp trong từ khác.
          </Typography.Text>
        </Flex>

        <Flex vertical gap={4}>
          <Typography.Text>
            Bearer token <Typography.Text type="danger">*</Typography.Text>
          </Typography.Text>
          <Input.Password
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Nhập access token của CMS"
            disabled={isRunning}
          />
        </Flex>

        {runState.status === 'error' && (
          <Alert type="error" showIcon message="Đồng bộ dừng do lỗi" description={runState.message} />
        )}
        {doneAlert()}

        {(isRunning || stats.scanned > 0 || runState.status === 'done') && (
          <Flex vertical gap={8}>
            <Progress percent={progressPercent} status={isRunning ? 'active' : undefined} />
            <Flex gap={8} wrap align="center" justify="space-between">
              <Flex gap={8} wrap>
                <Tag>
                  Batch {stats.batchesDone}/{stats.batchesTotal}
                  {stats.currentPage ? ` (page ${stats.currentPage})` : ''}
                </Tag>
                <Tag>Đã quét {stats.scanned}</Tag>
                <Tag color="success">Đã lưu {stats.saved} ảnh</Tag>
                <Tag color="success">{stats.faces} khuôn mặt</Tag>
                <Tag>Bỏ qua {stats.skipped}</Tag>
                {skipExcluded && <Tag>Đã lọc {stats.excluded}</Tag>}
                <Tag color={stats.errors > 0 ? 'error' : 'default'}>Lỗi {stats.errors}</Tag>
              </Flex>
              {isRunning && (
                <Button
                  danger
                  size="small"
                  onClick={() => {
                    stopRef.current = true
                  }}
                >
                  Dừng
                </Button>
              )}
            </Flex>
            <Table<SyncRow>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={rows}
              pagination={{ pageSize: 8 }}
              scroll={{ y: 320 }}
            />
            {errorLog.length > 0 && (
              <Alert
                type="error"
                message={`Ảnh lỗi (${errorLog.length}${stats.errors > errorLog.length ? `/${stats.errors}, chỉ giữ ${MAX_ERROR_LOG} gần nhất` : ''})`}
                description={
                  <Flex vertical gap={2} style={{ maxHeight: 140, overflow: 'auto' }}>
                    {errorLog.map((e, i) => (
                      <Typography.Text key={`${e.id}-${i}`} type="danger">
                        {e.id}: {e.message}
                      </Typography.Text>
                    ))}
                  </Flex>
                }
              />
            )}
          </Flex>
        )}
      </Flex>
    </Modal>
  )
}
