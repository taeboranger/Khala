import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { ensure, WorkflowError } from './workflow.js'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const directory = dirname(require.resolve(['pdfjs-dist', 'package.json'].join('/')))
const factoryPath = (asset) => join(directory, asset).replaceAll('\\', '/') + '/'
const options = {
  cMapUrl: factoryPath('cmaps'),
  cMapPacked: true,
  standardFontDataUrl: factoryPath('standard_fonts'),
  wasmUrl: factoryPath('wasm'),
  isEvalSupported: false,
  enableXfa: false,
}
export const maxPdfBytes = 20 * 1024 * 1024

async function openPdf(content) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ ...options, data: Uint8Array.from(content) })
  try {
    return { document: await task.promise, task }
  } catch {
    await task.destroy()
    throw new WorkflowError('PDF를 읽을 수 없어요. 손상되었거나 암호가 설정되어 있는지 확인하세요.', 422)
  }
}

export async function inspectPdf(content) {
  ensure(content.length >= 5 && String.fromCharCode(...content.subarray(0, 5)) === '%PDF-', 'PDF 파일을 선택하세요.', 415)
  const { document, task } = await openPdf(content)
  try {
    ensure(document.numPages > 0 && document.numPages <= 100, '100페이지 이하의 PDF를 올려주세요.', 422)
    const pages = []
    for (let page = 1; page <= document.numPages; page++) {
      const pageData = await document.getPage(page)
      const { items } = await pageData.getTextContent()
      const value = items.map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim()
      const growth = /성장\s*률|증가\s*율|growth\s+rate|\bCAGR\b/i.exec(value)
      pages.push({ page, text: value.slice(0, 12000), truncated: value.length > 12000, growth: growth?.[0] ?? '' })
      pageData.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}

export async function renderPdfPage(content, number) {
  const { document, task } = await openPdf(content)
  try {
    const page = await document.getPage(number)
    const full = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(1600 / full.width, 2000 / full.height, 3) })
    const { canvas, context } = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvasContext: context, viewport, background: '#fff' }).promise
    return canvas.toBuffer('image/png')
  } finally {
    await task.destroy()
  }
}
