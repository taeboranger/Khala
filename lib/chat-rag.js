import { createHash } from 'node:crypto'
import { chatDatabase } from './chat-store.js'
import { embedTexts, embeddingModelId } from './rag-embedding.js'
import { ensure, input } from './workspace.js'

export async function ragDatabase() {
  const conn = await chatDatabase()
  globalThis.khalaRagSchema ??= (async () => {
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_chat_reaction (message_id uuid REFERENCES khala_chat_message(id), chat_id uuid REFERENCES khala_chat(id), actor text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(message_id,actor))`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_reaction_event (id uuid PRIMARY KEY, message_id uuid NOT NULL, actor text NOT NULL, data jsonb NOT NULL)`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_rag_case (id text PRIMARY KEY, chat_id uuid REFERENCES khala_chat(id), work_type text NOT NULL, data jsonb NOT NULL)`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_rag_embedding (hash text PRIMARY KEY, model text NOT NULL, vector jsonb NOT NULL)`)
    await conn.db.query('CREATE INDEX IF NOT EXISTS khala_rag_case_work ON khala_rag_case(work_type)')
  })().catch((e) => { delete globalThis.khalaRagSchema; throw e })
  await globalThis.khalaRagSchema
  return conn
}

export const caseSchema = { type: 'object', additionalProperties: false, properties: {
  applicable: { type: 'boolean' }, situation: { type: 'string' }, problem: { type: 'string' }, resolution: { type: 'string' },
}, required: ['applicable','situation','problem','resolution'] }
export const caseInstructions = `Also return caseStudy: a reusable anonymized case with situation, problem, resolution (each <=700 Korean characters). Use only the human expert's explicit judgment and provided surrounding conversation. Preserve the task's specific applicability and distinguish a successful example from an error correction. Never invent a successful outcome. Remove names, identifying details, exact case-specific amounts and source quotations. Set applicable=false and empty strings if feedback is only a like, vague praise, or lacks an explicit useful judgment. Never promote assistant-generated advice alone into expertise.`

export async function saveRagCase(tx, value, metadata) {
  if (!value?.applicable) return
  const data = { ...metadata, situation: input(value.situation, '사례 상황', 700), problem: input(value.problem, '사례 판단', 700), resolution: input(value.resolution, '사례 대응', 700), at: new Date().toISOString() }
  await tx.query('INSERT INTO khala_rag_case VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING', [metadata.id, metadata.chatId, metadata.workType, JSON.stringify(data)])
}

export function tokenize(text) {
  const words = text.toLowerCase().normalize('NFKC').match(/[a-z0-9가-힣]+/g) ?? []
  return words.flatMap((w) => /[가-힣]/.test(w) && w.length > 2 ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))] : [w])
}
export function chunks(text, size = 1000, overlap = 150) {
  const result = []
  for (let offset = 0; offset < text.length; offset += size - overlap) { result.push(text.slice(offset, offset + size)); if (offset + size >= text.length) break }
  return result
}
export function bm25(documents, query) {
  const terms = [...new Set(tokenize(query))]
  const corpus = documents.map((d) => tokenize(d.text))
  const avg = corpus.reduce((n,t) => n + t.length, 0) / Math.max(1, corpus.length)
  return corpus.map((tokens, i) => ({ index: i, score: terms.reduce((score, term) => {
    const freq = tokens.filter((t) => t === term).length
    if (!freq) return score
    const df = corpus.filter((t) => t.includes(term)).length
    return score + Math.log(1 + (corpus.length - df + .5) / (df + .5)) * freq * 2.2 / (freq + 1.2 * (.25 + .75 * tokens.length / Math.max(1, avg)))
  }, 0) }))
}
export function fuseRanks(documents, lexical, semantic) {
  const scores = new Map()
  for (const ranking of [lexical.filter((r) => r.score > 0), semantic.filter((r) => r.score >= .65)]) {
    ranking.sort((a,b) => b.score - a.score).slice(0, 40).forEach((r, rank) => scores.set(r.index, (scores.get(r.index) ?? 0) + 1 / (60 + rank)))
  }
  const grouped = new Map()
  for (const [index, score] of scores) {
    const doc = documents[index]
    const current = { ...doc, retrievalScore: score * (1 + Math.max(-.1, Math.min(.1, doc.quality ?? 0))), semanticScore: semantic.find((r) => r.index === index)?.score ?? null, lexicalScore: lexical[index]?.score ?? 0 }
    if (!grouped.has(doc.id) || grouped.get(doc.id).retrievalScore < current.retrievalScore) grouped.set(doc.id, current)
  }
  return [...grouped.values()].sort((a,b) => b.retrievalScore - a.retrievalScore)
}

