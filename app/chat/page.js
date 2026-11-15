'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession, AccountNav } from '../session-provider'
import { AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive, useExternalStoreRuntime } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { people, workTypes } from '../../lib/workflow'
import { Monitoring, Experience, KnowledgeLibrary } from './team-panels'
import './chat.css'

const statusText = { active: '대화 중', review_requested: '리뷰 요청', reviewed: '검토 완료', changes: '보완 필요' }
const date = (value) => new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const convertMessage = (message) => ({ id: message.id, role: message.role, content: [{ type: 'text', text: message.text || '첨부파일을 확인해 주세요.' }], createdAt: new Date(message.at) })

export default function ChatPage() {
  const {user}=useSession()
  const actor=user.id
  const [data, setData] = useState({ threads: [], knowledge: [] })
  const [id, setId] = useState(null)
  const [mode, setMode] = useState('mine')
  const [type, setType] = useState('market')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState(null)
  const [target, setTarget] = useState(null)
  const [knowledgeId, setKnowledgeId] = useState(null)
  const [focusMessage, setFocusMessage] = useState(null)
  const [feedbackModal, setFeedbackModal] = useState(null)
  const lock = useRef(false)
  const chat = data.chat
  const reviewer = chat?.reviewer === actor && chat?.owner !== actor
  const headers = {  }

  useEffect(() => { fetch('/api/connection').then((r) => r.json()).then(setConnection).catch(() => setConnection({ connected: false })) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setTarget(null)
    fetch(`/api/chat${id ? `?id=${id}` : ''}`, { headers: {  }, signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result) })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [actor, id])
  useEffect(() => {
    if (busy) return
    const controller = new AbortController()
    let refreshing = false
    const timer = setInterval(async () => {
      if (refreshing || lock.current || document.visibilityState === 'hidden') return
      refreshing = true
      try { const r = await fetch(`/api/chat${id ? `?id=${id}` : ''}`, { headers: {  }, signal: controller.signal }); const next = await r.json(); if (r.ok && !controller.signal.aborted && !lock.current) setData(next) } catch {} finally { refreshing = false }
    }, 5000)
    return () => { clearInterval(timer); controller.abort() }
  }, [id, actor, busy])
  useEffect(() => {
    if (!reviewer || !['review','mine'].includes(mode) || !chat || chat.revision <= (chat.seenRevision ?? 0) || busy) return
    const controller = new AbortController()
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'seen', id: chat.id, base: chat.revision }), signal: controller.signal }).catch(() => {})
    return () => controller.abort()
  }, [chat?.id, chat?.revision, chat?.seenRevision, reviewer, actor, mode, busy])
  useEffect(() => {
    if (!focusMessage || !data.messages?.some((m) => m.id === focusMessage)) return
    document.getElementById(`message-${focusMessage}`)?.scrollIntoView({ block: 'center' })
  }, [focusMessage, id, data.messages?.length])

  async function mutate(body, label, optimistic) {
    if (lock.current) return null
    lock.current = true; setBusy(label); setError('')
    if (optimistic) setData((old) => ({ ...old, messages: [...(old.messages ?? []), optimistic] }))
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: body instanceof FormData ? headers : { ...headers, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setData(result)
      if (result.chat) setId(result.chat.id)
      return result
    } catch (err) {
      setError(err.message || '연결이 끊겼어요. 잠시 후 다시 시도하세요.')
      if (id) try { const fresh = await fetch(`/api/chat?id=${id}`, { headers }); if (fresh.ok) setData(await fresh.json()) } catch {}
      return null
    } finally { lock.current = false; setBusy('') }
  }
  async function create() { const result = await mutate({ op: 'create', workType: type }, '대화 준비 중'); if (result) setMode('mine') }
  function choose(thread) { setMode(thread.owner === actor ? 'mine' : 'review'); if (id === thread.id) return; setData((old) => ({ threads: old.threads, knowledge: old.knowledge, experience: old.experience })); setId(thread.id); setError(''); setTarget(null); setFocusMessage(null) }
  function openSource(chatId, messageId) { const thread = data.threads.find((c) => c.id === chatId); if (thread) { choose(thread); setFocusMessage(messageId) } }
  function openFeedback(messageId = null) { setFeedbackModal({ chat: { ...chat }, messageId, messages: [...(data.messages ?? [])] }); setError('') }
  async function send(text, files) {
    const requestId = crypto.randomUUID(); const form = new FormData()
    form.set('id', chat.id); form.set('text', text); form.set('requestId', requestId)
    files.forEach((file) => form.append('files', file))
    return mutate(form, 'AI가 답변을 작성하고 있어요', { id: requestId, role: 'user', text, at: new Date().toISOString(), attachments: files.map((file) => ({ name: file.name })) })
  }
  const responding = !!chat?.pending && Date.now() - Date.parse(chat.pending.at) < (chat.pending.phase === 'retrieving' ? 600000 : 150000)
  const pending = !!busy || responding
  const responseError = chat?.lastError || (chat?.pending && !responding ? 'AI 응답이 중단됐어요. 저장된 질문에서 다시 시작할 수 있어요.' : '')
  const threads = data.threads.filter((thread) => mode === 'review' ? thread.reviewer === actor && thread.owner !== actor : thread.owner === actor)

  return <div className="chat-app">
    <aside className="chat-sidebar">
      <a className="chat-brand" href="/chat">KHALA<span>팀의 경험으로 더 나은 답변</span></a>
      <AccountNav/>
      <div className="chat-create"><label>이번 대화의 업무<select value={type} disabled={!!busy} onChange={(e) => setType(e.target.value)}>{Object.entries(workTypes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><button className="primary" disabled={!!busy} onClick={create}>＋ 새 대화</button></div>
      <nav className="chat-nav" aria-label="대화 탐색">
        <button aria-pressed={mode === 'mine'} disabled={!!busy} onClick={() => setMode('mine')}>내 대화</button>
        {people[actor].role === '리뷰어' && <><button aria-pressed={['review','monitor'].includes(mode)} disabled={!!busy} onClick={() => setMode('monitor')}>대화 모니터링 <span>{data.threads.filter((c) => c.reviewer === actor && c.owner !== actor && c.revision > (c.seenRevision ?? 0)).length}</span></button><button aria-pressed={mode === 'experience'} disabled={!!busy} onClick={() => setMode('experience')}>내 전문 지식 기록</button></>}
        <button aria-pressed={mode === 'knowledge'} disabled={!!busy} onClick={() => { setKnowledgeId(null); setMode('knowledge') }}>검증 기준 <span>{data.knowledge.length}</span></button>
      </nav>
      <div className="chat-thread-list">
        {['mine','review'].includes(mode) && threads.map((thread) => <button key={thread.id} className={thread.id === id ? 'active' : ''} disabled={!!busy} onClick={() => choose(thread)}><strong>{thread.title}</strong><small>{mode === 'review' ? `${people[thread.owner].name} · ` : ''}{statusText[thread.status]}</small></button>)}
        {mode !== 'knowledge' && !threads.length && <p className="chat-muted">{mode === 'review' ? '담당하는 대화가 아직 없어요.' : '새 대화를 시작해 보세요.'}</p>}
      </div>
      <footer><a href="/">PDF 문서 검증 ↗</a><span className={connection?.connected ? 'chat-online' : ''}>{connection ? connection.connected ? `${connection.provider} · ${connection.model}` : '모델 설정 필요' : '모델 확인 중'}</span></footer>
    </aside>
    <div className="chat-workspace">
      {error && <div className="chat-error" role="alert">{error}<button onClick={() => setError('')}>닫기</button></div>}
      {connection && !connection.connected && <div className="chat-error"><a href="/settings">모델 설정</a>에서 제공업체와 API 키를 연결하세요.</div>}
      {mode === 'monitor' ? <Monitoring threads={data.threads} actor={actor} open={choose} busy={!!busy} /> : mode === 'experience' ? <Experience items={data.experience} busy={!!busy} open={openSource} learn={(m) => mutate({ op: 'learn', id: m.chatId, messageId: m.id }, '전문 판단을 기준으로 정리하고 있어요')} /> : mode === 'knowledge' ? <KnowledgeLibrary items={data.knowledge} actor={actor} busy={!!busy} open={openSource} selected={knowledgeId} select={setKnowledgeId} changeActive={(r) => mutate({ op: 'knowledgeActive', knowledgeId: r.id, base: r.version, active: !r.active }, '검증 기준 사용 여부를 변경하고 있어요')} /> : loading ? <div className="chat-empty" role="status">대화를 불러오고 있어요…</div> : !chat ? <div className="chat-empty">
        <span className="chat-eyebrow">대화 → 리뷰 → 팀의 검증 기준</span><h1>일하면서 나눈 대화가<br />팀의 다음 답변을 바꿉니다.</h1><p>문서를 읽고, 이미지를 살펴보고, 함께 초안을 만드세요.<br />상사의 리뷰와 업무 노하우가 다음 대화의 기준이 됩니다.</p><button className="primary" onClick={create} disabled={!!busy}>AI와 업무 시작하기 →</button><small>대화와 첨부파일은 저장되며 담당 리뷰어가 볼 수 있습니다.</small>
      </div> : <>
        <header className="chat-header"><div><span className="chat-eyebrow">{workTypes[chat.workType]} · {people[chat.owner].name}의 대화</span><h1>{chat.title}</h1></div><div className="chat-line"><span className="chat-status">{statusText[chat.status]}</span>{chat.owner === actor && <button disabled={pending || !chat.revision || chat.status === 'review_requested'} onClick={() => mutate({ op: 'requestReview', id: chat.id, base: chat.revision }, '리뷰를 요청하고 있어요')}>리뷰 요청</button>}</div></header>
        <div className="chat-content">
          <section className="chat-conversation" aria-label="AI 대화">
            <Conversation key={`thread:${actor}:${chat.id}`} messages={data.messages ?? []} running={busy.startsWith('AI') || responding} reviewer={reviewer} pending={pending} onReview={openFeedback} actor={actor} chatId={chat.id} openSource={openSource} onReact={(messageId,action,enabled) => mutate({ op: 'reaction', id: chat.id, messageId, action, enabled }, '빠른 평가 저장 중')} />
            {(busy || responding) && <div className="chat-thinking" role="status"><span className="chat-pulse" />{busy || 'AI가 답변을 작성하고 있어요'}<small>완료되면 이 화면에 표시됩니다.</small></div>}
            {responseError && <div className="chat-error" role="alert">{responseError}{chat.owner === actor && <button disabled={pending} onClick={() => mutate({ op: 'retry', id: chat.id }, 'AI 응답 재시도 중')}>답변 다시 받기</button>}</div>}
            {chat.owner === actor ? <Composer key={`composer:${actor}:${chat.id}`} draftKey={`${actor}:${chat.id}`} disabled={pending} onSend={send} expert={people[actor].role === '리뷰어'} /> : <div className="chat-readonly">{people[chat.owner].name}의 대화입니다. 평가할 메시지를 선택하거나 오른쪽에 전체 의견을 남기세요.</div>}
          </section>
          <aside className="chat-inspector">
            <div className="chat-inspector-intro"><span className="chat-eyebrow">함께 개선하는 업무</span><h2>{reviewer ? '대화를 읽고 평가하세요' : '리뷰와 학습 기록'}</h2><p>담당 리뷰어 · {people[chat.reviewer].name}</p></div>
            {chat.summary && <details className="chat-summary"><summary>AI 업무 요약</summary><p>{chat.summary}</p><small>자동 요약입니다. 평가는 대화 원문과 함께 확인하세요.</small></details>}
            {chat.reviewedRevision > 0 && chat.revision > chat.reviewedRevision && <p className="chat-learning">마지막 평가 이후 새로운 대화가 있어요.</p>}
            {reviewer && <div className="feedback-entry"><button className="primary" disabled={pending} onClick={() => openFeedback()}>전체 대화 피드백</button><p>메시지를 우클릭하면 해당 메시지의 피드백을 남길 수 있어요. 추천·비추천·좋아요는 메시지 아래에서 바로 선택하세요.</p></div>}
            <div className="chat-review-list">{!(data.reviews?.length) && <p className="chat-muted">아직 평가가 없어요. 리뷰가 쌓이면 어떤 판단이 검증 기준이 되었는지 여기에 남습니다.</p>}{data.reviews?.map((review) => <article key={review.id} className="chat-review"><div className="chat-line"><strong>{review.verdict === 'good' ? '검토 완료' : '보완 필요'}</strong><small>{date(review.at)}</small></div><small>{people[review.actor].name} · {review.messageId ? '선택한 메시지' : '전체 대화'} · 대화 #{review.throughRevision} 기준</small><p>{review.comment}</p><div className="chat-learning">{review.learning === 'complete' ? review.published?.length ? `✓ 검증 기준 ${review.published.length}개 반영` : '저장됨 · 공통 기준으로 추출할 내용 없음' : review.learning === 'failed' ? '의견은 저장됨 · 기준 추출 실패' : '검증 기준 정리 중'}</div>{review.learning !== 'complete' && reviewer && <button disabled={pending} onClick={() => mutate({ op: 'review', id: chat.id, retryId: review.id }, '검증 기준 정리 재시도 중')}>기준 정리 다시 시도</button>}</article>)}</div>
          </aside>
        </div>
      </>}
    </div>
    {feedbackModal && <FeedbackModal busy={!!busy} error={error} close={() => setFeedbackModal(null)}>
      <ReviewForm key={`${feedbackModal.chat.id}:${feedbackModal.messageId || 'all'}`} chat={feedbackModal.chat} target={feedbackModal.messageId} messages={feedbackModal.messages} clearTarget={() => setFeedbackModal((old) => ({ ...old, messageId: null }))} busy={!!busy} submit={async (values) => {
        const result = await mutate({ op: 'review', id: feedbackModal.chat.id, base: feedbackModal.chat.revision, messageId: feedbackModal.messageId, ...values }, '피드백과 유사 사례를 정리하고 있어요')
        if (result) setFeedbackModal(null)
        return result
      }} />
    </FeedbackModal>}
  </div>
}

function FeedbackModal({ busy, error, close, children }) {
  const dialog = useRef(null)
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  return <dialog ref={dialog} className="feedback-modal" aria-labelledby="feedback-title" onCancel={(event) => { if (busy) event.preventDefault(); else close() }} onClick={(event) => { if (!busy && event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close() } }}>
    <div className="chat-line"><div><span className="chat-eyebrow">평가를 팀의 경험으로</span><h2 id="feedback-title">대화 피드백</h2></div><button type="button" disabled={busy} aria-label="피드백 닫기" onClick={close}>✕</button></div>
    {error && <p className="chat-error" role="alert">{error}</p>}{children}{busy && <p role="status" className="chat-learning">피드백을 저장하고 LLM이 검증 기준과 유사 사례를 정리하고 있어요…</p>}
  </dialog>
}

function Conversation({ messages, running, reviewer, pending, onReview, actor, chatId, onReact, openSource }) {
  const runtime = useExternalStoreRuntime({ messages, convertMessage, isRunning: running, onNew: async () => {} })
  return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="chat-runtime"><ThreadPrimitive.Viewport className="chat-scroll"><div className="chat-message-column">
    {!messages.length && <div className="chat-welcome"><h2>무엇을 함께 해볼까요?</h2><p>“이 PDF의 주장이 근거와 맞는지 확인해 줘.”<br />“이 차트를 해석하고 보고서 초안을 써 줘.”</p></div>}
    <ThreadPrimitive.Messages>{({ message }) => {
      const raw = messages.find((item) => item.id === message.id)
      if (!raw) return null
      const mine = raw.reactions?.find((r) => r.actor === actor)
      return <MessagePrimitive.Root id={`message-${raw.id}`} className={`chat-message ${raw.role}`} tabIndex={reviewer ? 0 : undefined} onContextMenu={(e) => { if (reviewer && !pending) { e.preventDefault(); onReview(raw.id) } }} onKeyDown={(e) => { if (reviewer && !pending && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); onReview(raw.id) } }}><div className="chat-message-byline"><strong>{raw.role === 'assistant' ? 'KHALA' : people[raw.actor]?.name ?? '작성자'}</strong><time>{date(raw.at)}</time>{reviewer && <button disabled={pending} onClick={() => onReview(raw.id)}>피드백 남기기</button>}</div><div className="chat-message-body"><MessagePrimitive.Parts components={{ Text: MarkdownTextPrimitive }} />{raw.attachments?.map((item, index) => <Attachment key={item.id || index} file={item} actor={actor} chatId={chatId} />)}</div>
        {(reviewer || raw.reactions?.some((r) => r.vote || r.liked)) && <div className="message-reactions" role="group" aria-label="메시지 빠른 평가">{[['recommend','추천','↑'],['disrecommend','비추천','↓'],['like','좋아요','♡']].map(([action,label,icon]) => {
          const pressed = action === 'like' ? !!mine?.liked : mine?.vote === action
          const count = raw.reactions?.filter((r) => action === 'like' ? r.liked : r.vote === action).length ?? 0
          return reviewer ? <button key={action} disabled={pending} aria-pressed={pressed} aria-label={label} title={`${label} ${pressed ? '취소' : '남기기'}`} onClick={() => onReact(raw.id,action,!pressed)}><span aria-hidden="true">{icon}</span> {label}{count > 0 && ` ${count}`}</button> : count > 0 ? <span key={action}>{icon} {label} {count}</span> : null
        })}</div>}
        {raw.extraction && <div className="chat-learning">전문 판단 원문 보존 · {raw.extraction.status === 'complete' ? `기준 ${raw.extraction.published.length}개 반영` : raw.extraction.status === 'empty' ? '재사용할 판단 없음' : '내 전문 지식 기록에서 추출 상태 확인'}</div>}
        {!!raw.context?.length && <details className="chat-context"><summary>적용된 검증 기준 {raw.context.length}개</summary>{raw.context.map((item) => <div key={item.id}><strong>{item.title} · v{item.version}</strong><p>{item.criterion}</p></div>)}</details>}
        {!!raw.cases?.length && <details className="chat-context rag-cases"><summary>참고한 유사 사례 {raw.cases.length}개</summary>{raw.cases.map((item) => <article key={item.id}><strong>{item.outcome === 'rejected' || item.outcome === 'correction' ? '주의·개선 사례' : item.outcome === 'preference_only' ? '선호 표시 사례 · 사실 검증 아님' : '전문 판단 사례'}</strong><p><b>상황</b> {item.situation}</p><p><b>판단</b> {item.problem}</p><p><b>대응</b> {item.resolution}</p>{item.canOpen && <button onClick={() => openSource(item.chatId,item.messageId)}>원래 대화 보기</button>}</article>)}</details>}
        {raw.rag && <details className="chat-context rag-trace"><summary>조직 경험 검색 · {raw.rag.mode === 'hybrid' ? '의미 + 단어' : raw.rag.mode === 'empty' ? '축적된 사례 없음' : '단어 검색'}</summary><p>업무가 같은 기준·사례 {raw.rag.candidates}개 조각 검색 → 후보 {raw.rag.selected ?? 0}개 → AI가 현재 질문에 맞는 내용만 적용</p>{raw.rag.warning && <p>{raw.rag.warning}</p>}<small>비교 조건이 다르면 참고하지 않습니다. 검색 결과 자체는 사실 검증을 뜻하지 않습니다.</small></details>}
        {!!raw.learning?.published?.length && <div className="chat-learning">✓ 상사의 업무 판단에서 검증 기준 {raw.learning.published.length}개를 반영했어요.</div>}
        {raw.learning?.status === 'failed' && <div className="chat-learning">{raw.learning.error}</div>}
      </MessagePrimitive.Root>
    }}</ThreadPrimitive.Messages>
  </div></ThreadPrimitive.Viewport></ThreadPrimitive.Root></AssistantRuntimeProvider>
}

function Attachment({ file, actor, chatId }) {
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!file.id || !file.mime?.startsWith('image/')) return
    let cancelled = false; let url
    const controller = new AbortController()
    fetch(`/api/chat?id=${chatId}&file=${file.id}`, { headers: {  }, signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error('이미지 미리보기를 불러오지 못했어요.'); const blob = await r.blob(); if (!cancelled) { url = URL.createObjectURL(blob); setPreview(url) } })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
    return () => { cancelled = true; controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [file.id, file.mime, actor, chatId])
  async function open() {
    try {
      const r = await fetch(`/api/chat?id=${chatId}&file=${file.id}`, { headers: {  } })
      if (!r.ok) throw new Error('파일을 불러오지 못했어요.')
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) { setError(err.message) }
  }
  return <div className="chat-attachment">{preview && <img className="chat-image-preview" src={preview} alt={file.name} />}<button disabled={!file.id} onClick={open}>↧ {file.name}</button>{error && <small role="alert">{error}</small>}</div>
}

function Composer({ draftKey, disabled, onSend, expert }) {
  const key = `khala-chat-draft:${draftKey}`
  const [text, setText] = useState(() => typeof window === 'undefined' ? '' : sessionStorage.getItem(key) || '')
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const fileInput = useRef(null)
  const textarea = useRef(null)
  function change(value) { setText(value); sessionStorage.setItem(key, value) }
  function addFiles(items) {
    const next = [...files, ...items]
    if (next.length > 4 || next.some((file) => file.size > 10 * 1024 * 1024)) { setFileError('파일은 최대 4개, 파일당 10MB까지 첨부할 수 있어요.'); return }
    setFileError(''); setFiles(next)
  }
  async function submit(e) {
    e?.preventDefault()
    if (disabled || (!text.trim() && !files.length)) return
    const result = await onSend(text, files)
    if (result) { change(''); setFiles([]); setTimeout(() => textarea.current?.focus(), 0) }
  }
  return <form className="chat-composer" onSubmit={submit} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!disabled) addFiles([...e.dataTransfer.files]) }}>
    {files.length > 0 && <div className="chat-files">{files.map((file, i) => <span key={`${file.name}-${i}`}>{file.name}<button type="button" disabled={disabled} aria-label={`${file.name} 제거`} onClick={() => setFiles(files.filter((_, index) => index !== i))}>×</button></span>)}</div>}
    {fileError && <small role="alert">{fileError}</small>}
    <textarea ref={textarea} aria-label="AI에게 메시지" placeholder="메시지를 입력하거나 파일을 끌어다 놓으세요" value={text} disabled={disabled} maxLength={16000} onChange={(e) => change(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles([...e.clipboardData.files]) } }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
    <div className="chat-composer-actions"><input ref={fileInput} hidden type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md" multiple onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} /><button type="button" disabled={disabled} onClick={() => fileInput.current?.click()}>＋ 파일 첨부</button><span>PDF · 이미지 · 텍스트</span><button className="primary" disabled={disabled || (!text.trim() && !files.length)}>보내기 ↑</button></div>
    <small>{expert ? '대화는 저장되고, 명시한 업무 판단은 LLM이 검증 기준으로 정리합니다.' : '대화와 첨부파일은 저장되며 담당 리뷰어가 볼 수 있습니다.'} Shift+Enter 줄바꿈</small>
  </form>
}

