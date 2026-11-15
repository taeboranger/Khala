import assert from 'node:assert/strict'
import test from 'node:test'
import { draftProposal, generate } from '../lib/generation.js'
import { apply, cardList, current, guideFor, guidesFor, guideStructure, newState, pdfCards, view } from '../lib/workflow.js'

test('unassigned reviewers cannot read or mutate document proposals', () => {
  const state=newState()
  const doc=apply(state,'writer',{op:'create',title:'담당자 한정 문서',market:'SaaS',purpose:'시장 확인'})
  state.docs.find(item=>item.id===doc).submissions.push({revision:1,at:new Date().toISOString()})
  state.proposals.push({id:'private-proposal',doc,author:'reviewer',published:null,issue:'담당 문서 원문'})
  assert.equal(view(state,'reviewer').proposals.length,1)
  assert.equal(view(state,'peer').proposals.length,0)
  for(const op of ['saveProposal','testProposal','publish']) assert.throws(()=>apply(state,'peer',{op,proposal:'private-proposal'}),{status:403})
})

test('both feedback paths publish guides and required checks gate calculation and approval', async () => {
  delete process.env.OPENAI_API_KEY
  process.env.KHALA_AI_PROVIDER = 'disabled'
  const state = newState()
  const create = (actor, sample) => {
    const id = apply(state, actor, { op: 'create', sample, title: '보고서', market: 'SaaS', purpose: '시장 확인' })
    return state.docs.find((doc) => doc.id === id)
  }
  const act = (doc, actor, op, body = {}) => apply(state, actor, { ...body, op, doc: doc.id, base: current(doc).number })
  const add = async (doc, prompt) => {
    const result = await generate(state, doc, { prompt })
    act(doc, doc.owner, 'generation', { result })
    act(doc, doc.owner, 'adopt', { generation: result.id })
    return current(doc).blocks.at(-1).id
  }
  const verify = (doc, actor, block, key) => act(doc, actor, 'verify', {
    block, key, status: 'pass', evidence: '등록한 원문 발췌', reason: '두 출처의 원문에서 기준을 대조함',
  })
  const publish = async (doc, actor, body, expected) => {
    const rule = await draftProposal(state, doc, actor, body)
    const proposal = act(doc, actor, 'proposal', { ...body, rule })
    assert.equal(rule.field, expected)
    assert.throws(() => apply(state, 'reviewer', { op: 'publish', proposal }), { status: 409 })
    apply(state, actor, { op: 'testProposal', proposal })
    assert.equal(state.proposals.at(-1).test.passed, true)
    assert.throws(() => apply(state, 'peer', { op: 'publish', proposal }), { status: 403 })
    apply(state, 'reviewer', { op: 'publish', proposal })
  }

  const legacy = create('writer', 'scope')
  const legacyBlock = await add(legacy, 'A기관과 B기관 자료의 성장률을 넣어줘')
  verify(legacy, 'writer', legacyBlock, 'citation')
  assert.equal(current(legacy).blocks.at(-1).result, 50)
  act(legacy, 'writer', 'submit')
  assert.equal(view(state, 'peer').docs.length, 0)
  const feedback = act(legacy, 'reviewer', 'feedback', {
    block: legacyBlock, row: 'B', issue: '시장 범위 불일치', evidence: 'A는 국내, B는 글로벌', action: '비교 자료 교체',
  })
  await publish(legacy, 'reviewer', { feedback }, 'scope')

  const self = create('reviewer', 'metric')
  assert.equal(self.version, 2)
  const selfBlock = await add(self, 'A기관과 B기관 성장률')
  assert.deepEqual(cardList(current(self), guideFor(state, self), current(self).blocks.at(-1)).map((card) => card.key), ['citation', 'scope', 'growth'])
  await publish(self, 'reviewer', { block: selfBlock, issue: '지표 정의 불일치', evidence: 'A는 매출액, B는 거래액' }, 'metric')
  assert.equal(self.submissions.length, 0)
  assert.equal(legacy.version, 1)
  assert.equal(legacy.revisions.find((revision) => revision.number === legacy.submissions[0].revision).blocks.at(-1).result, 50)

  const normal = create('writer', 'normal')
  assert.equal(normal.version, 3)
  await assert.rejects(generate(state, normal, { prompt: '성장률을 넣어줘' }), { status: 422 })
  assert.deepEqual((await generate(state, normal, { prompt: 'A기관 자료를 요약해줘' })).plan.keys, ['citation'])
  const block = await add(normal, 'A기관과 B기관의 성장률을 넣어줘')
  for (const key of ['citation', 'scope', 'metric']) verify(normal, 'writer', block, key)
  assert.equal(current(normal).blocks.at(-1).result, 50)
  const source = current(normal).sources[1]
  act(normal, 'writer', 'source', { ...source, source: source.id, value: 1920, excerpt: '수정본 1920억 원' })
  assert.equal(current(normal).blocks.at(-1).result, null)
  assert.equal(current(normal).verifications[block].metric.status, 'stale')
  act(normal, 'writer', 'submit')
  assert.throws(() => act(normal, 'reviewer', 'approve'), { status: 409 })
  for (const key of ['citation', 'scope', 'metric']) verify(normal, 'reviewer', block, key)
  assert.equal(current(normal).blocks.at(-1).result, 60)
  act(normal, 'reviewer', 'approve')
  assert.equal(normal.status, 'approved')

  const mismatch = create('writer', 'metric')
  const mismatchBlock = await add(mismatch, 'A기관과 B기관의 성장률을 넣어줘')
  assert.throws(() => verify(mismatch, 'writer', mismatchBlock, 'metric'), { status: 409 })
  assert.equal(current(mismatch).blocks.at(-1).result, null)
})