async function caseDocuments(db, actor, workType, excludeChat, knowledge) {
  const published = (await db.query(`SELECT k.data,c.owner,c.reviewer,r.data AS reaction FROM khala_rag_case k
    JOIN khala_chat c ON c.id=k.chat_id LEFT JOIN khala_chat_reaction r ON r.message_id::text=k.data->>'messageId' AND r.actor=c.reviewer
    WHERE k.work_type=$1 AND k.chat_id<>$2`, [workType, excludeChat])).rows
  const result = published.filter(({data}) => !data.ruleRefs?.length || data.ruleRefs.every((ref) => knowledge.some((k) => k.id === ref.id && k.version === ref.version && k.active !== false))).map(({ data, owner, reviewer, reaction }) => ({ ...data, kind: 'case', canOpen: owner === actor || reviewer === actor,
    outcome: reaction?.vote === 'disrecommend' ? 'rejected' : data.outcome,
    quality: (reaction?.vote === 'recommend' ? .07 : reaction?.vote === 'disrecommend' ? -.1 : 0) + (reaction?.liked ? .02 : 0),
    text: `상황: ${data.situation}\n판단: ${data.problem}\n대응: ${data.resolution}` }))
  // Existing reviews remain private until an LLM has distilled an anonymized shared case.
  const old = (await db.query(`SELECT r.data,c.id AS chat_id FROM khala_chat_review r JOIN khala_chat c ON c.id=r.chat_id
    WHERE (c.owner=$1 OR c.reviewer=$1) AND c.data->>'workType'=$2 AND c.id<>$3
    AND NOT EXISTS(SELECT 1 FROM khala_rag_case k WHERE k.id='review:'||r.id::text)`, [actor, workType, excludeChat])).rows
  for (const { data, chat_id } of old.filter(({data}) => !data.published?.length || data.published.every((ref) => knowledge.some((k) => k.id === ref.id && k.version === ref.version && k.active !== false)))) result.push({ id: `review:${data.id}`, kind: 'case', chatId: chat_id, messageId: data.messageId, canOpen: true,
    outcome: data.verdict === 'good' ? 'recommended' : 'correction', situation: (data.sourceTarget || data.sourceSummary || '').slice(0,700), problem: data.comment.slice(0,700), resolution: data.comment.slice(0,700),
    text: `${data.sourceTarget || data.sourceSummary || ''}\n리뷰: ${data.comment}`.slice(0,5000) })
  const rated = (await db.query(`SELECT r.data,m.data AS message,c.id AS chat_id,
    (SELECT p.data->>'text' FROM khala_chat_message p WHERE p.chat_id=c.id AND p.seq<m.seq AND p.data->>'role'='user' ORDER BY p.seq DESC LIMIT 1) AS prompt
    FROM khala_chat_reaction r JOIN khala_chat c ON c.id=r.chat_id JOIN khala_chat_message m ON m.id=r.message_id
    WHERE (c.owner=$1 OR c.reviewer=$1) AND c.data->>'workType'=$2 AND c.id<>$3 AND r.actor=c.reviewer
    AND (r.data->>'vote' IS NOT NULL OR r.data->>'liked'='true')
    AND NOT EXISTS(SELECT 1 FROM khala_rag_case k WHERE k.data->>'messageId'=m.id::text)`, [actor,workType,excludeChat])).rows
  for (const {data,message,chat_id,prompt} of rated) result.push({ id: `reaction:${message.id}`, kind: 'case', chatId: chat_id, messageId: message.id, canOpen: true,
    situation: (prompt || message.text).slice(0,700), problem: message.text.slice(0,700),
    resolution: data.vote === 'disrecommend' ? '리뷰어가 비추천한 사례. 정답으로 재사용하지 마세요. 구체적인 이유는 아직 기록되지 않았습니다.' : '리뷰어가 선호를 표시한 사례입니다. 사실 검증이나 전문 기준 승인을 의미하지 않습니다.',
    outcome: data.vote === 'disrecommend' ? 'rejected' : 'preference_only', quality: data.vote === 'recommend' ? .05 : data.vote === 'disrecommend' ? -.05 : .01,
    text: `${prompt || ''}\n${message.text}`.slice(0,5000) })
  const experts = (await db.query(`SELECT m.data,c.id AS chat_id FROM khala_chat_message m JOIN khala_chat c ON c.id=m.chat_id
    WHERE (c.owner=$1 OR c.reviewer=$1) AND c.data->>'workType'=$2 AND c.id<>$3 AND m.data->'extraction'->>'status'='complete'
    AND NOT EXISTS(SELECT 1 FROM khala_rag_case k WHERE k.id='expert:'||m.id::text)`, [actor,workType,excludeChat])).rows
  for (const {data,chat_id} of experts) {
    if (!data.extraction.published?.every((ref) => knowledge.some((k) => k.id === ref.id && k.version === ref.version && k.active !== false))) continue
    result.push({ id: `expert:${data.id}`, kind: 'case', chatId: chat_id, messageId: data.id, canOpen: true, outcome: 'expert_judgment',
      situation: '상사가 업무 대화에서 명시한 판단', problem: data.text.slice(0,700), resolution: data.text.slice(0,700), text: data.text.slice(0,5000) })
  }
  return result
}