function ReviewForm({ chat, target, messages, clearTarget, busy, submit }) {
  const key = `khala-chat-review:${chat.id}:${target || 'all'}`
  const [comment, setComment] = useState(() => typeof window === 'undefined' ? '' : sessionStorage.getItem(key) || '')
  const [verdict, setVerdict] = useState('improve')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  async function save(e) { e.preventDefault(); const result = await submit({ comment, verdict }); if (result) { sessionStorage.removeItem(key); setComment('') } }
  return <form className="chat-review-form" onSubmit={save}>
    {target && <div className="chat-review-target"><strong>선택한 메시지</strong><p>{messages.find((m) => m.id === target)?.text.slice(0, 180)}</p><button type="button" onClick={clearTarget} disabled={busy}>전체 대화로 변경</button></div>}
    <label>리뷰 의견<textarea ref={ref} autoFocus value={comment} disabled={busy} required maxLength={2000} placeholder="무엇이 좋았거나 문제였나요? 다음에도 적용할 판단을 남겨 주세요." onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit() } }} onChange={(e) => { setComment(e.target.value); sessionStorage.setItem(key, e.target.value) }} /></label>
    <div className="chat-verdict"><label><input type="radio" name="verdict" checked={verdict === 'improve'} disabled={busy} onChange={() => setVerdict('improve')} />보완 필요</label><label><input type="radio" name="verdict" checked={verdict === 'good'} disabled={busy} onChange={() => setVerdict('good')} />검토 완료</label></div>
    <button className="primary" disabled={busy || !comment.trim()}>평가 저장 · 기준 자동 정리</button><small>LLM이 맥락을 읽고 재사용 가능한 판단만 검증 기준으로 반영합니다.</small>
  </form>
}

