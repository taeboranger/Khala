import { verifyPdfDocument } from './document-verification.js'
import { apply, canSee, current, ensure, guidesFor, openForReview, withSharedCriteria } from './workflow.js'
import { changeState, readState } from './store.js'
import { chatTransaction, listKnowledge } from './chat-store.js'
import { syncPdfKnowledge } from './chat-knowledge.js'
import { retrieveRag } from './chat-rag.js'

export async function runDocumentVerification(docId, actor, base) {
  const state = await readState()
  const doc = state.docs.find((item) => item.id === docId)
  ensure(doc && canSee(doc, actor), '문서를 찾을 수 없어요.', 404)
  ensure(current(doc).pdf && current(doc).number === base, '문서가 변경됐어요. 최신 PDF에서 다시 검증하세요.', 409)
  ensure((doc.owner === actor && ['draft', 'changes'].includes(doc.status)) || openForReview(doc, actor), '작성자 또는 담당 리뷰어만 AI 검증을 실행할 수 있어요.', 403)
  const knowledge = await chatTransaction(async (tx) => { await syncPdfKnowledge(tx); return listKnowledge(tx) })
  const retrieved = await retrieveRag({ actor, chatId: '00000000-0000-0000-0000-000000000000', workType: doc.workType ?? 'market',
    knowledge, query: current(doc).pdf.pages.map((p) => p.text.slice(0,1500)).join('\n').slice(0,6000) })
  const shared = retrieved.rules.filter((r) => !r.key.startsWith('pdf_')).slice(0,6)
    .map(({ id, version, title, criterion, procedure }) => ({ id, version, title, criterion, procedure }))
  const baseGuide = guidesFor(state, doc.workType).find((g) => g.version === (current(doc).guideVersion ?? doc.version))
  const aiResult = await verifyPdfDocument(doc, { ...withSharedCriteria(baseGuide, shared),
    similarCases: retrieved.cases.map(({ id, situation, problem, resolution, outcome }) => ({ id, situation, problem, resolution, outcome })), rag: retrieved.trace })
  // Inference runs outside the DB lock. The base revision check rejects late results.
  return changeState((workspace) => apply(workspace, actor, { op: 'verifyPdfWithAi', doc: docId, base, aiResult }))
}
