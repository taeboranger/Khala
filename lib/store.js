import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { newState } from './workflow.js'

async function connect() {
  const directory = resolve(process.cwd(), '.khala')
  const url = process.env.DATABASE_URL
  if (!url) await mkdir(directory, { recursive: true })
  const db = url ? new pg.Pool({ connectionString: url }) : new PGlite(directory)
  await db.query('CREATE TABLE IF NOT EXISTS khala_workspace (id integer PRIMARY KEY, state jsonb NOT NULL)')
  await db.query('CREATE TABLE IF NOT EXISTS khala_pdf (id uuid PRIMARY KEY, content bytea NOT NULL)')
  await db.query('INSERT INTO khala_workspace VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(newState())])
  return { db, external: !!url }
}

export function connection() {
  globalThis.khalaConnection ??= connect().catch((error) => {
    delete globalThis.khalaConnection
    throw error
  })
  return globalThis.khalaConnection
}

export async function readState() {
  const { db } = await connection()
  return (await db.query('SELECT state FROM khala_workspace WHERE id = 1')).rows[0].state
}

export async function readPdf(id) {
  const { db } = await connection()
  const { rows } = await db.query('SELECT content FROM khala_pdf WHERE id = $1', [id])
  return rows[0]?.content
}

async function write(tx, update, pdf) {
  const { rows } = await tx.query('SELECT state FROM khala_workspace WHERE id = 1 FOR UPDATE')
  const state = rows[0].state
  const result = update(state)
  if (pdf) await tx.query('INSERT INTO khala_pdf VALUES ($1, $2)', [pdf.id, pdf.content])
  await tx.query('UPDATE khala_workspace SET state = $1::jsonb WHERE id = 1', [JSON.stringify(state)])
  return { state, result }
}

export async function changeState(update, pdf) {
  const { db, external } = await connection()
  if (!external) return db.transaction((tx) => write(tx, update, pdf))
  const tx = await db.connect()
  try {
    await tx.query('BEGIN')
    const response = await write(tx, update, pdf)
    await tx.query('COMMIT')
    return response
  } catch (error) {
    await tx.query('ROLLBACK')
    throw error
  } finally {
    tx.release()
  }
}
