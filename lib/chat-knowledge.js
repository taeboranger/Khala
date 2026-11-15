import { ensure, input } from './workflow.js'

function tokens(text) {
  const terms = text.toLowerCase().normalize('NFKC').match(/[a-z0-9가-힣]+/g) ?? []
  const result = new Set(terms)
  for (const term of terms) if (/[가-힣]/.test(term)) for (let i = 0; i < term.length - 1; i++) result.add(term.slice(i, i + 2))
  return result
}
export function retrieveKnowledge(items, workType, query, limit = 12) {
  const wanted = tokens(query)
  return items.filter((item) => item.workType === workType && item.active !== false).map((item) => {
    const terms = tokens(`${item.title} ${item.criterion} ${item.procedure} ${item.keywords.join(' ')}`)
    let matches = 0; for (const word of wanted) if (terms.has(word)) matches++
    return { ...item, retrievalScore: matches / Math.sqrt(Math.max(1, terms.size)), matchedTerms: [...wanted].filter((word) => terms.has(word)).slice(0, 12) }
  }).filter((item) => item.retrievalScore > 0).sort((a, b) => b.retrievalScore - a.retrievalScore).slice(0, limit)
}
export const lessonSchema = { type: 'array', items: { type: 'object', additionalProperties: false,
  properties: { key: { type: 'string' }, title: { type: 'string' }, criterion: { type: 'string' }, procedure: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } }, sourceId: { type: 'string' }, quote: { type: 'string' } },
  required: ['key', 'title', 'criterion', 'procedure', 'keywords', 'sourceId', 'quote'] } }
export function groundedLessons(values, sources) {
  ensure(Array.isArray(values) && values.length <= 5, '지식 추출 결과를 확인하세요.')
  return values.map((value) => {
    const source = sources.find((source) => source.id === value.sourceId)
    ensure(source && typeof value.quote === 'string' && value.quote.trim().length >= 5 && source.text.includes(value.quote), '전문가 원문과 일치하는 근거가 필요해요.')
    ensure(/^[a-z][a-z0-9_]{1,79}$/.test(value.key), '지식 식별자를 확인하세요.')
    ensure(Array.isArray(value.keywords) && value.keywords.length <= 12 && value.keywords.every((word) => typeof word === 'string' && word.length <= 60), '검색어 형식을 확인하세요.')
    return { key: value.key, title: input(value.title, '제목', 100), criterion: input(value.criterion, '검증 기준', 1000), procedure: input(value.procedure, '확인 방법', 1000), keywords: value.keywords, sourceId: source.id, quote: value.quote }
  })
}
export async function publishLessons(tx, lessons, { workType, actor, chatId, docId, eventId, kind, expected }) {
  const published = []
  for (const lesson of lessons) {
    const proposedId = crypto.randomUUID()
    // Unique key serializes concurrent updates; immutable versions keep the original context.
    await tx.query('INSERT INTO khala_knowledge(id,work_type,rule_key,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(work_type,rule_key) DO NOTHING', [proposedId, workType, lesson.key, '{}'])
    const row = (await tx.query('SELECT * FROM khala_knowledge WHERE work_type=$1 AND rule_key=$2 FOR UPDATE', [workType, lesson.key])).rows[0]
    const previous = row.data
    if (previous.sources?.some((source) => source.eventId === eventId)) { published.push({ id: row.id, version: previous.version }); continue }
    if (expected) ensure((previous.version ?? 0) === (expected.find((rule) => rule.key === lesson.key)?.version ?? 0), '다른 피드백이 먼저 반영됐어요. 최신 기준으로 정리를 다시 시도하세요.', 409)
    const record = { ...lesson, id: row.id, workType, version: (previous.version ?? 0) + 1, active: true, at: new Date().toISOString(),
      sources: [...(previous.sources ?? []), { actor, chatId, docId, eventId, kind, messageId: lesson.sourceId, quote: lesson.quote }] }
    await tx.query('UPDATE khala_knowledge SET data=$2::jsonb WHERE id=$1', [row.id, JSON.stringify(record)])
    await tx.query('INSERT INTO khala_knowledge_version(id,version,data) VALUES($1,$2,$3::jsonb)', [row.id, record.version, JSON.stringify(record)])
    published.push({ id: row.id, version: record.version })
  }
  return published
}

