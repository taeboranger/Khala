'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession, AccountNav } from './session-provider'
import { cardList, comparisonStatus, current, fields, guidesFor, people, workTypes } from '../lib/workflow'
import PdfDesk from './pdf-desk'
import GuideStructure from './guide-structure'

const documentStatus = { draft: '작성 중', review: '리뷰 중', changes: '수정 요청', approved: '승인 완료' }
const cardStatus = { pending: '확인 대기', pass: '충족', fail: '불충족', stale: '재확인 필요' }
const scenarioStatus = { allowed: '계산 가능', blocked: '계산 보류', pending: '근거 부족' }

const formValues = (event) => {
  event.preventDefault()
  return Object.fromEntries(new FormData(event.currentTarget))
}
const formatDate = (value) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function Home() {
  const {user}=useSession()
  const actor=user.id
  const [data, setData] = useState(null)
  const [docId, setDocId] = useState(null)
  const [page, setPage] = useState('mine')
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState('')
  const [error, setError] = useState('')
  const [connection, setConnection] = useState(null)
  const doc = data?.docs.find((item) => item.id === docId)
  useEffect(() => { fetch('/api/connection').then((response) => response.json()).then(setConnection).catch(() => setConnection({ connected: false })) }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/workspace', { headers: {  }, signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error)
        setData(payload)
      })
      .catch((failure) => {
        if (failure.name !== 'AbortError') setError(failure.message)
      })
    return () => controller.abort()
  }, [actor])

  async function send(op, values, onSuccess) {
    if (busy) return { ok: false, error: '앞선 작업을 처리하고 있어요. 잠시 기다려 주세요.' }
    setBusy(true)
    setOperation(op)
    setError('')
    try {
      const pdfUpload = op === 'pdfUpload'
      const response = await fetch(pdfUpload ? '/api/pdf' : '/api/workspace', {
        method: 'POST',
        headers: { ...(!pdfUpload && { 'Content-Type': 'application/json' }) },
        body: pdfUpload ? values : JSON.stringify({ ...values, op }),
      })
      const payload = await response.json()
      if (!response.ok) {
        if (response.status === 409) {
          const fresh = await fetch('/api/workspace', { headers: {  } })
          if (fresh.ok) setData(await fresh.json())
        }
        throw new Error(payload.error)
      }
      setData(payload)
      onSuccess?.(payload.result)
      return { ok: true, result: payload.result }
    } catch (failure) {
      setError(failure.message)
      return { ok: false, error: failure.message }
    } finally {
      setBusy(false)
    }
  }

  function choosePage(next) {
    setPage(next)
    setDocId(null)
    setError('')
  }

  return <>
    <header className="bar">
      <button className="logo" onClick={() => choosePage('mine')}>KHALA</button>
      <nav aria-label="작업 공간">
        <a href="/chat" style={{ color: '#135a50', fontWeight: 700, marginRight: 12 }}>AI 대화 ↗</a>
        <button className={page === 'mine' ? 'selected' : ''} onClick={() => choosePage('mine')}>내 문서</button>
        <button className={page === 'catalog' ? 'selected' : ''} onClick={() => choosePage('catalog')}>업무별 검증 기준</button>
        {people[actor].role === '리뷰어' && <>
          <button className={page === 'review' ? 'selected' : ''} onClick={() => choosePage('review')}>리뷰 대기열</button>
          <button className={page === 'guide' ? 'selected' : ''} onClick={() => choosePage('guide')}>검증 기준 개선함</button>
        </>}
      </nav>
      <AccountNav/>
      <span className={`tag ${connection?.connected ? 'pass' : 'pending'}`}>{connection ? connection.connected ? `${connection.provider} · ${connection.model}` : '모델 설정 필요' : '모델 확인 중'}</span>
    </header>
    <main className={doc && current(doc).pdf ? 'pdf-main' : undefined}>
      {error && <div className="alert" role="alert">{error} <button onClick={() => setError('')} aria-label="오류 메시지 닫기">닫기</button></div>}
      {connection && !connection.connected && <div className="notice"><a href="/settings">모델 설정</a>에서 제공업체와 API 키를 연결하세요.</div>}
      {busy && <div className="working" role="status">{({ pdfUpload: 'PDF를 읽고 AI가 검증하고 있어요.', verifyPdfWithAi: 'AI가 문서와 근거를 다시 대조하고 있어요.', feedback: '피드백을 저장하고 AI가 검증 기준를 정리하고 있어요.', proposal: '검증 경험을 검증 기준에 반영하고 있어요.', retryFeedback: 'AI가 피드백을 검증 기준에 다시 반영하고 있어요.', verifyPdf: '판정을 저장하고 있어요.', submit: '리뷰를 요청하고 있어요.', approve: '최종 승인하고 있어요.' })[operation] ?? '요청을 처리하고 있어요.'}</div>}
      {data && (page === 'guide'
        ? <GuideDesk data={data} canPublish={people[actor].publish} busy={busy} send={send} />
        : page === 'catalog' ? <GuideCatalog data={data} /> : doc
          ? current(doc).pdf
            ? <PdfDesk key={doc.id} doc={doc} actor={actor} guides={guidesFor(data, doc.workType)} busy={busy} send={send} back={() => setDocId(null)} />
            : <DocumentDesk key={doc.id} doc={doc} actor={actor} guide={data.guides.find((item) => item.version === doc.version)} modelReady={data.modelReady} busy={busy} send={send} back={() => setDocId(null)} />
          : <DocumentList page={page} data={data} actor={actor} busy={busy} open={setDocId} send={send} />)}
      {!data && !error && <p role="status">작업 공간을 불러오는 중이에요.</p>}
    </main>
  </>
}

