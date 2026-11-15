import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export const dataDirectory = () => resolve(process.env.KHALA_DATA_DIR || resolve(process.cwd(), '.khala'))
async function connect() {
  const directory = dataDirectory()
  const url = process.env.DATABASE_URL
  if (!url) await mkdir(directory, { recursive: true })
  const db = url ? new pg.Pool({ connectionString: url }) : new PGlite(directory)
  return { db, external: !!url }
}

export function connection() {
  globalThis.khalaConnection ??= connect().catch((error) => {
    delete globalThis.khalaConnection
    throw error
  })
  return globalThis.khalaConnection
}
