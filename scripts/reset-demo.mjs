import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

// Run only with the KHALA server stopped. Deliberately limited to the local demo DB.
if (!process.argv.includes('--confirm')) throw new Error('서버를 종료한 뒤 --confirm으로 실행하세요. 로컬 대화, 첨부, 리뷰, 검증 기준 이력을 모두 삭제합니다.')
if (process.env.DATABASE_URL || process.env.KHALA_DATA_DIR) throw new Error('외부 DB나 사용자 지정 데이터 경로에는 이 로컬 초기화 명령을 사용할 수 없습니다.')
const root = resolve(import.meta.dirname, '..')
if (JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name !== 'khala') throw new Error('KHALA 경로를 확인하세요.')
const db = new PGlite(resolve(root, '.khala'))
try {
  await db.transaction(async (tx) => {
    for (const table of ['khala_rag_embedding','khala_rag_case','khala_reaction_event','khala_chat_reaction','khala_knowledge_version', 'khala_knowledge', 'khala_chat_review', 'khala_chat_file', 'khala_chat_message', 'khala_chat']) {
      if ((await tx.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) await tx.query(`DELETE FROM ${table}`)
    }
  })
  console.log('로컬 대화, 첨부, 리뷰, 검증 기준 이력을 초기화했어요.')
} finally { await db.close() }