function DocumentList({ page, data, actor, busy, open, send }) {
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const fileInput = useRef(null)
  const mine = page === 'mine'
  const docs = [...data.docs].reverse().filter((doc) => mine ? doc.owner === actor : doc.reviewer === actor)
  function chooseFile(value) {
    if (!value) return
    if (!value.name.toLowerCase().endsWith('.pdf') || value.size === 0 || value.size > 20 * 1024 * 1024) {
      setFileError('20MB 이하의 PDF를 선택해 주세요.'); return
    }
    setFileError(''); setFile(value)
  }
  return <section className="list">
    <h1>{mine ? 'PDF 검증' : '리뷰 대기열'}</h1>
    {mine && <form className="box stack upload" onSubmit={(event) => {
      event.preventDefault()
      if (file) { const form = new FormData(event.currentTarget); form.set('pdf', file); send('pdfUpload', form, open) }
    }}>
      <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault()
        if (busy || !event.dataTransfer.files.length) return
        chooseFile(event.dataTransfer.files[0])
      }}>
        <strong>{file ? file.name : 'PDF를 여기에 놓으세요'}</strong>
        <span>{file ? `${(file.size / 1024).toFixed(0)} KB · 업로드 준비됨` : '파일을 선택하면 AI가 문제와 수정 방향을 찾아줘요.'}</span>
        <div className="line"><button type="button" disabled={busy} onClick={() => fileInput.current.click()}>{file ? '다른 파일 선택' : 'PDF 파일 선택'}</button>{file && <button type="button" disabled={busy} onClick={() => setFile(null)}>선택 취소</button>}</div>
        <span className="meta">최대 20MB · 100쪽</span>
        <input ref={fileInput} className="visually-hidden" aria-label="PDF 파일" type="file" accept=".pdf,application/pdf" onChange={(event) => { chooseFile(event.target.files[0]); event.target.value = '' }} disabled={busy} />
      </div>
      {fileError && <p className="field-error" role="alert">{fileError}</p>}
      <fieldset className="worktype-options"><legend>어떤 업무의 문서인가요?</legend>
        {Object.entries(workTypes).map(([key, title]) => <label key={key}><input type="radio" name="workType" value={key} defaultChecked={key === 'market'} disabled={busy} /><span>{title}<small>{key === 'market' ? '시장 범위 · 지표 · 성장률 비교' : '주장 · 출처 · 수치의 일관성'}</small></span></label>)}
      </fieldset>
      <p className="meta">업로드하면 AI가 업무별 기준으로 PDF를 검증하고, 문제 위치·근거·수정 제안을 표시해요.</p>
      <div><button className="primary" disabled={busy || !file}>{busy ? 'AI 문서 검증 중…' : 'PDF 검증 시작'}</button></div>
    </form>}
    {mine && <h2>내 문서</h2>}
    {docs.length ? <table><thead><tr><th>문서</th><th>작성자</th><th>검증 기준</th><th>상태</th></tr></thead>
      <tbody>{docs.map((doc) => <tr key={doc.id}>
        <td><button className="link" onClick={() => open(doc.id)}>{doc.title}</button></td>
        <td>{people[doc.owner].name}</td><td>v{doc.version}</td><td>{documentStatus[doc.status]}</td>
      </tr>)}</tbody></table> : <p className="empty">{mine ? '작성한 문서가 없어요.' : '배정된 리뷰가 없어요.'}</p>}
  </section>
}

