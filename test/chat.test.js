import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { groundedLessons, retrieveKnowledge, publishLessons } from '../lib/chat-knowledge.js'
import { chatDatabase, chatTransaction, getChat, chatWorkspace, knowledgeDetail, saveMessage, saveChat } from '../lib/chat-store.js'
import { createChat, prepareChatFiles, retryExpertLearning, updateChatStatus, changeKnowledge, submitChatReview } from '../lib/chat-service.js'

const db = new PGlite()
globalThis.khalaConnection = Promise.resolve({ db, external: false })
after(async () => { await db.close() })

test('knowledge retrieval separates work types and excludes unrelated rules', () => {
  const rule = { id: '1', title: '시장 범위', criterion: '성장률 계산 전 시장 범위를 확인한다', procedure: '두 출처 대조', keywords: ['성장률'], workType: 'market' }
  assert.deepEqual(retrieveKnowledge([rule], 'general', '성장률'), [])
  assert.deepEqual(retrieveKnowledge([rule], 'market', 'xyz123'), [])
  assert.equal(retrieveKnowledge([rule], 'market', '성장률을 계산')[0].id, '1')
})

test('lessons must cite a literal human source, never fabricated assistant advice', () => {
  const lesson = { key: 'market_scope', title: '범위 확인', criterion: '범위를 확인한다', procedure: '출처 대조', keywords: [], sourceId: 'expert', quote: '시장 범위를 확인한다' }
  assert.equal(groundedLessons([lesson], [{ id: 'expert', text: '먼저 시장 범위를 확인한다.' }]).length, 1)
  assert.throws(() => groundedLessons([lesson], [{ id: 'expert', text: '근거 없는 다른 문장' }]))
  assert.throws(() => groundedLessons([lesson], [{ id: 'assistant', text: lesson.quote }]))
})

test('conversation access, knowledge versioning and idempotent learning persist in SQL', async () => {
  await chatDatabase()
  const id = await createChat('writer', 'market')
  assert.equal((await getChat(db, id, 'reviewer')).owner, 'writer')
  await assert.rejects(getChat(db, id, 'peer'), (e) => e.status === 403)
  const own = await createChat('reviewer', 'general')
  assert.equal((await getChat(db, own, 'peer')).owner, 'reviewer')
  const lesson = { key: 'scope_match', title: '시장 범위 확인', criterion: '성장률 계산 전 확인', procedure: '출처 대조', keywords: ['성장률'], sourceId: 'review', quote: '시장 범위를 확인한다' }
  const info = { workType: 'market', actor: 'reviewer', chatId: id, eventId: 'review', kind: 'review_feedback' }
  const first = await chatTransaction((tx) => publishLessons(tx, [lesson], info))
  const repeat = await chatTransaction((tx) => publishLessons(tx, [lesson], info))
  assert.deepEqual(repeat, first)
  const second = await chatTransaction((tx) => publishLessons(tx, [{ ...lesson, criterion: '시장 범위와 기간 확인' }], { ...info, eventId: 'review2' }))
  assert.equal(second[0].version, 2)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM khala_knowledge_version')).rows[0].count, 2)
  const workspace = await chatWorkspace('writer', id)
  assert.equal(workspace.threads.length, 1)
  assert.equal(workspace.knowledge[0].sources.length, 2)
})

test('unsupported attachments fail before any messages are saved', async () => {
  await assert.rejects(prepareChatFiles([new File(['fake'], 'program.exe')]), (error) => error.status === 400)
  const result = await prepareChatFiles([new File(['검증할 보고서입니다.'], 'report.txt')])
  assert.equal(result.attachments[0].text, '검증할 보고서입니다.')
  assert.equal(result.assets.length, 1)
})

test('monitoring distinguishes read from reviewed and blocks unauthorized review requests', async () => {
  const id = await createChat('writer', 'general')
  const chat = await getChat(db, id, 'writer'); chat.revision = 2
  await saveChat(db, chat)
  await updateChatStatus('writer', id, 'requestReview', 2)
  await assert.rejects(updateChatStatus('peer', id, 'seen', 2), (e) => e.status === 403)
  await updateChatStatus('reviewer', id, 'seen', 2)
  const read = await getChat(db, id, 'reviewer')
  assert.equal(read.seenRevision, 2)
  assert.equal(read.reviewedRevision, undefined)
  assert.equal(read.status, 'review_requested')
  await assert.rejects(submitChatReview('reviewer', id, { base: 1 }), (e) => e.status === 409)
  read.revision = 4; await saveChat(db, read)
  await updateChatStatus('reviewer', id, 'seen', 1)
  assert.equal((await getChat(db, id, 'reviewer')).seenRevision, 2)
})

test('failed expert extraction is recoverable, idempotent, grounded and traceable to later use', async () => {
  const id = await createChat('reviewer', 'general')
  const source = { id: crypto.randomUUID(), role: 'user', actor: 'reviewer', text: '설문 응답률은 발송 대상자 수를 분모로 사용해야 합니다.', at: new Date().toISOString() }
  await saveMessage(db, id, source)
  await retryExpertLearning('reviewer', id, source.id, async () => { throw new Error('provider unavailable') })
  assert.equal((await chatWorkspace('reviewer', id)).messages[0].extraction.status, 'failed')
  const runner = async () => ({ data: { lessons: [{ key: 'survey_denominator', title: '설문 응답률', criterion: source.text, procedure: '발송 대상자 확인', keywords: ['응답률'], sourceId: source.id, quote: source.text }] } })
  await retryExpertLearning('reviewer', id, source.id, runner)
  const result = await chatWorkspace('reviewer', id)
  assert.equal(result.messages[0].extraction.status, 'complete')
  assert.ok(result.experience.some((e) => e.id === source.id && e.extraction.status === 'complete'))
  await retryExpertLearning('reviewer', id, source.id, () => { throw new Error('must not repeat') })
  const rule = result.knowledge.find((k) => k.key === 'survey_denominator')
  await saveMessage(db, id, { id: crypto.randomUUID(), role: 'assistant', text: '검증 결과', at: new Date().toISOString(), context: [{ id: rule.id, version: 1 }] })
  const detail = await knowledgeDetail('reviewer', rule.id)
  assert.equal(detail.versions.length, 1)
  assert.equal(detail.sources[0].canOpen, true)
  assert.equal(detail.uses.length, 1)
  assert.equal((await knowledgeDetail('writer', rule.id)).uses.length, 0)
  await assert.rejects(changeKnowledge('writer', rule.id, 1, false), (e) => e.status === 403)
  await changeKnowledge('reviewer', rule.id, 1, false)
  const updated = await knowledgeDetail('reviewer', rule.id)
  assert.equal(retrieveKnowledge([updated.item], 'general', '응답률').length, 0)
  assert.equal(updated.versions.length, 2)
  assert.equal(updated.uses[0].version, '1')
  await assert.rejects(changeKnowledge('reviewer', rule.id, 1, true), (e) => e.status === 409)
})

test('stale LLM synthesis cannot overwrite a newer criterion', async () => {
  const rule = (await db.query("SELECT data FROM khala_knowledge WHERE rule_key='survey_denominator'")).rows[0].data
  await assert.rejects(chatTransaction((tx) => publishLessons(tx, [rule], { workType: 'general', actor: 'reviewer', eventId: 'stale', kind: 'review_feedback', expected: [{ key: rule.key, version: 1 }] })), (e) => e.status === 409)
  assert.equal((await knowledgeDetail('reviewer', rule.id)).item.version, 2)
})
