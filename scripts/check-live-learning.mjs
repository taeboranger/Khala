import nextEnv from '@next/env'
nextEnv.loadEnvConfig(process.cwd())
// End-to-end synthetic scenario, entirely in memory. No app DB changes.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { inspectPdf, renderPdfPage } from '../lib/pdf.js'
import { synthesizeReview } from '../lib/generation.js'
import { verifyPdfDocument } from '../lib/document-verification.js'
import { apply, current, guideFor, newState, pdfCards, view } from '../lib/workflow.js'

const state = newState()
const content = await readFile('output/pdf/test-kit/01-market-scope-error.pdf')
const id = apply(state, 'writer', { op: 'uploadPdf', title: 'LLM 문서 검증 확인', workType: 'market',
  pdf: { id: crypto.randomUUID(), name: '01-market-scope-error.pdf', pages: await inspectPdf(content) } })
const doc = state.docs.find((item) => item.id === id)
const act = (actor, op, data = {}) => apply(state, actor, { op, doc: id, base: current(doc).number, ...data })
const first = JSON.parse(await readFile('tmp/verification/01-market-scope-error.pdf.json', 'utf8'))
assert.equal(first.status, 'complete')
act('writer', 'verifyPdfWithAi', { aiResult: first })
await writeFile('tmp/verification/ui-state.json', JSON.stringify({ ...view(state, 'writer'), modelReady: true }))
await writeFile('tmp/verification/ui-page.png', await renderPdfPage(content, 1))
act('writer', 'submit')
const copy = JSON.parse(await readFile('output/pdf/test-kit/feedback-copy.json', 'utf8')).A
const entry = { page: 1, issue: copy['발견한 문제'], evidence: copy['판단 근거'], action: copy['작성자가 할 일'], requestChanges: true }
const synthesis = await synthesizeReview(state, doc, current(doc), entry)
assert.equal(synthesis.mode, 'llm')
act('reviewer', 'feedback', { ...entry, synthesis })
const corrected = await readFile('output/pdf/test-kit/02-market-scope-fixed.pdf')
act('writer', 'replacePdf', { pdf: { id: crypto.randomUUID(), name: '02-market-scope-fixed.pdf', pages: await inspectPdf(corrected) } })
assert.equal(doc.version, 2)
const result = await verifyPdfDocument(doc, guideFor(state, doc))
await writeFile('tmp/verification/learned-v2.json', JSON.stringify({ guide: guideFor(state, doc), result }, null, 2))
assert.equal(result.status, 'complete')
act('writer', 'verifyPdfWithAi', { aiResult: result })
const cards = pdfCards(current(doc), guideFor(state, doc))
assert.ok(cards.some((card) => card.key === 'review'))
console.log(JSON.stringify({ guideVersion: doc.version, rules: guideFor(state, doc).rules,
  summary: result.summary, checks: cards.map(({ key, status }) => ({ key, status })) }))
assert.ok(cards.every((card) => card.status === 'pass'), 'Inspect AI findings before approval')
act('writer', 'submit')
act('reviewer', 'approve')
console.log('Synthetic LLM feedback → v2 → corrected PDF AI verification → final approval: passed; app database untouched.')