function DocumentDesk({ doc, actor, guide, modelReady, busy, send, back }) {
  const [history, setHistory] = useState('')
  const [focus, setFocus] = useState('')
  const [selectedCard, setSelectedCard] = useState('')
  const [selectedRow, setSelectedRow] = useState('')
  const [target, setTarget] = useState('')
  const [draftId, setDraftId] = useState('')
  const [proposalDone, setProposalDone] = useState(false)
  const active = current(doc)
  const revision = doc.revisions.find((item) => item.number === Number(history)) ?? active
  const owner = doc.owner === actor
  const author = !history && owner && ['draft', 'changes'].includes(doc.status)
  const reviewer = !history && !owner && doc.reviewer === actor && doc.status === 'review'
  const cards = revision.blocks.flatMap((block) => cardList(revision, guide, block).map((card) => ({ ...card, block })))
  const complete = cards.filter((card) => card.status === 'pass').length
  const draft = doc.generations.find((item) => item.id === draftId && !item.adopted)
  const onDoc = (op, values = {}, done) => send(op, { doc: doc.id, base: active.number, ...values }, done)

  function locate(blockId, cardId = '') {
    setFocus(blockId)
    setSelectedCard(cardId)
    setSelectedRow('')
    document.getElementById(cardId ? `card-${cardId}` : `block-${blockId}`)?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
  }

  return <article>
    <button className="link" onClick={back}>← 문서 목록</button>
    <div className="line spread title-row">
      <div>
        <h1>{doc.title}</h1>
        <div className="line meta"><span>{doc.type}</span><span>{people[doc.owner].name}</span><span>검증 기준 v{doc.version}</span><span className="tag">{documentStatus[doc.status]}</span></div>
      </div>
      <div className="line">
        <label>개정본 <select value={history} onChange={(event) => setHistory(event.target.value)}>
          <option value="">현재 · r{active.number}</option>
          {[...doc.revisions].reverse().map((item) => <option key={item.number} value={item.number}>r{item.number}{doc.submissions.some(({ revision: number }) => number === item.number) ? ' · 제출본' : ''}</option>)}
        </select></label>
        {author && <button className="primary" disabled={busy || !revision.blocks.length} onClick={() => onDoc('submit')}>리뷰 요청</button>}
        {reviewer && <button className="primary" disabled={busy} onClick={() => onDoc('approve')}>최종 승인</button>}
      </div>
    </div>
    {reviewer && complete < cards.length && <p className="notice">필수 검증 {cards.length - complete}건을 완료하거나 해당 주장을 수정해야 승인할 수 있어요.</p>}
    <div className="desk">
      <section className="document">
        <section className="box stack">
          <div className="line spread"><h2>본문</h2><span className="meta">{doc.market} / {doc.purpose}</span></div>
          {!revision.blocks.length && <p className="empty">AI 초안을 반영하거나 문단을 직접 추가하세요.</p>}
          {revision.blocks.map((block) => <Block key={`${block.id}-${revision.number}`} block={block} revision={revision} focused={focus === block.id} rowFocus={focus === block.id ? selectedRow : ''} author={author} busy={busy} onDoc={onDoc} onGuide={() => {
            const card = cards.find((item) => item.block.id === block.id)
            if (card) locate(block.id, `${block.id}-${card.key}`)
          }} onRewrite={() => {
            setTarget(block.id)
            document.getElementById('ai-prompt')?.focus()
          }} />)}
          {author && <details><summary>문단 직접 추가</summary>
            <TextForm label="새 문단" action="문단 추가" busy={busy} submit={(values, form) => onDoc('addText', values, () => form.reset())} />
          </details>}
        </section>
        {author && <section className="box stack">
          <div className="line spread"><h2>AI 문서 작성</h2><span className="tag">{modelReady ? '모델 연결됨' : '로컬 데모'}</span></div>
          <form className="stack" onSubmit={(event) => {
            const values = formValues(event)
            onDoc('generation', {
              prompt: values.prompt, target, sources: [values.start, values.end].filter(Boolean),
            }, setDraftId)
          }}>
            <label>반영 위치<select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">새 문단</option>
              {revision.blocks.map((block, index) => <option key={block.id} value={block.id}>문단 {index + 1} 수정</option>)}
            </select></label>
            <label>AI 요청<textarea id="ai-prompt" name="prompt" placeholder="A기관과 B기관 자료로 성장률을 넣어줘" required /></label>
            {!!revision.sources.length && <div className="pair">
              <SourceSelect label="첫 번째 출처" name="start" sources={revision.sources} />
              <SourceSelect label="두 번째 출처" name="end" sources={revision.sources} />
            </div>}
            <div><button className="primary" disabled={busy}>초안 생성</button></div>
          </form>
          {draft && <div className="inset stack">
            <strong>초안 미리보기</strong><p>{draft.text}</p>
            <p className="meta">{draft.plan.condition} · 검증 기준 v{draft.plan.version}</p>
            <div><button disabled={busy || draft.base !== active.number} onClick={() => onDoc('adopt', { generation: draft.id }, () => {
              setDraftId('')
              setTarget('')
            })}>문서에 반영</button></div>
            {draft.base !== active.number && <p>문서가 변경됐어요. 초안을 다시 생성하세요.</p>}
          </div>}
        </section>}
        <section className="box stack">
          <h2>참고 출처</h2>
          {!revision.sources.length && <p className="empty">등록된 출처가 없어요.</p>}
          {revision.sources.map((source) => <details key={`${source.id}-${revision.number}`} className="inset">
            <summary>{source.id} · {source.label} · {source.year}년 · {source.value.toLocaleString('ko-KR')} {source.unit}</summary>
            <p>{source.excerpt}</p>
            {source.url && <a href={source.url} target="_blank" rel="noreferrer">원문 열기</a>}
            {author && <SourceForm source={source} busy={busy} save={(values) => onDoc('source', { ...values, source: source.id })} />}
          </details>)}
          {author && <details><summary>출처 등록</summary><SourceForm key={revision.sources.length} busy={busy} save={(values) => onDoc('source', values)} /></details>}
        </section>
        <section className="box stack">
          <h2>리뷰 피드백</h2>
          {!doc.feedback.length && <p className="empty">남겨진 피드백이 없어요.</p>}
          {doc.feedback.map((item) => <section key={item.id} className="inset stack">
            <div className="line spread"><strong>{item.issue}</strong><span className="meta">r{item.revision} · {people[item.actor].name}</span></div>
            <p>{item.evidence}</p><p>작성자 조치 · {item.action}</p>
            {item.key && <p className="meta">검증 항목 · {fields[item.key] ?? (item.key === 'growth' ? '성장률 계산' : '원문과 출처 대조')}</p>}
            {item.row && <p className="meta">표 행 · 출처 {item.row}</p>}
            {item.block && <div className="line">
              <button type="button" onClick={() => {
                setHistory(String(item.revision))
                setFocus(item.block)
                setSelectedRow(item.row ?? '')
              }}>당시 문단 보기</button>
              {!owner && item.actor === actor && <button disabled={busy} onClick={() => onDoc('proposal', { feedback: item.id }, () => setProposalDone(true))}>검증 기준 개선안 만들기</button>}
            </div>}
          </section>)}
          {reviewer && <form className="stack" onSubmit={(event) => {
            const form = event.currentTarget
            const values = formValues(event)
            const [block, key, row] = values.anchor.split(':')
            onDoc('feedback', { ...values, block, key, row, requestChanges: event.nativeEvent.submitter?.value === 'changes' }, () => form.reset())
          }}>
            <label>피드백 대상<select name="anchor">
              <option value="">문서 전체</option>
              {revision.blocks.map((block, index) => <optgroup key={block.id} label={`문단 ${index + 1}`}>
                <option value={block.id}>{`문단 ${index + 1} 전체`}</option>
                {block.action === 'growth' && block.sourceIds.map((source) => <option key={source} value={`${block.id}::${source}`}>표 행 · 출처 {source}</option>)}
                {cards.filter((card) => card.block.id === block.id).map((card) => <option key={card.key} value={`${block.id}:${card.key}`}>{card.title}</option>)}
              </optgroup>)}
            </select></label>
            <label>발견한 문제<input name="issue" required /></label>
            <label>판단 근거<textarea name="evidence" required /></label>
            <label>작성자가 할 일<input name="action" required /></label>
            <div className="line"><button disabled={busy}>피드백 저장</button><button value="changes" className="primary" disabled={busy}>수정 요청 보내기</button></div>
          </form>}
        </section>
        {owner && people[actor].role === '리뷰어' && !history && !!revision.blocks.length && <section className="box stack">
          <h2>자기 업무에서 검증 기준 개선 제안</h2>
          <form className="stack" onSubmit={(event) => {
            const form = event.currentTarget
            onDoc('proposal', formValues(event), () => { form.reset(); setProposalDone(true) })
          }}>
            <label>직접 검증한 문단<select name="block">{revision.blocks.map((block, index) => <option key={block.id} value={block.id}>문단 {index + 1} · {block.text.slice(0, 45)}</option>)}</select></label>
            <label>발견한 문제<input name="issue" required /></label>
            <label>원문 근거와 판단 이유<textarea name="evidence" required /></label>
            <div><button disabled={busy}>개선안 만들기</button></div>
          </form>
        </section>}
        {proposalDone && <p className="notice" role="status">검증 기준 개선함에 초안을 저장했어요.</p>}
        {!!doc.generations.length && <section className="box stack">
          <h2>AI 사용 이력</h2>
          {[...doc.generations].reverse().map((generation) => <details key={generation.id} className="inset">
            <summary>{generation.prompt} · {generation.mode === 'local' ? '로컬 데모' : generation.model}</summary>
            <p>{formatDate(generation.at)} · 검증 기준 v{generation.plan.version} · {generation.plan.condition}</p>
            <p>출처 {generation.plan.sourceIds.join(', ') || '선택 없음'} / 검증 {generation.plan.keys.map((key) => fields[key] ?? ({ citation: '원문 대조', growth: '성장률 계산' })[key]).join(' → ')}</p>
            <p>{generation.text}</p>
            {generation.adopted && <p className="meta">문서 r{generation.adopted.revision}에 반영됨</p>}
          </details>)}
        </section>}
      </section>
      <aside className="guide">
        <div className="line spread"><h2>검증 기준</h2><span className="tag">필수 {complete}/{cards.length}</span></div>
        <p className="meta">검증 기준 v{guide.version} · 문서 r{revision.number}</p>
        <details className="box">
          <summary>적용된 검증 기준 · v{guide.version}</summary>
          <div className="spaced"><GuideStructure guide={guide} mode="editor" /></div>
        </details>
        {!cards.length && <p className="empty">AI 초안을 반영하면 관련 검증 카드가 표시돼요.</p>}
        {cards.map((card) => <VerifyCard key={`${card.block.id}-${card.key}-${revision.number}`} card={card} revision={revision} selected={selectedCard === `${card.block.id}-${card.key}`} editable={author || reviewer} busy={busy} onLocate={() => locate(card.block.id)} onDoc={onDoc} />)}
      </aside>
    </div>
  </article>
}

