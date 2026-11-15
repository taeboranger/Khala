const demoPeople = {
  writer: { name: '김지우', role: '업무 사용자' },
  reviewer: { name: '이서윤', role: '리뷰어', publish: true },
  peer: { name: '박도현', role: '리뷰어' },
}
let readPeople = () => null
export function registerPeopleReader(reader) { readPeople = reader }
export const people = new Proxy(demoPeople, {
  get: (target, key) => readPeople()?.[key] ?? target[key] ?? { name: '미지정', role: '업무 사용자' },
  ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...Object.keys(readPeople() ?? {})])],
  getOwnPropertyDescriptor: (target, key) => Object.hasOwn(readPeople() ?? {}, key) ? { configurable: true, enumerable: true, value: readPeople()[key] } : Reflect.getOwnPropertyDescriptor(target,key),
})
export const reviewerFor = (actor) => people[actor].reviewerId ?? (Object.hasOwn(demoPeople,actor) ? actor === 'reviewer' ? 'peer' : 'reviewer' : '')

export const fields = { scope: '시장 범위', metric: '지표 정의' }
export const workTypes = { market: '시장조사 보고서', general: '일반 문서' }
const initialGuide = () => ({ version: 1, rules: [], publishedAt: new Date().toISOString() })
const generalBaseline = { version: 1, rules: [] }
export const guidesFor = (state, type) => type === 'general' ? state.generalGuides ?? [generalBaseline] : state.guides
export const checks = {
  citation: { title: '원문과 출처 대조', procedure: '요약 또는 수치가 출처 원문과 일치하는지 확인하세요.' },
  growth: { title: '성장률 계산', procedure: '서버에서 (종료값 − 시작값) ÷ 시작값으로 계산합니다.' },
}

const pdfChecks = {
  citation: { key: 'citation', title: '주장과 근거 대조', procedure: '이 페이지의 주요 주장이나 수치가 출처에 근거하는지 확인하세요.' },
  growth: { key: 'growth', title: '성장률 계산 확인', procedure: 'PDF에 적힌 비교 기간·단위와 시작값·종료값을 원문에서 확인하고 성장률을 다시 계산하세요.' },
}
const generalCitation = {
  key: 'citation', title: '문서 주장과 근거 대조',
  procedure: '이 페이지의 주요 주장과 수치를 찾고, 근거가 되는 자료의 위치를 기록하세요.',
  context: '사실 주장과 수치는 확인 가능한 출처로 뒷받침되어야 합니다.',
}

const sample = (id, label, year, value, scope, metric) => ({
  id, label, year, value, scope, metric, unit: '억 원', url: '',
  excerpt: `${year}년 ${scope} B2B SaaS 시장의 ${metric}은 ${value}억 원입니다.`,
})

export const samples = {
  a: sample('A', 'A기관', 2023, 1200, '국내', '매출액'),
  scope: sample('B', 'B기관', 2025, 1800, '글로벌', '매출액'),
  metric: sample('B', 'B기관', 2025, 1800, '국내', '거래액'),
  normal: sample('B', 'B기관', 2025, 1800, '국내', '매출액'),
}

export const newState = () => ({
  guides: [initialGuide()],
  docs: [],
  proposals: [],
})

export class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function ensure(condition, message, status) {
  if (!condition) throw new WorkflowError(message, status)
}

export function input(value, label, max = 4000) {
  ensure(typeof value === 'string' && value.trim().length > 0, `${label}을(를) 입력하세요.`)
  ensure(value.trim().length <= max, `${label}은(는) ${max}자까지 입력할 수 있어요.`)
  return value.trim()
}

