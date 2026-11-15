import { currentActor } from './auth.js'
import { connection } from './store.js'
import { ensure, people } from './workflow.js'
import { syncPdfKnowledge } from './chat-knowledge.js'
import { ragDatabase } from './chat-rag.js'

const ddl = [
  `CREATE TABLE IF NOT EXISTS khala_chat (id uuid PRIMARY KEY, owner text NOT NULL, reviewer text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS khala_chat_message (seq bigserial PRIMARY KEY, id uuid UNIQUE NOT NULL, chat_id uuid NOT NULL REFERENCES khala_chat(id), data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS khala_chat_file (id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES khala_chat(id), message_id uuid NOT NULL, name text NOT NULL, mime text NOT NULL, content bytea NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS khala_chat_review (id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES khala_chat(id), data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS khala_knowledge (id uuid PRIMARY KEY, work_type text NOT NULL, rule_key text NOT NULL, data jsonb NOT NULL, UNIQUE(work_type, rule_key))`,
  `CREATE TABLE IF NOT EXISTS khala_knowledge_version (id uuid NOT NULL REFERENCES khala_knowledge(id), version integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(id,version))`,
  `CREATE INDEX IF NOT EXISTS khala_chat_message_order ON khala_chat_message(chat_id,seq)`,
]
export async function chatDatabase() {
  const conn = await connection()
  globalThis.khalaChatSchema ??= (async () => { for (const sql of ddl) await conn.db.query(sql) })().catch((error) => { delete globalThis.khalaChatSchema; throw error })
  await globalThis.khalaChatSchema
  return conn
}
export async function chatTransaction(work) {
  const { db, external } = await chatDatabase()
  if (!external) return db.transaction(work)
  const tx = await db.connect()
  try { await tx.query('BEGIN'); const result = await work(tx); await tx.query('COMMIT'); return result }
  catch (error) { await tx.query('ROLLBACK'); throw error } finally { tx.release() }
}
export function chatActor() { return currentActor() }
export function uuid(value) { ensure(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), '대상 정보를 확인하세요.'); return value }
export async function getChat(tx, id, actor, lock = false) {
  const { rows } = await tx.query(`SELECT * FROM khala_chat WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)])
  const row = rows[0]
  ensure(row && (row.owner === actor || row.reviewer === actor), '이 대화를 볼 수 없어요.', 403)
  return { ...row.data, id: row.id, owner: row.owner, reviewer: row.reviewer }
}
export async function saveChat(tx, chat) {
  chat.updatedAt = new Date().toISOString()
  await tx.query('UPDATE khala_chat SET data=$2::jsonb, updated_at=now() WHERE id=$1', [chat.id, JSON.stringify(chat)])
}
export async function messagesFor(tx, id) {
  return (await tx.query('SELECT data FROM khala_chat_message WHERE chat_id=$1 ORDER BY seq', [id])).rows.map((row) => row.data)
}
export async function saveMessage(tx, chatId, message) {
  await tx.query('INSERT INTO khala_chat_message(id,chat_id,data) VALUES($1,$2,$3::jsonb)', [message.id, chatId, JSON.stringify(message)])
}
export async function listKnowledge(tx) {
  return (await tx.query('SELECT data FROM khala_knowledge')).rows.map((row) => row.data)
}
export async function chatWorkspace(actor, id) {
  await ragDatabase()
  await chatTransaction(syncPdfKnowledge)
  const { db } = await chatDatabase()
  const rows = (await db.query(`SELECT c.*, (SELECT count(*)::int FROM khala_chat_message m WHERE m.chat_id=c.id) AS message_count,
    (SELECT count(*)::int FROM khala_chat_review r WHERE r.chat_id=c.id) AS review_count
    FROM khala_chat c WHERE owner=$1 OR reviewer=$1 ORDER BY updated_at DESC`, [actor])).rows
  const threads = rows.map((row) => ({ ...row.data, id: row.id, owner: row.owner, reviewer: row.reviewer, messageCount: row.message_count, reviewCount: row.review_count, updatedAt: row.updated_at }))
  const knowledge = await listKnowledge(db)
  const experience = people[actor].role === '리뷰어' ? (await db.query(`SELECT m.data, c.id AS chat_id, c.data->>'title' AS title, c.data->>'workType' AS work_type
    FROM khala_chat_message m JOIN khala_chat c ON c.id=m.chat_id WHERE c.owner=$1 AND m.data->>'role'='user' ORDER BY m.seq DESC LIMIT 100`, [actor])).rows.map((row) => ({ ...row.data, chatId: row.chat_id, title: row.title, workType: row.work_type })) : []
  const result = { threads, knowledge, experience }
  if (!id) return result
  const chat = await getChat(db, id, actor)
  const reactions = (await db.query('SELECT message_id,actor,data FROM khala_chat_reaction WHERE chat_id=$1', [id])).rows
  return { ...result, chat, messages: (await messagesFor(db, id)).map((m) => ({ ...m, reactions: reactions.filter((r) => r.message_id === m.id).map((r) => ({ actor: r.actor, ...r.data })) })),
    reviews: (await db.query('SELECT data FROM khala_chat_review WHERE chat_id=$1 ORDER BY data->>\'at\'', [id])).rows.map((row) => row.data) }
}

export async function knowledgeDetail(actor, id) {
  const { db } = await chatDatabase()
  const item = (await db.query('SELECT data FROM khala_knowledge WHERE id=$1', [uuid(id)])).rows[0]?.data
  ensure(item, '검증 기준을 찾을 수 없어요.', 404)
  const versions = (await db.query('SELECT data FROM khala_knowledge_version WHERE id=$1 ORDER BY version DESC', [id])).rows.map((r) => r.data)
  const visible = new Set((await db.query('SELECT id FROM khala_chat WHERE owner=$1 OR reviewer=$1', [actor])).rows.map((r) => r.id))
  const uses = (await db.query(`SELECT m.id, m.chat_id, m.data->>'at' AS at, c.data->>'title' AS title, entry->>'version' AS version
    FROM khala_chat_message m JOIN khala_chat c ON c.id=m.chat_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.data->'context','[]'::jsonb)) entry
    WHERE entry->>'id'=$1 AND (c.owner=$2 OR c.reviewer=$2) ORDER BY m.seq DESC LIMIT 100`, [id, actor])).rows
  return { item, versions, sources: item.sources.map((s) => ({ ...s, canOpen: visible.has(s.chatId) })), uses }
}