// Import already LLM-synthesized PDF rules with their actual reviewer provenance.
// Replaying the history is idempotent; raw PDFs are never promoted as expert judgments.
export async function syncPdfKnowledge(tx) {
  if (!(await tx.query("SELECT to_regclass('khala_workspace') AS name")).rows[0].name) return
  const state = (await tx.query('SELECT state FROM khala_workspace WHERE id=1')).rows[0]?.state
  if (!state) return
  for (const [workType, guides] of [['market', state.guides ?? []], ['general', state.generalGuides ?? []]]) {
    let prior = []
    for (const guide of guides) {
      if (guide.synthesis !== 'llm') { prior = guide.rules; continue }
      const doc = state.docs.find((d) => d.feedback.some((f) => f.id === guide.reviewFeedbackId))
      const feedback = doc?.feedback.find((f) => f.id === guide.reviewFeedbackId)
      if (feedback) {
        const changed = guide.rules.filter((rule) => JSON.stringify(prior.find((old) => old.field === rule.field)) !== JSON.stringify(rule))
        await publishLessons(tx, changed.map((rule) => ({ key: `pdf_${rule.field}`, title: rule.title, criterion: rule.context,
          procedure: rule.procedure, keywords: [rule.field, rule.title], sourceId: feedback.id, quote: feedback.issue })),
        { workType, actor: feedback.actor, docId: doc.id, eventId: `pdf:${guide.reviewFeedbackId}`, kind: 'pdf_feedback' })
        for (const removed of prior.filter((rule) => !guide.rules.some((r) => r.field === rule.field))) {
          const row = (await tx.query('SELECT data FROM khala_knowledge WHERE work_type=$1 AND rule_key=$2 FOR UPDATE', [workType, `pdf_${removed.field}`])).rows[0]
          if (row?.data.active && !row.data.sources.some((s) => s.eventId === `removed:${guide.reviewFeedbackId}`)) {
            const record = { ...row.data, version: row.data.version + 1, active: false, at: guide.publishedAt,
              sources: [...row.data.sources, { actor: feedback.actor, docId: doc.id, eventId: `removed:${guide.reviewFeedbackId}`, kind: 'pdf_feedback', quote: feedback.issue }] }
            await tx.query('UPDATE khala_knowledge SET data=$2::jsonb WHERE id=$1', [record.id, JSON.stringify(record)])
            await tx.query('INSERT INTO khala_knowledge_version VALUES($1,$2,$3::jsonb)', [record.id, record.version, JSON.stringify(record)])
          }
        }
      }
      prior = guide.rules
    }
  }
}

export async function setKnowledgeActive(tx, actor, id, base, active) {
  const row = (await tx.query('SELECT data FROM khala_knowledge WHERE id=$1 FOR UPDATE', [id])).rows[0]
  ensure(row, '검증 기준을 찾을 수 없어요.', 404)
  ensure(row.data.version === base, '기준이 변경됐어요. 최신 버전을 확인하세요.', 409)
  ensure(typeof active === 'boolean', '사용 여부를 확인하세요.')
  const record = { ...row.data, active, version: base + 1, at: new Date().toISOString(), changedBy: actor, change: active ? '다시 사용' : '사용 중지' }
  await tx.query('UPDATE khala_knowledge SET data=$2::jsonb WHERE id=$1', [id, JSON.stringify(record)])
  await tx.query('INSERT INTO khala_knowledge_version VALUES($1,$2,$3::jsonb)', [id, record.version, JSON.stringify(record)])
}