export const id = () => globalThis.crypto.randomUUID()
const now = () => new Date().toISOString()
export const current = (doc) => doc.revisions.at(-1)
export const guideFor = (state, doc, revision = current(doc)) => ({ ...withSharedCriteria(guidesFor(state, doc.workType).find((guide) => guide.version === (revision.guideVersion ?? doc.version)), revision.aiVerification?.sharedCriteria), similarCases: revision.aiVerification?.similarCases ?? [] })
export function withSharedCriteria(guide, criteria = []) {
  if (!criteria.length) return guide
  const citation = guide.rules.find((r) => r.field === 'citation' && r.trigger === 'pdf_page')
  return { ...guide, sharedCriteria: criteria, rules: [...guide.rules.filter((r) => r !== citation), {
    field: 'citation', title: citation?.title ?? '원문과 출처 대조', trigger: 'pdf_page',
    context: [citation?.context ?? '', '다음 조직 기준은 해당 페이지의 주장에 적용되는 경우에만 검증하세요. 무관한 기준 때문에 추가 근거를 요구하지 마세요.', ...criteria.map((r) => `${r.title} (v${r.version}): ${r.criterion}\n${r.procedure}`)].join('\n'),
    procedure: citation?.procedure ?? '주장을 문서의 원문 근거와 대조하고, 관련 조직 기준의 조건을 확인하세요.',
  }] }
}
const isReviewer = (doc, actor) => doc.owner !== actor && doc.reviewer === actor && !!doc.submissions.length
export const canSee = (doc, actor) => doc.owner === actor || isReviewer(doc, actor)

function revise(doc, next, actor) {
  const revision = { ...next, number: current(doc).number + 1, actor, at: now() }
  doc.revisions.push(revision)
  return revision
}

function sourcesFor(revision, ids) {
  const sources = ids.map((sourceId) => revision.sources.find((source) => source.id === sourceId))
  ensure(sources.every(Boolean), '문서에 등록된 출처를 선택하세요.')
  return sources
}

const growthRules = (guide) => guide.rules.filter((rule) => rule.trigger === 'cross_source_growth')

export function executionPlan(guide, action, sourceIds) {
  const rules = action === 'growth' && sourceIds.length === 2 ? growthRules(guide) : []
  return {
    action, sourceIds, version: guide.version,
    keys: ['citation', ...rules.map((rule) => rule.field), ...(action === 'growth' ? ['growth'] : [])],
    rules,
    condition: action === 'growth' ? '서로 다른 두 출처의 수치로 성장률 산출' : '문서 문단 작성 또는 출처 요약',
  }
}

const comparisonCheck = (rule) => ({
  key: rule.field, title: rule.title ?? `${fields[rule.field]} 비교`, procedure: rule.procedure, context: rule.context,
})

export function cardList(revision, guide, block) {
  if (!block.action) return []
  const plan = executionPlan(guide, block.action, block.sourceIds)
  const records = revision.verifications[block.id] ?? {}
  return plan.keys.map((key) => {
    const rule = plan.rules.find((item) => item.field === key)
    const check = rule ? comparisonCheck(rule) : checks[key]
    const record = records[key]
    const status = key === 'growth'
      ? (block.result !== null ? 'pass' : 'pending')
      : record?.status ?? 'pending'
    return { key, ...check, status, record }
  })
}

export function guideStructure(guide, mode = 'pdf', workType) {
  const definitions = mode === 'pdf' ? pdfChecks : checks
  const comparison = growthRules(guide).map(comparisonCheck)
  const citation = mode === 'pdf' ? guide.rules.find((rule) => rule.trigger === 'pdf_page' && rule.field === 'citation') : null
  const baseline = mode === 'pdf' && workType === 'general' ? generalCitation : definitions.citation
  const base = { key: 'citation', ...baseline, ...(citation && { procedure: citation.procedure, context: citation.context }) }
  const growth = { key: 'growth', ...definitions.growth }
  const additional = guide.rules.filter((rule) => rule.trigger === 'pdf_page' && rule.field !== 'citation').map(comparisonCheck)
  return { base, comparison, growth, additional }
}

export function pdfCards(revision, guide) {
  if (!revision.pdf) return []
  const { base, comparison, growth, additional } = guideStructure(guide, 'pdf', revision.workType)
  const cards = []
  for (const page of revision.pdf.pages) {
    const pageChecks = revision.workType !== 'general' && page.growth ? [base, ...additional, ...comparison, growth] : [base, ...additional]
    for (const check of pageChecks) {
      const cardId = `${page.page}:${check.key}`
      const aiRecord = revision.aiVerification?.records?.[cardId]
      const record = revision.verifications[cardId] ?? aiRecord
      cards.push({ ...check, id: cardId, page: page.page, status: record?.status ?? 'pending', record, aiRecord })
    }
  }
  for (const feedback of revision.reviewChecks ?? []) {
    const cardId = `review:${feedback.id}`
    const aiRecord = revision.aiVerification?.records?.[cardId]
    const record = revision.verifications[cardId] ?? aiRecord
    cards.push({
      id: cardId, key: 'review', page: Math.min(feedback.page, revision.pdf.pages.length),
      title: '리뷰 수정사항 확인', procedure: feedback.action, context: feedback.issue,
      status: record?.status ?? 'pending', record, aiRecord,
    })
  }
  return cards.map((card) => card.key === 'growth' && card.status === 'pass' &&
    cards.some((other) => other.page === card.page && !['growth', 'review'].includes(other.key) && other.status !== 'pass')
    ? { ...card, status: 'stale' } : card)
}

