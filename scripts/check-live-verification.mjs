import nextEnv from '@next/env'
nextEnv.loadEnvConfig(process.cwd())
// Synthetic files only; does not connect to the app database or publish guides.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { inspectPdf } from '../lib/pdf.js'
import { verifyPdfDocument } from '../lib/document-verification.js'
import { apply, guideFor, newState } from '../lib/workflow.js'

const samples = [
  ['01-market-scope-error.pdf', 'market'],
  ['02-market-scope-fixed.pdf', 'market'],
  ['03-reviewer-metric-error.pdf', 'market'],
  ['06-general-survey-error.pdf', 'general'],
]
const state = newState()
await mkdir('tmp/verification', { recursive: true })
for (const [name, workType] of samples) {
  const pages = await inspectPdf(await readFile(`output/pdf/test-kit/${name}`))
  const docId = apply(state, 'writer', { op: 'uploadPdf', title: name, workType, pdf: { id: crypto.randomUUID(), name, pages } })
  const doc = state.docs.find((item) => item.id === docId)
  const result = await verifyPdfDocument(doc, guideFor(state, doc))
  await writeFile(`tmp/verification/${name}.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ name, status: result.status, summary: result.summary ?? result.error,
    checks: Object.entries(result.records).map(([id, record]) => ({ id, status: record.status, reason: record.reason })) }))
  if (result.status !== 'complete') process.exitCode = 1
}