function GuideCatalog({ data }) {
  const [workType, setWorkType] = useState('market')
  const [version, setVersion] = useState('')
  const guides = guidesFor(data, workType)
  const latest = guides.at(-1)
  const guide = guides.find((item) => item.version === Number(version)) ?? latest
  return <section className="list stack">
    <h1>업무별 검증 기준</h1>
    <section className="box stack">
      <div className="line spread">
        <label>업무 유형<select value={workType} onChange={(event) => { setWorkType(event.target.value); setVersion('') }}>
          {Object.entries(workTypes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
        </select></label>
        <label>발행 버전<select value={version} onChange={(event) => setVersion(event.target.value)}>
          <option value="">최신 발행본 · v{latest.version}</option>
          {guides.slice(0, -1).reverse().map((item) => <option key={item.version} value={item.version}>v{item.version}</option>)}
        </select></label>
      </div>
      <GuideStructure guide={guide} workType={workType} />
    </section>
  </section>
}

function Block({ block, revision, focused, rowFocus, author, busy, onDoc, onGuide, onRewrite }) {
  const index = revision.blocks.indexOf(block)
  return <section className={`block ${focused ? 'focused' : ''}`} id={`block-${block.id}`}>
    <div className="line spread"><strong>문단 {index + 1}{block.action === 'growth' ? ' · 성장률' : ''}</strong>
      {!!block.action && <button className="link" onClick={onGuide}>검증 카드 보기</button>}</div>
    <p>{block.text}</p>
    {block.action === 'growth' && <>
      <table><thead><tr><th>출처</th><th>연도</th><th>수치</th></tr></thead>
        <tbody>{block.sourceIds.map((id) => {
          const source = revision.sources.find((item) => item.id === id)
          return source && <tr key={id} className={rowFocus === id ? 'row-focus' : undefined}><td>{source.label}</td><td>{source.year}</td><td>{source.value.toLocaleString('ko-KR')} {source.unit}</td></tr>
        })}</tbody></table>
      <p><strong>성장률</strong> <span className={`tag ${block.result === null ? 'pending' : 'pass'}`}>{block.result === null ? '확인 대기' : `${block.result}%`}</span></p>
    </>}
    {author && <div className="stack">
      <div className="line"><button onClick={onRewrite}>AI로 수정</button><button disabled={busy} onClick={() => onDoc('remove', { block: block.id })}>문단 삭제</button></div>
      <details><summary>직접 편집</summary><TextForm label="문단 내용" value={block.text} busy={busy} action="문단 저장" submit={(values) => onDoc('edit', { ...values, block: block.id })} /></details>
    </div>}
  </section>
}

function TextForm({ label, value, action, busy, submit }) {
  return <form className="stack spaced" onSubmit={(event) => submit(formValues(event), event.currentTarget)}>
    <label>{label}<textarea name="text" defaultValue={value} required /></label>
    <div><button disabled={busy}>{action}</button></div>
  </form>
}

function SourceSelect({ label, name, sources }) {
  return <label>{label}<select name={name}><option value="">요청에서 선택</option>
    {sources.map((source) => <option key={source.id} value={source.id}>{source.id} · {source.label}</option>)}
  </select></label>
}

function SourceForm({ source, busy, save }) {
  return <form className="stack spaced" onSubmit={(event) => save(formValues(event))}>
    <div className="pair">
      <label>출처명<input name="label" defaultValue={source?.label} required /></label>
      <label>연도<input name="year" type="number" min="1900" max="2200" defaultValue={source?.year} required /></label>
      <label>시장 수치<input name="value" type="number" min="0" step="any" defaultValue={source?.value} required /></label>
      <label>단위<input name="unit" defaultValue={source?.unit ?? '억 원'} required /></label>
      <label>시장 범위<input name="scope" defaultValue={source?.scope} placeholder="예: 국내" /></label>
      <label>지표 정의<input name="metric" defaultValue={source?.metric} placeholder="예: 매출액" /></label>
    </div>
    <label>원문 링크<input name="url" type="url" defaultValue={source?.url} /></label>
    <label>원문 발췌<textarea name="excerpt" defaultValue={source?.excerpt} required /></label>
    <div><button disabled={busy}>출처 저장</button></div>
  </form>
}

function VerifyCard({ card, revision, selected, editable, busy, onLocate, onDoc }) {
  const [evidence, setEvidence] = useState(card.record?.evidence ?? '')
  const block = card.block
  const sources = revision.sources.filter((source) => block.sourceIds.includes(source.id))
  const comparison = Object.hasOwn(fields, card.key) ? comparisonStatus(sources, card.key) : null
  return <section className={`check ${selected ? 'focused' : ''}`} id={`card-${block.id}-${card.key}`}>
    <div className="line spread"><h3>{card.title}</h3><span className={`tag ${card.status}`}>{cardStatus[card.status]}</span></div>
    <p>{card.procedure}</p>
    {card.context && <p className="meta">{card.context}</p>}
    {comparison && <p className="meta">등록값 대조 · {comparison === 'pass' ? '일치' : comparison === 'fail' ? '불일치' : '정보 부족'}</p>}
    <button className="link" onClick={onLocate}>문단 {revision.blocks.indexOf(block) + 1} 보기</button>
    {card.record && <div className="evidence">
      <p><strong>{people[card.record.actor].name}</strong> · r{card.record.basedOn}에서 판정</p>
      <p>{card.record.evidence}</p><p>{card.record.reason}</p>
    </div>}
    {editable && card.key !== 'growth' && <details>
      <summary>{card.record ? '판정 변경' : '근거와 판정 기록'}</summary>
      <form className="stack spaced" onSubmit={(event) => onDoc('verify', { ...formValues(event), block: block.id, key: card.key })}>
        {sources.length > 0 && <button type="button" onClick={() => setEvidence(sources.map((source) => `[${source.id}] ${source.excerpt}`).join('\n'))}>등록된 원문 발췌 가져오기</button>}
        <label>근거 또는 부족한 자료<textarea name="evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} required /></label>
        <label>판단 이유<textarea name="reason" defaultValue={card.record?.reason} required /></label>
        <label>판정<select aria-label="판정" name="status" defaultValue={['pass', 'fail'].includes(card.status) ? card.status : 'pending'}>
          <option value="pending">미확인</option><option value="pass">충족</option><option value="fail">불충족</option>
        </select></label>
        <button disabled={busy}>판정 저장</button>
      </form>
    </details>}
    {card.key === 'growth' && card.status === 'pending' && <p className="meta">선행 검증을 완료하고 연도, 단위, 시작값을 확인하세요.</p>}
  </section>
}

function GuideDesk({ data, canPublish, busy, send }) {
  const latest = data.guides.at(-1)
  return <section className="list stack">
    <h1>검증 기준 개선함</h1>
    <section className="box stack">
      <h2>발행된 시장조사 검증 기준 · v{latest.version}</h2>
      <p>기본 검증 기준 · 원문과 출처 대조, 성장률 계산</p>
      {!latest.rules.length && <p className="empty">성장률 계산에 적용되는 추가 비교 규칙이 없어요.</p>}
      {latest.rules.map((rule) => <details key={rule.field}>
        <summary>{fields[rule.field]} 비교</summary>
        <p>판정 기준 · {rule.context}</p>
        <p>확인 방법 · {rule.procedure}</p>
        <p>적용 조건 · 복수 출처의 성장률 계산 전 필수 확인</p>
      </details>)}
    </section>
    <h2>변경 제안</h2>
    {!data.proposals.length && <p className="empty">문서 리뷰 또는 자기 업무에서 개선안을 만들 수 있어요.</p>}
    {[...data.proposals].reverse().map((proposal) => {
      const versions = guidesFor(data, proposal.workType)
      return <Proposal key={proposal.id} proposal={proposal} original={versions.find((item) => item.version === proposal.oldVersion)} latest={versions.at(-1)} canPublish={canPublish} busy={busy} send={send} />
    })}
  </section>
}

function Proposal({ proposal, original, latest, canPublish, busy, send }) {
  if (!proposal.rule || proposal.rule.field === 'citation') {
    return <section className="box stack">
      <h3>{proposal.rule ? '주장과 근거 대조' : '문서별 개선 기록'}</h3>
      <p className="meta">{workTypes[proposal.workType ?? 'market']} · {proposal.documentTitle} · v{proposal.published} 자동 발행</p>
      <p>{proposal.issue}</p>
      {proposal.rule && <><p>판정 기준 · {proposal.rule.context}</p><p>확인 방법 · {proposal.rule.procedure}</p></>}
    </section>
  }
  const oldRule = original.rules.find((rule) => rule.field === proposal.rule.field)
  const test = proposal.test
  return <section className="box stack">
    <div className="line spread"><h3>{fields[proposal.rule.field]} 비교</h3><span className="tag">{proposal.published ? `v${proposal.published} 발행됨` : '발행 대기'}</span></div>
    <p className="meta">{proposal.kind === 'self' ? '리뷰어 직접 검증' : '직원 문서 리뷰'} · {proposal.documentTitle} · r{proposal.revision} · 검증 기준 v{proposal.oldVersion}{proposal.row ? ` · 출처 ${proposal.row} 행` : ''}</p>
    <div className="inset"><strong>{proposal.issue}</strong><p>{proposal.evidence}</p></div>
    <p>당시 검증 기준 · {oldRule ? oldRule.procedure : '해당 비교 항목 없음'}</p>
    <form className="stack" onSubmit={(event) => send('saveProposal', { proposal: proposal.id, rule: formValues(event) })}>
      <label>검증 기준<select name="field" disabled={!!proposal.published} defaultValue={proposal.rule.field}>
        {Object.entries(fields).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </select></label>
      <label>판정 기준<textarea name="context" readOnly={!!proposal.published} defaultValue={proposal.rule.context} required /></label>
      <label>확인 방법<textarea name="procedure" readOnly={!!proposal.published} defaultValue={proposal.rule.procedure} required /></label>
      <p className="meta">적용 조건 · 복수 출처의 성장률 계산 전에 근거와 판정을 요구해요. 충족 판정 후 계산해요.</p>
      {proposal.pdfPage && !proposal.published && <div className="stack">
        <p>PDF {proposal.pdfPage}쪽 · 사례에 나온 두 출처의 대조값을 입력하세요.</p>
        {['failure', 'normal'].map((name) => <fieldset key={name} disabled={!!proposal.published} className="pair">
          <legend>{name === 'failure' ? '오류 사례' : '정상 사례'}</legend>
          {[0, 1].map((index) => <div key={index} className="stack">
            <label>출처 {index + 1} 시장 범위<input name={`${name}Scope${index}`} defaultValue={proposal.cases?.[name][index].scope} required /></label>
            <label>출처 {index + 1} 지표 정의<input name={`${name}Metric${index}`} defaultValue={proposal.cases?.[name][index].metric} required /></label>
          </div>)}
        </fieldset>)}
      </div>}
      {!proposal.published && <div><button disabled={busy}>변경안 저장</button></div>}
    </form>
    {test && <div className="inset" role="status">
      <p>검증 기준 v{test.version} 기준 · {test.passed ? '사례 검증 통과' : '사례 검증 실패'}</p>
      <p>오류 사례 · {scenarioStatus[test.before]} → {scenarioStatus[test.after]} / 정상 사례 · {scenarioStatus[test.normal]}</p>
    </div>}
    {!proposal.published && <div className="line">
      <button disabled={busy} onClick={() => send('testProposal', { proposal: proposal.id })}>오류·정상 사례 검증</button>
      {canPublish && <button className="primary" disabled={busy || !test?.passed || test.version !== latest.version} onClick={() => send('publish', { proposal: proposal.id })}>새 검증 기준 발행</button>}
    </div>}
  </section>
}