function calculate(revision, guide, block) {
  if (block.action !== 'growth') return block
  const records = revision.verifications[block.id] ?? {}
  const required = executionPlan(guide, block.action, block.sourceIds).keys.filter((key) => key !== 'growth')
  let result = null
  if (required.every((key) => records[key]?.status === 'pass')) {
    const [start, end] = sourcesFor(revision, block.sourceIds)
    result = growthRate(start, end)
  }
  return { ...block, result }
}

function growthRate(start, end) {
  if (start.value <= 0 || end.year <= start.year || start.unit !== end.unit) return null
  const percent = ((end.value - start.value) / start.value) * 100
  return Number.isFinite(percent) ? Number(percent.toFixed(2)) : null
}

export function comparisonStatus(sources, field) {
  const clean = (value) => value?.trim().normalize('NFKC').toLowerCase()
  if (sources.length !== 2) return 'pending'
  const [start, end] = sources.map((source) => clean(source[field]))
  if (!start || !end) return 'pending'
  return start === end ? 'pass' : 'fail'
}

const openForAuthor = (doc, actor) => doc.owner === actor && ['draft', 'changes'].includes(doc.status)
export const openForReview = (doc, actor) => isReviewer(doc, actor) && doc.status === 'review'
const findBlock = (revision, blockId) => {
  const block = revision.blocks.find((item) => item.id === blockId)
  ensure(block, '문단을 찾을 수 없어요.', 404)
  return block
}

function stale(records) {
  return Object.fromEntries(Object.entries(records ?? {}).map(([key, record]) => [key, { ...record, status: 'stale' }]))
}

function readSource(body, sourceId) {
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  ensure(!url || /^https?:\/\/[^\s]+$/i.test(url), '출처 링크는 http 또는 https 주소를 입력하세요.')
  const value = Number(body.value)
  const year = Number(body.year)
  ensure(body.value != null && String(body.value).trim() && Number.isFinite(value) && value >= 0 && Number.isInteger(year) && year >= 1900 && year <= 2200, '연도와 0 이상의 수치를 입력하세요.')
  return {
    id: sourceId, label: input(body.label, '출처명', 120), year, value,
    unit: input(body.unit, '단위', 40), scope: String(body.scope ?? '').trim().slice(0, 200),
    metric: String(body.metric ?? '').trim().slice(0, 200), url: url.slice(0, 1000),
    excerpt: input(body.excerpt, '원문 발췌'),
  }
}

export function resolveSources(revision, action, chosen, inferred) {
  const ids = [...new Set(chosen.length ? chosen : inferred)]
  const validIds = ids.filter((sourceId) => revision.sources.some((source) => source.id === sourceId))
  if (action === 'growth') ensure(validIds.length === 2, '성장률 계산에 사용할 시작 출처와 종료 출처 두 개를 순서대로 선택하세요.', 422)
  return validIds
}

export function proposalRule(value) {
  ensure(value && Object.hasOwn(fields, value.field), '검증 기준을 선택하세요.')
  return {
    field: value.field, trigger: 'cross_source_growth',
    context: input(value.context, '판정 기준', 1200),
    procedure: input(value.procedure, '확인 절차', 1200),
  }
}

export function replay(guide, sources) {
  if (sources.length !== 2) return 'pending'
  const block = { id: 'sample', action: 'growth', sourceIds: sources.map((source) => source.id), result: null }
  const plan = executionPlan(guide, block.action, block.sourceIds)
  const records = { citation: { status: 'pass' } }
  for (const rule of plan.rules) records[rule.field] = { status: comparisonStatus(sources, rule.field) }
  if (Object.values(records).some((record) => record.status === 'pending')) return 'pending'
  const result = calculate({ sources, verifications: { [block.id]: records } }, guide, block)
  return result.result === null ? 'blocked' : 'allowed'
}

