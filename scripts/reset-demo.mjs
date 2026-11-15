import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { newState } from '../lib/workflow.js'

// Run only with the KHALA server stopped. Deliberately limited to the local demo DB.
if (!process.argv.includes('--confirm')) throw new Error('서버를 종료한 뒤 --confirm으로 실행하세요. 문서, PDF, 대화, 첨부, 리뷰, 검증 기준 이력을 모두 삭제합니다.')
if (process.env.DATABASE_URL) throw new Error('외부 DB에는 이 로컬 초기화 명령을 사용할 수 없습니다.')
const root = resolve(import.meta.dirname, '..')
if (JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name !== 'khala') throw new Error('KHALA 경로를 확인하세요.')
const db = new PGlite(resolve(root, '.khala'))
try {
  const before = await db.query('SELECT state FROM khala_workspace WHERE id = 1')
  const stored = before.rows[0]?.state
  const pdfs = await db.query('SELECT count(*)::integer AS count FROM khala_pdf')
  await db.transaction(async (tx) => {
    for (const table of ['khala_rag_embedding','khala_rag_case','khala_reaction_event','khala_chat_reaction','khala_knowledge_version', 'khala_knowledge', 'khala_chat_review', 'khala_chat_file', 'khala_chat_message', 'khala_chat']) {
      if ((await tx.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) await tx.query(`DELETE FROM ${table}`)
    }
    await tx.query('DELETE FROM khala_pdf')
    await tx.query('DELETE FROM khala_workspace')
    await tx.query('INSERT INTO khala_workspace VALUES (1, $1::jsonb)', [JSON.stringify(newState())])
  })
  console.log(JSON.stringify({ deleted: { documents: stored?.docs.length ?? 0, pdfs: pdfs.rows[0].count,
    feedback: stored?.docs.reduce((sum, doc) => sum + doc.feedback.length, 0) ?? 0,
    guides: (stored?.guides.length ?? 0) + (stored?.generalGuides?.length ?? 0) },
    current: { documents: 0, pdfs: 0, marketGuide: 1, generalGuide: 1 } }, null, 2))
} finally { await db.close() }