function Knowledge({ items }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const matches = items.filter((item) => (filter === 'all' || item.workType === filter) && `${item.title} ${item.criterion}`.includes(query))
  return <section className="chat-knowledge"><span className="chat-eyebrow">대화에서 축적된 팀의 경험</span><h1>검증 기준</h1><p>상사의 평가와 실제 업무 대화에서 추출한 판단입니다. 관련 업무의 다음 답변에 필요한 기준을 찾아 적용합니다.</p><div className="chat-knowledge-filters"><select aria-label="검증 기준 업무 필터" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">모든 업무</option>{Object.entries(workTypes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select><input type="search" placeholder="검증 기준 검색" aria-label="검증 기준 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    {!matches.length && <div className="chat-knowledge-empty"><h2>아직 일치하는 검증 기준이 없어요.</h2><p>상사가 대화를 평가하거나 자신의 업무 판단을 AI와 나누면 여기에 쌓입니다.</p></div>}
    <div className="chat-knowledge-grid">{matches.map((item) => <article key={item.id}><div className="chat-line"><small>{workTypes[item.workType]}</small><span>v{item.version}</span></div><h2>{item.title}</h2><p>{item.criterion}</p><div className="chat-rule-procedure"><strong>확인 방법</strong><p>{item.procedure}</p></div><details><summary>반영 근거 {item.sources.length}건</summary>{item.sources.map((source, index) => <blockquote key={index}><small>{people[source.actor]?.name} · {source.kind === 'review_feedback' ? '대화 리뷰' : '상사의 업무 대화'}</small><p>“{source.quote}”</p></blockquote>)}</details></article>)}</div>
  </section>
}