function candidateGuide(latest, rule) {
  return { ...latest, rules: [...latest.rules.filter((item) => item.field !== rule.field), rule] }
}

export function feedbackNeedsSynthesis(state, doc, entry) {
  return !entry.publishedVersion || guidesFor(state, doc.workType).find((guide) => guide.version === entry.publishedVersion)?.synthesis === 'local'
}

function publishPdfFeedback(state, doc, entry, synthesis) {
  const versions = guidesFor(state, doc.workType)
  const latest = versions.at(-1)
  const changedDuringInference = synthesis?.mode === 'llm' && synthesis.baseVersion !== latest.version
  if (!synthesis || synthesis.mode === 'pending' || changedDuringInference) {
    entry.synthesisStatus = 'pending'
    entry.synthesisReason = changedDuringInference
      ? '다른 피드백으로 검증 기준가 갱신됐어요. 최신 규칙으로 AI 정리를 다시 실행하세요.'
      : synthesis?.reason ?? 'AI 정리가 필요해요.'
    return entry.id
  }
  ensure(synthesis.mode === 'llm', 'AI 정리를 완료한 검증 기준만 발행할 수 있어요.')
  const rules = validateGuideRules(synthesis.rules, doc.workType)
  const version = latest.version + 1
  const next = { version, rules, publishedAt: now(), reviewFeedbackId: entry.id,
    synthesis: 'llm', summary: input(synthesis.summary, '변경 요약', 1200) }
  if (doc.workType === 'general') state.generalGuides = [...versions, next]
  else state.guides.push(next)
  if (entry.publishedVersion) entry.previousPublishedVersions = [...(entry.previousPublishedVersions ?? []), entry.publishedVersion]
  entry.publishedVersion = version
  entry.guideChange = JSON.stringify(rules) === JSON.stringify(latest.rules) ? 'document_only' : 'synthesized'
  entry.guideSummary = next.summary
  entry.synthesisStatus = 'complete'
  delete entry.synthesisReason
  return entry.id
}

export function validateGuideRules(rules, workType) {
  ensure(Array.isArray(rules) && rules.length <= 20, '검증 규칙은 20개 이내여야 해요.')
  const keys = new Set()
  return rules.map((rule) => {
    ensure(typeof rule.field === 'string' && /^[a-z][a-z0-9_]{0,49}$/.test(rule.field) &&
      !['growth', 'review'].includes(rule.field) && !keys.has(rule.field), '검증 규칙 식별자가 올바르지 않아요.')
    keys.add(rule.field)
    ensure(rule.trigger === 'pdf_page' || (workType !== 'general' && rule.trigger === 'cross_source_growth'), '업무에 맞는 적용 조건이 필요해요.')
    ensure(rule.field !== 'citation' || rule.trigger === 'pdf_page', '출처 검증 조건을 확인하세요.')
    return { field: rule.field, trigger: rule.trigger, title: input(rule.title, '검증 제목', 80),
      context: input(rule.context, '판정 기준', 600), procedure: input(rule.procedure, '확인 절차', 600) }
  })
}

// Existing correction requests predate automatic publication.
export function pendingPdfFeedback(state) {
  return state.docs.flatMap((doc) => {
    if (!current(doc).pdf) return []
    return doc.feedback.filter((entry) => entry.page && feedbackNeedsSynthesis(state, doc, entry) &&
      doc.revisions.some((revision) => revision.number === entry.revision && revision.pdf)).map((entry) => ({ doc, entry }))
  })
}

export function publishPendingPdfFeedback(state, feedbackId, synthesis) {
  for (const { doc, entry } of pendingPdfFeedback(state)) {
    if (feedbackId && entry.id !== feedbackId) continue
    const existing = state.proposals.find((proposal) => proposal.feedback === entry.id && proposal.published &&
      guidesFor(state, doc.workType).find((guide) => guide.version === proposal.published)?.synthesis !== 'local')
    if (existing) entry.publishedVersion = existing.published
    else publishPdfFeedback(state, doc, entry, synthesis)
  }
}

export function view(state, actor) {
  return {
    guides: state.guides,
    generalGuides: guidesFor(state, 'general'),
    docs: state.docs.filter((doc) => canSee(doc, actor)),
    proposals: people[actor].role === '리뷰어' ? state.proposals : [],
  }
}

