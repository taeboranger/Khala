import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { ragDatabase, retrieveRag, saveRagCase, bm25, fuseRanks, chunks } from '../lib/chat-rag.js'
import { createChat, reactToMessage } from '../lib/chat-service.js'
import { saveMessage, chatWorkspace, chatTransaction } from '../lib/chat-store.js'

const db = new PGlite()
globalThis.khalaConnection = Promise.resolve({ db, external: false })
after(() => db.close())
const vector = [1, ...Array(383).fill(0)]
let calls = 0
const engine = { embeddingModelId: async () => 'test-384', embedTexts: async (texts) => { calls += texts.length; return texts.map(() => vector) } }
const failEngine = { embeddingModelId: async () => { throw new Error('offline') } }
const rule = { id: crypto.randomUUID(), key: 'market_scope', version: 1, workType: 'market', title: '시장 비교', criterion: '시장 범위가 같아야 성장률 비교 가능', procedure: '범위 대조', keywords: ['성장률'], active: true }

test('hybrid ranking merges semantic-only and lexical hits, deduplicates source chunks', () => {
  const docs = [{ id: 'one', text: '시장 성장률' }, { id: 'one', text: '국내 글로벌 범위' }, { id: 'two', text: '동일한 모집단을 비교한다' }]
  const ranked = fuseRanks(docs, bm25(docs, '시장 성장률'), [{index:0,score:.4},{index:1,score:.5},{index:2,score:.9}])
  assert.equal(ranked.length, 2)
  assert.ok(ranked.some((r) => r.id === 'two'))
  assert.ok(chunks('a'.repeat(2200)).length > 1)
})

test('reactions persist, votes are exclusive, likes independent, and own/unassigned votes denied', async () => {
  await ragDatabase()
  const id = await createChat('writer','market'); const messageId = crypto.randomUUID()
  await saveMessage(db,id,{id:messageId,role:'user',actor:'writer',text:'시장 성장률의 범위 비교',at:new Date().toISOString()})
  await assert.rejects(reactToMessage('writer',id,messageId,'recommend',true),(e)=>e.status===403)
  await assert.rejects(reactToMessage('peer',id,messageId,'recommend',true),(e)=>e.status===403)
  await reactToMessage('reviewer',id,messageId,'recommend',true)
  await reactToMessage('reviewer',id,messageId,'like',true)
  await reactToMessage('reviewer',id,messageId,'disrecommend',true)
  const reaction = (await chatWorkspace('writer',id)).messages[0].reactions[0]
  assert.equal(reaction.vote,'disrecommend'); assert.equal(reaction.liked,true)
  await reactToMessage('reviewer',id,messageId,'disrecommend',false)
  assert.equal((await chatWorkspace('writer',id)).messages[0].reactions[0].vote,null)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM khala_reaction_event')).rows[0].n,4)
})

test('RAG enforces case permissions, excludes own current thread, caches vectors and withdraws stale criteria', async () => {
  const source = await createChat('reviewer','market')
  const messageId = crypto.randomUUID()
  await saveMessage(db,source,{id:messageId,role:'user',actor:'reviewer',text:'시장 성장률 비교 원칙',at:new Date().toISOString()})
  await reactToMessage('peer',source,messageId,'recommend',true)
  const dest = await createChat('writer','market')
  const request = {actor:'writer',chatId:dest,workType:'market',query:'시장 성장률 범위 비교',knowledge:[rule]}
  let result = await retrieveRag(request,engine)
  assert.ok(!result.cases.some((c)=>c.chatId===source), 'private recommendation must not leak to writer')
  const self = await retrieveRag({...request,actor:'reviewer',chatId:source},engine)
  assert.ok(!self.cases.some((c)=>c.chatId===source),'exclude current thread')
  await chatTransaction((tx)=>saveRagCase(tx,{applicable:true,situation:'시장 성장률을 비교하는 업무',problem:'지역 범위가 다른 수치를 비교함',resolution:'동일 범위 자료를 요청한다'}, {id:`expert:${messageId}`,chatId:source,messageId,actor:'reviewer',workType:'market',outcome:'expert_judgment',ruleRefs:[{id:rule.id,version:1}]}))
  result = await retrieveRag(request,engine)
  assert.equal(result.trace.mode,'hybrid')
  assert.ok(result.cases.some((c)=>c.id===`expert:${messageId}`))
  assert.equal(result.cases.find((c)=>c.id===`expert:${messageId}`).canOpen,false)
  const previousCalls=calls
  await retrieveRag(request,engine)
  assert.equal(calls-previousCalls,1,'only new query vector; passages are cached')
  assert.ok(!(await retrieveRag({...request,knowledge:[{...rule,active:false}]},engine)).cases.some((c)=>c.id===`expert:${messageId}`))
  assert.equal((await retrieveRag({...request,workType:'general'},engine)).cases.length,0)
  const fallback=await retrieveRag(request,failEngine)
  assert.equal(fallback.trace.mode,'keyword_fallback')
  assert.ok(fallback.trace.warning)
})
