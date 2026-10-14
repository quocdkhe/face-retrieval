// Crawl toàn bộ URL trong thuộc tính src của thẻ <img> từ
// https://dantri.com.vn/thoi-su/chinh-tri/trang-N.htm (N = 1..số trang nhập vào),
// chỉ lấy các thẻ <img> có class "thumb-img" (ảnh bài viết, bỏ logo/icon).
// Chạy: node scripts/crawl-dantri-images.js [số_trang] [file_output.txt]

import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'

const IMG_CLASS = 'thumb-img'
const BASE_URL = 'https://dantri.com.vn/d-buzz'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = 15000
const MAX_RETRIES = 3
const DELAY_BETWEEN_PAGES_MS = 500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function askPageCount() {
  const arg = process.argv[2]
  let raw = arg
  if (raw === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    raw = await rl.question('Nhập số trang cần crawl (vd 20 => trang-1 ... trang-20): ')
    rl.close()
  }
  const n = Number(String(raw).trim())
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Số trang không hợp lệ: "${raw}" (cần số nguyên >= 1)`)
  }
  return n
}

async function fetchHtml(url) {
  let lastError
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
      })
      if (res.status === 404) return { status: 404, html: '' }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: res.status, html: await res.text() }
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt)
    }
  }
  throw lastError
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

// Ảnh lazy-load (từ trang 2 trở đi) để src rỗng/placeholder và đặt URL thật ở data-src.
const SRC_ATTRS = ['src', 'data-src', 'data-original', 'data-lazy-src']

function getAttr(tag, name) {
  // (?<![\w-]) để "src" không khớp nhầm "data-src"; hỗ trợ "..." '...' hoặc không ngoặc
  const re = new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = tag.match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : ''
}

function extractImgSrcs(html, pageUrl) {
  const urls = []
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!getAttr(tag[0], 'class').split(/\s+/).includes(IMG_CLASS)) continue
    for (const attr of SRC_ATTRS) {
      const value = getAttr(tag[0], attr)
      if (!value) continue
      const src = decodeEntities(value)
      if (src.startsWith('data:')) continue
      try {
        const abs = new URL(src, pageUrl).href
        if (/^https?:/i.test(abs)) {
          urls.push(abs)
          break
        }
      } catch {
        // bỏ qua URL hỏng
      }
    }
  }
  return urls
}

async function main() {
  const total = await askPageCount()
  const outFile = resolve(process.argv[3] ?? 'dantri-images.txt')
  const seen = new Set()
  const failedPages = []

  for (let page = 1; page <= total; page++) {
    const url = `${BASE_URL}/trang-${page}.htm`
    try {
      const { status, html } = await fetchHtml(url)
      if (status === 404) {
        console.log(`[${page}/${total}] 404 - hết trang, dừng.`)
        break
      }
      const before = seen.size
      for (const u of extractImgSrcs(html, url)) seen.add(u)
      console.log(`[${page}/${total}] +${seen.size - before} ảnh mới (tổng ${seen.size})`)
    } catch (err) {
      failedPages.push(page)
      console.error(`[${page}/${total}] LỖI: ${err.message}`)
    }
    if (page < total) await sleep(DELAY_BETWEEN_PAGES_MS)
  }

  writeFileSync(outFile, [...seen].join('\n') + (seen.size ? '\n' : ''), 'utf8')
  console.log(`\nĐã ghi ${seen.size} URL vào ${outFile}`)
  if (failedPages.length) {
    console.warn(`Các trang lỗi (cần chạy lại): ${failedPages.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