export function apply(state, actor, body) {
  ensure(Object.hasOwn(people, actor), '사용자를 확인하세요.', 403)
  const latest = state.guides.at(-1)
  if (body.op === 'create' || body.op === 'uploadPdf') {
    const pdf = body.op === 'uploadPdf' ? body.pdf : null
    const workType = pdf && body.workType === 'general' ? 'general' : 'market'
    const version = guidesFor(state, workType).at(-1).version
    const demo = ['scope', 'metric', 'normal'].includes(body.sample) ? body.sample : null
    const doc = {
      id: id(), owner: actor, reviewer: reviewerFor(actor),
      type: workTypes[workType], workType, title: input(body.title, '문서 제목', 150),
      purpose: pdf ? '' : input(body.purpose, '문서 목적', 400), market: pdf ? '' : input(body.market, '대상 시장', 150),
      version, status: 'draft', submissions: [], feedback: [], generations: [],
      revisions: [{ number: 1, blocks: [], sources: demo ? [samples.a, samples[demo]] : [], verifications: {}, ...(pdf && { pdf, workType, guideVersion: version }), actor, at: now() }],
    }
    state.docs.push(doc)
    return doc.id
  }

  if (['saveProposal', 'testProposal', 'publish'].includes(body.op)) {
    ensure(people[actor].role === '리뷰어', '리뷰어 권한이 필요해요.', 403)
    const proposal = state.proposals.find((item) => item.id === body.proposal)
    ensure(proposal && !proposal.published, '편집 가능한 개선안을 찾을 수 없어요.', 404)
    if (body.op === 'saveProposal') {
      proposal.rule = proposalRule(body.rule)
      if (proposal.pdfPage) {
        proposal.cases = Object.fromEntries(['failure', 'normal'].map((name) => [name,
          [samples.a, samples.normal].map((source, index) => ({
            ...source,
            scope: input(body.rule[`${name}Scope${index}`], '시장 범위', 200),
            metric: input(body.rule[`${name}Metric${index}`], '지표 정의', 200),
          })),
        ]))
      }
      proposal.test = null
    }
    if (body.op === 'testProposal') {
      const candidate = candidateGuide(latest, proposal.rule)
      const failed = proposal.pdfPage ? proposal.cases?.failure : proposal.failureSources
      const normalSources = proposal.pdfPage ? proposal.cases?.normal : [samples.a, samples.normal]
      ensure(failed && normalSources, '오류 사례와 정상 사례의 대조값을 저장하세요.')
      const before = replay(latest, failed)
      const after = replay(candidate, failed)
      const normal = replay(candidate, normalSources)
      proposal.test = { version: latest.version, before, after, normal, passed: after === 'blocked' && normal === 'allowed', at: now() }
    }
    if (body.op === 'publish') {
      ensure(people[actor].publish, '발행 권한이 필요해요.', 403)
      ensure(proposal.test?.passed && proposal.test.version === latest.version, '현재 검증 기준 기준으로 오류·정상 사례 검증을 통과해야 해요.', 409)
      const version = latest.version + 1
      state.guides.push({ ...candidateGuide(latest, proposal.rule), version, publishedAt: now(), proposalId: proposal.id })
      proposal.published = version
    }
    return proposal.id
  }

  const doc = state.docs.find((item) => item.id === body.doc)
  ensure(doc && canSee(doc, actor), '문서를 찾을 수 없어요.', 404)
  const revision = current(doc)
  const guide = guideFor(state, doc)
  const author = openForAuthor(doc, actor)
  const reviewer = openForReview(doc, actor)
  if (body.op === 'retryFeedback') {
    ensure(people[actor].role === '리뷰어' && (doc.reviewer === actor || doc.owner === actor), '담당 리뷰어가 AI 정리를 실행할 수 있어요.', 403)
    const entry = doc.feedback.find((item) => item.id === body.feedback)
    ensure(entry, '피드백을 찾을 수 없어요.', 404)
    if (feedbackNeedsSynthesis(state, doc, entry)) publishPdfFeedback(state, doc, entry, body.synthesis)
    return entry.id
  }
  if (['source', 'generation', 'adopt', 'edit', 'remove', 'addText', 'verify', 'replacePdf', 'verifyPdf', 'verifyPdfWithAi', 'submit', 'feedback', 'approve', 'proposal'].includes(body.op)) {
    ensure(body.base === revision.number, '문서가 변경됐어요. 최신 버전에서 다시 시도하세요.', 409)
  }

  switch (body.op) {
    case 'verifyPdfWithAi': {
      ensure((author || reviewer) && revision.pdf, '작성자 또는 담당 리뷰어만 AI 검증을 실행할 수 있어요.', 403)
      ensure(body.aiResult && ['complete', 'failed'].includes(body.aiResult.status) && body.aiResult.guideVersion === guide.version, '적용된 검증 기준에 맞는 검증 결과가 필요해요.')
      const kinds = body.aiResult.pageKinds
      const pdf = kinds ? { ...revision.pdf, pages: revision.pdf.pages.map((page) => ({ ...page, growth: kinds.find((item) => item.page === page.page)?.growth ? 'ai' : '' })) } : revision.pdf
      revise(doc, { ...revision, pdf, aiVerification: body.aiResult, verifications: {} }, actor)
      break
    }
    case 'replacePdf': {
      ensure(author && revision.pdf, '작성 중인 자기 PDF만 교체할 수 있어요.', 403)
      ensure(!doc.feedback.some((entry) => entry.page && feedbackNeedsSynthesis(state, doc, entry)), '피드백의 AI 정리를 완료하면 새 검증 기준로 수정본을 검증할 수 있어요.', 409)
      const feedback = doc.feedback.filter((entry) => (entry.publishedVersion ?? 0) > guide.version)
      const guideVersion = Math.max(guide.version, ...feedback.map((entry) => entry.publishedVersion))
      const reviewChecks = [...(revision.reviewChecks ?? []), ...feedback.map(({ id, page, issue, action }) => ({ id, page, issue, action }))]
      doc.revisions = doc.revisions.map((item) => item.guideVersion ? item : { ...item, guideVersion: doc.version })
      doc.version = guideVersion
      revise(doc, { ...revision, pdf: body.pdf, guideVersion, reviewChecks, verifications: {}, aiVerification: null }, actor)
      break
    }
    case 'verifyPdf': {
      ensure((author || reviewer) && revision.pdf, '이 PDF에 판정을 기록할 수 없어요.', 403)
      const card = pdfCards(revision, guide).find((item) => item.id === body.card)
      ensure(card, '검증 항목을 찾을 수 없어요.', 404)
      ensure(['pass', 'fail', 'pending'].includes(body.status), '판정을 선택하세요.')
      if (card.key === 'growth' && body.status === 'pass') {
        ensure(pdfCards(revision, guide).filter((item) => item.page === card.page && item.key !== 'growth' && item.key !== 'review').every((item) => item.status === 'pass'),
          '이 페이지의 출처와 비교 조건을 확인한 뒤 성장률을 판정하세요.', 409)
      }
      const record = { status: body.status, evidence: input(body.evidence, '근거'), reason: input(body.reason, '판단 이유'), actor, basedOn: revision.number, at: now() }
      const verifications = { ...revision.verifications, [card.id]: record }
      const priorGrowth = verifications[`${card.page}:growth`] ?? revision.aiVerification?.records?.[`${card.page}:growth`]
      if (card.key !== 'growth' && card.key !== 'review' && body.status !== 'pass' && priorGrowth?.status === 'pass') {
        verifications[`${card.page}:growth`] = { ...priorGrowth, status: 'stale' }
      }
      revise(doc, { ...revision, verifications }, actor)
      break
    }
    case 'source': {
      ensure(author, '작성 중인 자기 문서의 출처만 편집할 수 있어요.', 403)
      const existing = revision.sources.find((source) => source.id === body.source)
      ensure(!body.source || existing, '출처를 찾을 수 없어요.', 404)
      let sourceId = existing?.id
      if (!sourceId) {
        sourceId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((letter) => !revision.sources.some((item) => item.id === letter))
        ensure(sourceId, '출처는 최대 26개까지 등록할 수 있어요.')
      }
      const source = readSource(body, sourceId)
      if (existing && JSON.stringify(existing) === JSON.stringify(source)) break
      const sources = existing ? revision.sources.map((item) => item.id === sourceId ? source : item) : [...revision.sources, source]
      const verifications = { ...revision.verifications }
      const blocks = revision.blocks.map((block) => {
        if (!block.sourceIds?.includes(sourceId)) return block
        verifications[block.id] = stale(verifications[block.id])
        return { ...block, result: null }
      })
      revise(doc, { ...revision, sources, blocks, verifications }, actor)
      break
    }
    case 'generation':
      ensure(author, '작성 중인 자기 문서에서 AI를 사용할 수 있어요.', 403)
      doc.generations.push(body.result)
      return body.result.id
    case 'adopt': {
      ensure(author, '작성 중인 자기 문서에서 AI 초안을 반영할 수 있어요.', 403)
      const generation = doc.generations.find((item) => item.id === body.generation)
      ensure(generation && !generation.adopted, '반영할 초안을 찾을 수 없어요.', 404)
      ensure(generation.base === revision.number, '초안 생성 뒤 문서가 변경됐어요. 다시 생성하세요.', 409)
      const blockId = generation.target || id()
      const block = { id: blockId, action: generation.plan.action, sourceIds: generation.plan.sourceIds, text: generation.text, result: null, generation: generation.id }
      const blocks = generation.target
        ? revision.blocks.map((item) => item.id === blockId ? block : item)
        : [...revision.blocks, block]
      const verifications = { ...revision.verifications }
      delete verifications[blockId]
      const updated = revise(doc, { ...revision, blocks, verifications }, actor)
      generation.adopted = { blockId, revision: updated.number }
      break
    }
    case 'addText':
      ensure(author, '작성 중인 자기 문서만 편집할 수 있어요.', 403)
      revise(doc, { ...revision, blocks: [...revision.blocks, { id: id(), text: input(body.text, '문단'), sourceIds: [] }] }, actor)
      break
    case 'edit':
    case 'remove': {
      ensure(author, '작성 중인 자기 문서만 편집할 수 있어요.', 403)
      const block = findBlock(revision, body.block)
      const verifications = { ...revision.verifications }
      let blocks = revision.blocks
      if (body.op === 'remove') {
        blocks = blocks.filter((item) => item.id !== block.id)
        delete verifications[block.id]
      } else {
        const content = input(body.text, '문단')
        if (content === block.text) break
        blocks = blocks.map((item) => item.id === block.id ? { ...item, text: content, result: null } : item)
        verifications[block.id] = stale(verifications[block.id])
      }
      revise(doc, { ...revision, blocks, verifications }, actor)
      break
    }
    case 'verify': {
      ensure(author || reviewer, '이 문서에 검증 결과를 남길 수 없어요.', 403)
      const block = findBlock(revision, body.block)
      const card = cardList(revision, guide, block).find((item) => item.key === body.key)
      ensure(card && card.key !== 'growth', '판정할 검증 항목을 선택하세요.')
      ensure(['pass', 'fail', 'pending'].includes(body.status), '판정을 선택하세요.')
      const evidence = input(body.evidence, '근거 또는 부족한 자료')
      const reason = input(body.reason, '판단 이유')
      const sources = sourcesFor(revision, block.sourceIds)
      if (body.status === 'pass' && Object.hasOwn(fields, card.key)) {
        ensure(comparisonStatus(sources, card.key) === 'pass', `두 출처의 ${fields[card.key]} 기준이 확인되고 일치해야 충족으로 판정할 수 있어요.`, 409)
      }
      const record = { status: body.status, evidence, reason, sources, actor, basedOn: revision.number, at: now() }
      const verifications = { ...revision.verifications, [block.id]: { ...revision.verifications[block.id], [card.key]: record } }
      const outcome = { ...revision, verifications }
      const blocks = revision.blocks.map((item) => item.id === block.id ? calculate(outcome, guide, item) : item)
      revise(doc, { ...outcome, blocks }, actor)
      break
    }
    case 'submit':
      ensure(author && doc.reviewer, '리뷰어가 배정된 작성 중 문서만 제출할 수 있어요.', 403)
      ensure(revision.pdf || revision.blocks.length, '검증할 문서를 먼저 등록하세요.')
      doc.submissions.push({ revision: revision.number, at: now() })
      doc.status = 'review'
      break
    case 'feedback': {
      ensure(reviewer, '담당 리뷰어만 피드백을 남길 수 있어요.', 403)
      if (revision.pdf) ensure(revision.pdf.pages.some((page) => page.page === Number(body.page)), '피드백을 남길 PDF 페이지를 선택하세요.')
      if (body.block) {
        const block = findBlock(revision, body.block)
        if (body.key) ensure(cardList(revision, guide, block).some((card) => card.key === body.key), '검증 카드를 찾을 수 없어요.')
        if (body.row) ensure(block.action === 'growth' && block.sourceIds.includes(body.row), '표 행을 찾을 수 없어요.')
      }
      let entry = {
        id: id(), block: body.block || null, key: body.key || null, row: body.row || null,
        ...(revision.pdf && { page: Number(body.page) }), revision: revision.number, actor,
        issue: input(body.issue, '발견한 문제'), evidence: input(body.evidence, '판단 근거'),
        action: input(body.action, '작성자가 할 일'), at: now(),
      }
      const duplicate = revision.pdf && doc.feedback.find((item) => item.revision === entry.revision && item.actor === actor &&
        item.page === entry.page && item.issue === entry.issue && item.evidence === entry.evidence && item.action === entry.action)
      if (duplicate) entry = duplicate
      else doc.feedback.push(entry)
      if (revision.pdf && !entry.publishedVersion) publishPdfFeedback(state, doc, entry, body.synthesis)
      if (body.requestChanges) doc.status = 'changes'
      return entry.id
    }
    case 'approve':
      ensure(reviewer, '담당 리뷰어만 문서를 승인할 수 있어요.', 403)
      ensure(!revision.pdf || revision.aiVerification?.status === 'complete', 'AI 문서 검증을 완료한 뒤 최종 승인하세요.', 409)
      ensure((revision.pdf ? pdfCards(revision, guide) : revision.blocks.flatMap((block) => cardList(revision, guide, block))).every((card) => card.status === 'pass'), '필수 검증을 모두 완료하거나 해당 주장을 수정한 뒤 승인하세요.', 409)
      doc.status = 'approved'
      doc.approval = { revision: revision.number, actor, at: now() }
      break
    case 'proposal': {
      ensure(people[actor].role === '리뷰어', '리뷰어만 개선안을 등록할 수 있어요.', 403)
      const proposal = buildProposalInput(doc, actor, body)
      if (revision.pdf) {
        const entry = { id: id(), page: proposal.pdfPage, revision: proposal.revision, actor, issue: proposal.issue, evidence: proposal.evidence, action: proposal.issue, kind: 'self', at: now() }
        doc.feedback.push(entry)
        publishPdfFeedback(state, doc, entry, body.synthesis)
        return entry.id
      }
      state.proposals.push({ ...proposal, id: id(), author: actor, rule: proposalRule(body.rule), at: now() })
      return state.proposals.at(-1).id
    }
    default:
      throw new WorkflowError('지원하는 작업을 선택하세요.')
  }
  return doc.id
}