export async function retrieveRag({ actor, chatId, workType, query, knowledge }, engine = { embedTexts, embeddingModelId }) {
  const { db } = await ragDatabase()
  const rules = knowledge.filter((r) => r.workType === workType && r.active !== false).map((r) => ({ ...r, kind: 'rule', text: `${r.title}\n${r.criterion}\n${r.procedure}\n${r.keywords.join(' ')}` }))
  const cases = await caseDocuments(db, actor, workType, chatId, knowledge)
  const documents = [...rules, ...cases].flatMap((doc) => chunks(doc.text).map((text, part) => ({ ...doc, text, part })))
  if (!documents.length) return { rules: [], cases: [], trace: { mode: 'empty', candidates: 0 } }
  const lexical = bm25(documents, query)
  let semantic = []; let mode = 'hybrid'; let model = ''; let failure = ''
  try {
    model = await engine.embeddingModelId()
    const hashes = documents.map((d) => createHash('sha256').update(model + '\npassage: ' + d.text).digest('hex'))
    const cached = new Map((await db.query('SELECT hash,vector FROM khala_rag_embedding WHERE model=$1 AND hash=ANY($2::text[])', [model, hashes])).rows.map((r) => [r.hash, r.vector]))
    const missing = [...new Set(hashes.filter((h) => !cached.has(h)))]
    // Index in bounded batches; no conversation transaction is held during inference.
    for (let start = 0; start < missing.length; start += 32) {
      const group = missing.slice(start, start + 32)
      const vectors = await engine.embedTexts(group.map((h) => 'passage: ' + documents[hashes.indexOf(h)].text))
      for (let i = 0; i < group.length; i++) { cached.set(group[i], vectors[i]); await db.query('INSERT INTO khala_rag_embedding VALUES($1,$2,$3::jsonb) ON CONFLICT(hash) DO NOTHING', [group[i], model, JSON.stringify(vectors[i])]) }
    }
    const [vector] = await engine.embedTexts(['query: ' + query.slice(0, 2000)])
    semantic = documents.map((_, index) => ({ index, score: cached.get(hashes[index]).reduce((s, n, j) => s + n * vector[j], 0) }))
  } catch { mode = 'keyword_fallback'; failure = '의미 검색을 사용할 수 없어 단어 검색 결과를 사용했어요.' }
  const ranked = fuseRanks(documents, lexical, semantic)
  let budget = 10000; const selected = []
  for (const doc of ranked) {
    if (selected.filter((r) => r.kind === doc.kind).length >= (doc.kind === 'case' ? 4 : 8)) continue
    const size = doc.kind === 'case' ? `${doc.situation}${doc.problem}${doc.resolution}`.length : `${doc.criterion}${doc.procedure}`.length
    if (size > budget) continue
    budget -= size; selected.push(doc)
  }
  return { rules: selected.filter((r) => r.kind === 'rule'), cases: selected.filter((r) => r.kind === 'case'), trace: { mode, model, candidates: documents.length, selected: selected.length, budgetUsed: 10000 - budget, warning: failure } }
}