test('PDF feedback publishes a synthesized version once and corrected PDFs retain historical guides', () => {
  const state = newState()
  const pdf = { id: 'original', name: 'test.pdf', pages: [{ page: 1, text: 'growth rate', growth: 'growth rate' }] }
  const docId = apply(state, 'writer', { op: 'uploadPdf', title: 'PDF', pdf, workType: 'market' })
  const doc = state.docs.find((item) => item.id === docId)
  const act = (actor, op, body = {}) => apply(state, actor, { ...body, op, doc: docId, base: current(doc).number })
  act('writer', 'submit')
  const body = { page: 1, issue: '시장 범위 불일치', evidence: '국내와 글로벌', action: '비교 자료 교체', requestChanges: true,
    synthesis: { mode: 'llm', baseVersion: 1, summary: '비교 전 범위를 확인합니다.', rules: [
      { field: 'scope', title: '시장 범위 확인', trigger: 'cross_source_growth', context: '같은 시장 범위', procedure: '양쪽 원문의 범위를 대조' },
    ] } }
  act('reviewer', 'feedback', body)
  assert.equal(state.guides.length, 2)
  assert.equal(doc.feedback[0].publishedVersion, 2)
  assert.equal(guidesFor(state, 'general').at(-1).version, 1)
  act('writer', 'replacePdf', { pdf: { ...pdf, id: 'updated' } })
  assert.equal(doc.version, 2)
  assert.equal(guideFor(state, doc, doc.revisions[0]).version, 1)
  assert.equal(guideFor(state, doc).version, 2)
  assert.equal(current(doc).reviewChecks.length, 1)
  assert.ok(pdfCards(current(doc), guideFor(state, doc)).some((card) => card.key === 'scope'))
  act('writer', 'submit')
  assert.throws(() => act('reviewer', 'approve'), { status: 409 })

  const generalId = apply(state, 'writer', { op: 'uploadPdf', title: '일반', workType: 'general', pdf })
  const general = state.docs.find((item) => item.id === generalId)
  assert.deepEqual(pdfCards(current(general), guideFor(state, general)).map((card) => card.key), ['citation'])
  apply(state, 'writer', { op: 'submit', doc: generalId, base: 1 })
  apply(state, 'reviewer', { op: 'feedback', doc: generalId, base: 1, page: 1, issue: '출처 누락', evidence: '원문 확인 필요', action: '출처 추가', requestChanges: true,
    synthesis: { mode: 'pending', reason: '연결 대기' } })
  assert.equal(guidesFor(state, 'general').at(-1).version, 1)
  assert.throws(() => apply(state, 'writer', { op: 'replacePdf', doc: generalId, base: 1, pdf }), { status: 409 })
  apply(state, 'reviewer', { op: 'retryFeedback', doc: generalId, feedback: general.feedback[0].id,
    synthesis: { mode: 'llm', baseVersion: 1, summary: '근거 기준 보완', rules: [{ field: 'citation', trigger: 'pdf_page', title: '출처 검증', context: '출처로 확인', procedure: '원문을 대조' }] } })
  assert.equal(guidesFor(state, 'general').at(-1).version, 2)
  assert.equal(state.guides.length, 2)
  apply(state, 'reviewer', { op: 'retryFeedback', doc: generalId, feedback: general.feedback[0].id })
  assert.equal(guidesFor(state, 'general').length, 2)

  const selfId = apply(state, 'reviewer', { op: 'uploadPdf', title: '리뷰어 직접 작업', workType: 'general', pdf })
  const self = state.docs.find((item) => item.id === selfId)
  apply(state, 'reviewer', { op: 'proposal', doc: selfId, base: 1, page: 1, issue: '근거의 발행일 확인', evidence: '기준일이 서로 다름',
    synthesis: { mode: 'llm', baseVersion: 2, summary: '근거의 시점도 대조합니다.', rules: [
      ...guidesFor(state, 'general').at(-1).rules,
      { field: 'date', title: '근거 시점', trigger: 'pdf_page', context: '주장에 맞는 기준일', procedure: '자료 기준일과 주장 시점을 대조' },
    ] } })
  assert.equal(self.feedback[0].kind, 'self')
  assert.equal(self.feedback[0].publishedVersion, 3)
  assert.match(self.feedback[0].guideSummary, /시점/)
  assert.equal(state.guides.length, 2)

  apply(state, 'reviewer', { op: 'proposal', doc: selfId, base: 1, page: 1, issue: '동시에 들어온 피드백', evidence: '구버전으로 추론됨',
    synthesis: { mode: 'llm', baseVersion: 2, summary: '오래된 응답', rules: [] } })
  assert.equal(guidesFor(state, 'general').length, 3)
  assert.equal(self.feedback.at(-1).synthesisStatus, 'pending')
  assert.match(self.feedback.at(-1).synthesisReason, /최신 규칙/)

  state.guides.at(-1).synthesis = 'local'
  apply(state, 'reviewer', { op: 'retryFeedback', doc: docId, feedback: doc.feedback[0].id,
    synthesis: { mode: 'llm', baseVersion: 2, summary: '기존 로컬 규칙을 맥락에 맞춰 재정리', rules: state.guides.at(-1).rules } })
  assert.equal(doc.feedback[0].publishedVersion, 3)
  assert.deepEqual(doc.feedback[0].previousPublishedVersions, [2])
  assert.equal(state.guides[1].synthesis, 'local')
  assert.equal(state.guides[2].synthesis, 'llm')

  const extraRule = { field: 'denominator', trigger: 'pdf_page', title: '비율의 분모', context: '대상 집단 일치', procedure: '분자와 분모를 대조' }
  const structure = guideStructure({ version: 1, rules: [extraRule] }, 'pdf', 'general')
  assert.equal(structure.base.procedure, '이 페이지의 주요 주장과 수치를 찾고, 근거가 되는 자료의 위치를 기록하세요.')
  assert.equal(structure.additional[0].key, 'denominator')
})
