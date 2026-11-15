import assert from 'node:assert/strict'
import test from 'node:test'
import { validateVerification, verifyPdfDocument } from '../lib/document-verification.js'
import { apply, current, guideFor, newState, pdfCards } from '../lib/workflow.js'

function fixture() {
  const state = newState()
  const pdf = { id: 'original', name: 'test.pdf', pages: [{ page: 1, text: 'A 국내 매출액 100. B 국내 매출액 150. 누적 변화 50%.', growth: '' }] }
  const id = apply(state, 'writer', { op: 'uploadPdf', title: '검증', workType: 'market', pdf })
  const doc = state.docs.find((doc) => doc.id === id)
  return { state, doc, guide: guideFor(state, doc), act: (actor, op, data = {}) => apply(state, actor, { op, doc: id, base: current(doc).number, ...data }) }
}
const check = (cardId, status = 'pass') => ({ cardId, status, claim: '누적 변화 50%', reason: '원문의 두 수치와 산식을 대조했습니다.', suggestion: '', evidence: [
  { page: 1, quote: 'A 국내 매출액 100.' }, { page: 1, quote: 'B 국내 매출액 150.' },
] })
const response = () => ({ summary: '문서 내부의 수치가 일치합니다.', pages: [{ page: 1, growth: true }], checks: [check('1:citation'), check('1:growth')] })

test('AI determines applicability, grounds quotes, requires complete coverage, and enforces growth dependencies', () => {
  const { doc, guide } = fixture()
  const report = validateVerification(current(doc), guide, response(), 'test-model')
  assert.equal(report.records['1:growth'].status, 'pass')
  assert.equal(report.pageKinds[0].growth, true)
  const fabricated = response()
  fabricated.checks[0].evidence[0].quote = '문서에 없는 수치 900'
  const pending = validateVerification(current(doc), guide, fabricated, 'test-model')
  assert.equal(pending.records['1:citation'].status, 'pending')
  assert.equal(pending.records['1:growth'].status, 'pending')
  const missing = response(); missing.checks.pop()
  assert.throws(() => validateVerification(current(doc), guide, missing, 'test-model'), /누락/)
  const duplicate = response(); duplicate.checks[1].cardId = '1:citation'
  assert.throws(() => validateVerification(current(doc), guide, duplicate, 'test-model'), /중복/)
  const wrongPage = response(); wrongPage.pages[0].page = 2
  assert.throws(() => validateVerification(current(doc), guide, wrongPage, 'test-model'), /페이지/)
})

test('real guide and PDF are passed to inference; unavailable text and provider failures cannot produce passes', async () => {
  const { doc, guide } = fixture()
  let calls = 0
  const runner = async (name, instructions, payload) => {
    calls++
    assert.equal(name, 'pdf_document_verification')
    assert.match(instructions, /untrusted data/)
    assert.equal(payload.pages[0].text, current(doc).pdf.pages[0].text)
    assert.equal(payload.guideVersion, guide.version)
    assert.ok(payload.verificationStructure.base.procedure)
    assert.equal(payload.cards.find((card) => card.cardId === '1:growth').conditionalGrowth, true)
    return { data: response(), model: 'mock' }
  }
  const report = await verifyPdfDocument(doc, guide, runner)
  assert.equal(report.status, 'complete')
  current(doc).pdf.pages[0].truncated = true
  assert.equal((await verifyPdfDocument(doc, guide, runner)).status, 'failed')
  assert.equal(calls, 1)
  current(doc).pdf.pages[0].truncated = false
  const failed = await verifyPdfDocument(doc, guide, async () => { throw new Error('offline') })
  assert.equal(failed.status, 'failed')
  assert.deepEqual(failed.records, {})
})

test('AI results drive approval, human correction invalidates dependent AI checks, reruns reject stale results and replacements clear AI', () => {
  const { doc, guide, act } = fixture()
  act('writer', 'submit')
  assert.throws(() => act('reviewer', 'approve'), /AI 문서 검증/)
  const report = validateVerification(current(doc), guide, response(), 'mock')
  const oldBase = current(doc).number
  act('reviewer', 'verifyPdfWithAi', { aiResult: report })
  assert.ok(pdfCards(current(doc), guide).every((card) => card.status === 'pass'))
  assert.throws(() => act('reviewer', 'verifyPdfWithAi', { base: oldBase, aiResult: report }), { status: 409 })
  act('reviewer', 'verifyPdf', { card: '1:citation', status: 'fail', evidence: '추가 원문', reason: '추가 확인이 필요함' })
  act('reviewer', 'verifyPdf', { card: '1:citation', status: 'pass', evidence: '원문 확인', reason: '추가 확인 완료' })
  assert.equal(pdfCards(current(doc), guide).find((card) => card.key === 'growth').status, 'stale')
  assert.throws(() => act('reviewer', 'approve'), { status: 409 })
  act('reviewer', 'verifyPdfWithAi', { aiResult: report })
  act('reviewer', 'approve')
  assert.equal(doc.status, 'approved')
  assert.throws(() => act('writer', 'verifyPdfWithAi', { aiResult: report }), { status: 403 })

  const f = fixture()
  f.act('writer', 'verifyPdfWithAi', { aiResult: report })
  f.act('writer', 'replacePdf', { pdf: { ...current(f.doc).pdf, id: 'corrected' } })
  assert.equal(current(f.doc).aiVerification, null)
  assert.ok(pdfCards(current(f.doc), f.guide).every((card) => card.status === 'pending'))
  assert.equal(f.doc.revisions[1].aiVerification.status, 'complete')
})
