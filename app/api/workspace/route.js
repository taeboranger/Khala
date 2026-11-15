import { authenticated, currentActor } from '../../../lib/auth.js'
import { NextResponse } from 'next/server'
import { generate, draftProposal, modelReady, synthesizeReview } from '../../../lib/generation'
import { changeState, readState } from '../../../lib/store'
import { runDocumentVerification } from '../../../lib/run-document-verification'
import { apply, buildProposalInput, canSee, current, ensure, feedbackNeedsSynthesis, openForReview, people, view, WorkflowError } from '../../../lib/workflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function actorFor() { return currentActor() }

function failure(error) {
  if (!(error instanceof WorkflowError)) console.error(error)
  return NextResponse.json({ error: error instanceof WorkflowError ? error.message : '작업을 처리하지 못했어요.' }, { status: error.status ?? 500 })
}

function payload(state, actor, result) {
  return NextResponse.json({ ...view(state, actor), result, modelReady: modelReady() })
}

async function handleGET(request) {
  try {
    const actor = actorFor(request)
    return payload(await readState(), actor)
  } catch (error) {
    return failure(error)
  }
}

async function handlePOST(request) {
  try {
    const actor = actorFor(request)
    const body = await request.json()
    ensure(body && typeof body === 'object' && typeof body.op === 'string', '작업 내용을 확인하세요.')
    ensure(!['uploadPdf', 'replacePdf'].includes(body.op), 'PDF는 파일 업로드로 등록하세요.')
    delete body.synthesis
    delete body.aiResult
    if (body.op === 'verifyPdfWithAi') {
      const { state, result } = await runDocumentVerification(body.doc, actor, body.base)
      return payload(state, actor, result)
    }
    if (body.op === 'retryFeedback') {
      const state = await readState()
      const doc = state.docs.find((item) => item.id === body.doc)
      ensure(doc && canSee(doc, actor) && people[actor].role === '리뷰어' &&
        (doc.reviewer === actor || doc.owner === actor), '담당 리뷰어가 AI 정리를 실행할 수 있어요.', 403)
      const entry = doc.feedback.find((item) => item.id === body.feedback)
      ensure(entry, '피드백을 찾을 수 없어요.', 404)
      if (feedbackNeedsSynthesis(state, doc, entry)) body.synthesis = await synthesizeReview(state, doc, doc.revisions.find((item) => item.number === entry.revision), entry)
    }
    if (body.op === 'feedback') {
      const state = await readState()
      const doc = state.docs.find((item) => item.id === body.doc)
      ensure(doc && canSee(doc, actor), '문서를 찾을 수 없어요.', 404)
      ensure(openForReview(doc, actor), '담당 리뷰어만 피드백을 남길 수 있어요.', 403)
      const revision = current(doc)
      ensure(revision.number === body.base, '문서가 변경됐어요. 최신 버전에서 다시 시도하세요.', 409)
      body.synthesis = revision.pdf ? await synthesizeReview(state, doc, revision, body) : null
    }
    if (body.op === 'generation' || body.op === 'proposal') {
      const state = await readState()
      const doc = state.docs.find((item) => item.id === body.doc)
      ensure(doc && canSee(doc, actor), '문서를 찾을 수 없어요.', 404)
      ensure(current(doc).number === body.base, '문서가 변경됐어요. 최신 버전에서 다시 시도하세요.', 409)
      if (body.op === 'generation') {
        ensure(doc.owner === actor && ['draft', 'changes'].includes(doc.status), '작성 중인 자기 문서에서 AI를 사용할 수 있어요.', 403)
        body.result = await generate(state, doc, body)
      } else {
        ensure(people[actor].role === '리뷰어', '리뷰어만 개선안을 등록할 수 있어요.', 403)
        if (current(doc).pdf) {
          const origin = buildProposalInput(doc, actor, body)
          body.synthesis = await synthesizeReview(state, doc, current(doc), { ...origin, page: origin.pdfPage, action: origin.issue })
        } else {
          body.rule = await draftProposal(state, doc, actor, body)
        }
      }
    }
    const { state, result } = await changeState((workspace) => apply(workspace, actor, body))
    return payload(state, actor, result)
  } catch (error) {
    return failure(error)
  }
}

export const GET = (request) => authenticated(request, () => handleGET(request))

export const POST = (request) => authenticated(request, () => handlePOST(request))
