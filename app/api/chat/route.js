import { authenticated, currentActor } from '../../../lib/auth.js'
import { NextResponse } from 'next/server'
import { chatActor, chatDatabase, chatWorkspace, getChat, uuid, knowledgeDetail } from '../../../lib/chat-store.js'
import { createChat, prepareChatFiles, sendChat, submitChatReview, updateChatStatus, retryExpertLearning, changeKnowledge, reactToMessage } from '../../../lib/chat-service.js'
import { ensure } from '../../../lib/workflow.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
function failure(error) {
  console.warn('KHALA chat API:', error.name, error.status ?? '')
  return NextResponse.json({ error: error.status ? error.message : '요청을 처리하지 못했어요. 입력과 파일을 확인하세요.' }, { status: error.status ?? 500 })
}
async function handleGET(request) {
  try {
    const actor = chatActor(request)
    const query = request.nextUrl.searchParams
    const id = query.get('id')
    if (query.has('knowledge')) return NextResponse.json(await knowledgeDetail(actor, query.get('knowledge')))
    if (query.has('file')) {
      const { db } = await chatDatabase()
      await getChat(db, id, actor)
      const asset = (await db.query('SELECT * FROM khala_chat_file WHERE id=$1 AND chat_id=$2', [uuid(query.get('file')), id])).rows[0]
      ensure(asset, '첨부파일을 찾을 수 없어요.', 404)
      return new Response(asset.content, { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${asset.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}` } })
    }
    return NextResponse.json(await chatWorkspace(actor, id))
  } catch (error) { return failure(error) }
}
async function handlePOST(request) {
  try {
    const actor = chatActor(request)
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      ensure(Number(request.headers.get('content-length')) <= 42 * 1024 * 1024, '첨부파일 전체 용량은 40MB 이하로 보내세요.', 413)
      const form = await request.formData()
      const id = uuid(form.get('id'))
      const { db } = await chatDatabase()
      ensure((await getChat(db, id, actor)).owner === actor, '자신의 대화에만 메시지를 보낼 수 있어요.', 403)
      const prepared = await prepareChatFiles(form.getAll('files').filter((item) => item instanceof File))
      await sendChat(actor, id, { text: form.get('text') ?? '', requestId: form.get('requestId'), ...prepared })
      return NextResponse.json(await chatWorkspace(actor, id))
    }
    const body = await request.json()
    let id = body.id
    if (body.op === 'create') id = await createChat(actor, body.workType ?? 'general')
    else if (body.op === 'retry') await sendChat(actor, uuid(id), { retry: true })
    else if (body.op === 'review') await submitChatReview(actor, uuid(id), body)
    else if (body.op === 'reaction') await reactToMessage(actor, uuid(id), uuid(body.messageId), body.action, body.enabled)
    else if (['seen', 'requestReview'].includes(body.op)) await updateChatStatus(actor, uuid(id), body.op, body.base)
    else if (body.op === 'learn') await retryExpertLearning(actor, uuid(id), uuid(body.messageId))
    else if (body.op === 'knowledgeActive') { await changeKnowledge(actor, body.knowledgeId, body.base, body.active); return NextResponse.json(await chatWorkspace(actor)) }
    else throw Object.assign(new Error('지원하지 않는 요청이에요.'), { status: 400 })
    return NextResponse.json(await chatWorkspace(actor, id))
  } catch (error) { return failure(error) }
}

export const GET = (request) => authenticated(request, () => handleGET(request))

export const POST = (request) => authenticated(request, () => handlePOST(request))
