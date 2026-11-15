import { NextResponse } from 'next/server'
import { inspectPdf, maxPdfBytes, renderPdfPage } from '../../../lib/pdf'
import { changeState, readPdf, readState } from '../../../lib/store'
import { apply, canSee, ensure, id, pendingPdfFeedback, people, publishPendingPdfFeedback, view, WorkflowError } from '../../../lib/workflow'
import { modelReady, synthesizeReview } from '../../../lib/generation'
import { runDocumentVerification } from '../../../lib/run-document-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function actorFor(request) {
  const actor = request.headers.get('x-khala-actor') ?? 'writer'
  ensure(Object.hasOwn(people, actor), '사용자를 확인하세요.', 403)
  return actor
}

function failure(error) {
  if (!(error instanceof WorkflowError)) console.error(error)
  return NextResponse.json({ error: error instanceof WorkflowError ? error.message : 'PDF를 처리하지 못했어요.' }, { status: error instanceof WorkflowError ? error.status : 500 })
}

export async function POST(request) {
  try {
    const actor = actorFor(request)
    ensure(Number(request.headers.get('content-length')) <= maxPdfBytes + 65536, '20MB 이하의 PDF를 올려주세요.', 413)
    const form = await request.formData()
    const file = form.get('pdf')
    ensure(file instanceof File && file.size > 0, 'PDF 파일을 선택하세요.')
    ensure(file.size <= maxPdfBytes, '20MB 이하의 PDF를 올려주세요.', 413)
    const doc = form.get('doc')
    const base = Number(form.get('base'))
    const workType = form.get('workType')
    if (doc) {
      const item = (await readState()).docs.find((draft) => draft.id === doc)
      ensure(item?.owner === actor && ['draft', 'changes'].includes(item.status), '작성 중인 자기 PDF만 교체할 수 있어요.', 403)
      ensure(item.revisions.at(-1).number === base, '문서가 변경됐어요. 최신 버전에서 다시 시도하세요.', 409)
    }
    const content = Buffer.from(await file.arrayBuffer())
    const name = file.name.slice(0, 200)
    const pdf = { id: id(), name, pages: await inspectPdf(content) }
    const snapshot = doc ? await readState() : null
    const pending = snapshot && pendingPdfFeedback(snapshot).find(({ doc: item }) => item.id === doc)
    const synthesis = pending && await synthesizeReview(snapshot, pending.doc, pending.doc.revisions.find((item) => item.number === pending.entry.revision), pending.entry)
    const { state, result } = await changeState((workspace) => {
      if (pending) publishPendingPdfFeedback(workspace, pending.entry.id, synthesis)
      return apply(workspace, actor, {
        op: doc ? 'replacePdf' : 'uploadPdf', doc, base, workType, title: name.replace(/\.pdf$/i, '').slice(0, 150).trim() || 'PDF 문서', pdf,
      })
    }, { id: pdf.id, content })
    const uploaded = state.docs.find((item) => item.id === result)
    const verified = await runDocumentVerification(result, actor, uploaded.revisions.at(-1).number)
    return NextResponse.json({ ...view(verified.state, actor), result, modelReady: modelReady() })
  } catch (error) {
    return failure(error)
  }
}

export async function GET(request) {
  try {
    const actor = actorFor(request)
    const query = request.nextUrl.searchParams
    const doc = (await readState()).docs.find((item) => item.id === query.get('doc'))
    ensure(doc && canSee(doc, actor), '문서를 찾을 수 없어요.', 404)
    const pdf = doc.revisions.find((revision) => revision.pdf?.id === query.get('file'))?.pdf
    ensure(pdf, 'PDF 개정본을 찾을 수 없어요.', 404)
    const page = Number(query.get('page'))
    ensure(!query.has('page') || pdf.pages.some((item) => item.page === page), 'PDF 페이지를 찾을 수 없어요.', 404)
    const content = await readPdf(pdf.id)
    ensure(content, 'PDF 원본을 찾을 수 없어요.', 404)
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
    if (page) {
      return new Response(await renderPdfPage(content, page), { headers: { ...headers, 'Content-Type': 'image/png' } })
    }
    return new Response(content, { headers: {
      ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pdf.name).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16))}`,
    } })
  } catch (error) {
    return failure(error)
  }
}