export function buildProposalInput(doc, actor, body) {
  const feedback = body.feedback ? doc.feedback.find((item) => item.id === body.feedback) : null
  ensure(body.feedback ? feedback?.actor === actor : doc.owner === actor, '리뷰 피드백 또는 자신의 검증 기록에서 개선안을 등록하세요.', 403)
  const revision = feedback ? doc.revisions.find((item) => item.number === feedback.revision) : current(doc)
  const issue = feedback?.issue ?? input(body.issue, '발견한 문제')
  const evidence = feedback?.evidence ?? input(body.evidence, '원문 근거')
  const page = revision.pdf?.pages.find((item) => item.page === Number(feedback?.page ?? body.page))
  if (revision.pdf) ensure(page, '개선의 근거가 된 PDF 페이지를 선택하세요.')
  const block = page ? null : findBlock(revision, feedback?.block ?? body.block)
  return {
    doc: doc.id, documentTitle: doc.title, revision: revision.number, block: block?.id ?? null, oldVersion: revision.guideVersion ?? doc.version,
    kind: feedback ? 'review' : 'self', feedback: feedback?.id ?? null, row: feedback?.row ?? null, issue, evidence,
    failureSources: block ? sourcesFor(revision, block.sourceIds) : [],
    ...(page && { pdfPage: page.page, pdfExcerpt: page.text.slice(0, 4000) }),
  }
}
