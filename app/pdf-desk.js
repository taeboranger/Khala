'use client'

import { useEffect, useRef, useState } from 'react'
import { current, pdfCards, people, workTypes } from '../lib/workflow'
import GuideStructure from './guide-structure'
import ReviewComposer from './review-composer'

const statusText = { draft: '검증 중', review: '리뷰 중', changes: '수정 요청', approved: '승인 완료' }
const cardText = { pending: '미확인', pass: '충족', fail: '불충족', stale: '재확인 필요' }

export default function PdfDesk({ doc, actor, guides, busy, send, back }) {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState('')
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState('results')
  const [filter, setFilter] = useState('issues')
  const [composer, setComposer] = useState(null)
  const [replacement, setReplacement] = useState(null)
  const [replacementError, setReplacementError] = useState('')
  const fileInput = useRef(null)
  const active = current(doc)
  const revision = doc.revisions.find((item) => item.number === Number(history)) ?? active
  const guide = guides.find((item) => item.version === (revision.guideVersion ?? doc.version))
  const nextVersion = Math.max(guide.version, ...doc.feedback.map((entry) => entry.publishedVersion ?? 0))
  const needsSynthesis = (entry) => !entry.publishedVersion || guides.find((item) => item.version === entry.publishedVersion)?.synthesis === 'local'
  const unresolved = doc.feedback.filter((entry) => needsSynthesis(entry) && entry.page)
  const pdf = revision.pdf
  const number = Math.min(page, pdf.pages.length)
  const owner = doc.owner === actor
  const writer = !history && owner && ['draft', 'changes'].includes(doc.status)
  const reviewer = !history && !owner && doc.reviewer === actor && doc.status === 'review'
  const self = !history && owner && people[actor].role === '리뷰어'
  const cards = pdfCards(revision, guide)
  const pending = cards.filter((card) => card.status !== 'pass').length
  const pageCards = cards.filter((card) => card.page === number)
  const visible = pageCards.filter((card) => filter === 'all' || (filter === 'issues' ? card.status !== 'pass' : card.status === 'pass'))
  const aiComplete = revision.aiVerification?.status === 'complete'
  const submit = (op, data, done) => send(op, { doc: doc.id, base: active.number, ...data }, done)
  const imageQuery = new URLSearchParams({ doc: doc.id, file: pdf.id, page: number }).toString()
  const stage = doc.status === 'approved' ? 4 : doc.status === 'changes' || (active.reviewChecks?.length && doc.status === 'draft') ? 3 : doc.status === 'review' ? 2 : 1

  function compose(mode, card) {
    setComposer({ mode, card, page: number, base: active.number, text: pdf.pages[number - 1].text })
  }
  function selectReplacement(file) {
    setReplacementError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size === 0 || file.size > 20 * 1024 * 1024) {
      setReplacementError('20MB 이하의 PDF 파일을 선택해 주세요.'); return
    }
    setReplacement(file)
  }
  async function replace() {
    const data = new FormData()
    data.set('pdf', replacement); data.set('doc', doc.id); data.set('base', String(active.number))
    const response = await send('pdfUpload', data)
    if (response?.ok) {
      setReplacement(null); setPage(1); setPanel('results'); setFilter('issues')
      setNotice('수정본을 등록했어요. 새 AI 검증 결과를 확인하세요.')
    } else setReplacementError(response?.error ?? '업로드하지 못했어요. 다시 시도하세요.')
  }
  async function download() {
    try {
      const query = new URLSearchParams({ doc: doc.id, file: pdf.id })
      const response = await fetch(`/api/pdf?${query}`, { headers: { 'x-khala-actor': actor } })
      if (!response.ok) throw new Error('PDF 원본을 내려받지 못했어요.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url; link.download = pdf.name; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (error) { setNotice(error.message) }
  }

  return <article className="pdf-workspace">
    <div className="pdf-header line spread">
      <div><button className="link" onClick={back}>← 내 문서로</button><h1>{doc.title}</h1>
        <div className="line meta"><span>{people[doc.owner].name}</span><span>{workTypes[doc.workType ?? 'market']}</span><span>검증 기준 v{guide.version}</span><span className="tag">{statusText[doc.status]}</span></div>
      </div>
      <div className="line">
        {doc.revisions.length > 1 && <label>검증 기록<select disabled={busy} value={history} onChange={(event) => { setHistory(event.target.value); setPage(1) }}>
          <option value="">현재</option>
          {[...doc.revisions].reverse().map((item) => <option key={item.number} value={item.number}>r{item.number} · v{item.guideVersion ?? doc.version}{doc.submissions.some((entry) => entry.revision === item.number) ? ' · 제출본' : ''}</option>)}
        </select></label>}
        {writer && <button disabled={busy || unresolved.length > 0} onClick={() => fileInput.current.click()}>수정본 업로드</button>}
        {writer && <button className="primary" disabled={busy} onClick={() => submit('submit')}>리뷰 요청</button>}
        {reviewer && <button className="primary" disabled={busy || pending > 0 || !aiComplete} onClick={() => submit('approve')}>최종 승인</button>}
      </div>
    </div>
    <ol className="workflow-steps" aria-label="검증 진행 단계">
      {['PDF 등록', 'AI 검증', '리뷰', '수정·재검증', '승인'].map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined} className={stage >= index ? 'reached' : ''}>{label}</li>)}
    </ol>
    {notice && <div className="success-note line spread" role="status"><span>{notice}</span><button className="link" onClick={() => setNotice('')}>닫기</button></div>}
    {history && <div className="notice line spread">과거 기록을 보고 있어요. 여기서는 수정할 수 없어요.<button onClick={() => setHistory('')}>현재로 돌아가기</button></div>}
    {!history && unresolved.length > 0 && <div className="notice line spread"><span>피드백 {unresolved.length}건의 검증 기준 반영을 마치면 수정본을 올릴 수 있어요.</span><button onClick={() => setPanel('feedback')}>반영 상태 확인</button></div>}
    {writer && <>
      <input ref={fileInput} className="visually-hidden" aria-label="수정본 PDF" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => { selectReplacement(event.target.files[0]); event.target.value = '' }} />
      {(doc.status === 'changes' || replacement || replacementError) && <section className="next-action" onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (!busy) selectReplacement(event.dataTransfer.files[0]) }}>
        <div><strong>{replacement ? replacement.name : '다음 단계: 수정한 PDF를 올려주세요'}</strong>
          <p className="meta">{replacement ? `${(replacement.size / 1024).toFixed(0)} KB · 업로드하면 AI가 다시 검증해요.` : `파일을 여기로 끌어놓거나 선택하세요. 검증 기준 v${nextVersion}로 재검증해요.`}</p>
          {replacementError && <p className="field-error" role="alert">{replacementError}</p>}
        </div>
        <div className="line">{replacement && <button disabled={busy} onClick={() => setReplacement(null)}>선택 취소</button>}
          <button disabled={busy || unresolved.length > 0} className="primary" onClick={replacement ? replace : () => fileInput.current.click()}>{busy ? 'AI 검증 중…' : replacement ? '이 PDF로 교체하고 검증' : '수정본 선택'}</button>
        </div>
      </section>}
    </>}
    <section className="verification-overview" aria-label="AI 문서 검증 결과">
      <div className="line spread"><div className="line"><h2>{aiComplete ? 'AI 검증 완료' : revision.aiVerification?.status === 'failed' ? 'AI 검증을 다시 실행해 주세요' : 'AI 검증이 필요해요'}</h2>
        <span className={`tag ${pending ? 'pending' : 'pass'}`}>{pending ? `확인 필요 ${pending}건` : '모든 항목 충족'}</span></div>
        {(writer || reviewer) && <button disabled={busy} onClick={() => submit('verifyPdfWithAi')}>{aiComplete ? 'AI 다시 검증' : 'AI 문서 검증 실행'}</button>}
      </div>
      {aiComplete ? <details><summary>AI 요약과 검증 범위 보기</summary><p className="spaced">{revision.aiVerification.summary}</p><p className="meta">{revision.aiVerification.model} · PDF 내부 근거 대조 · 외부 출처 진위 확인은 포함되지 않아요. 다시 검증하면 현재 판정이 새 결과로 교체되고 이전 결과는 기록에 남아요.</p></details>
        : <p>{revision.aiVerification?.error ?? '검증을 실행하면 문제와 근거가 자동으로 채워져요.'}</p>}
      {reviewer && (pending > 0 || !aiComplete) && <p className="meta">{!aiComplete ? 'AI 검증 완료 후 최종 승인할 수 있어요.' : '미해결 항목이 있어 승인이 보류돼요. 문제 카드에서 수정 요청을 보내세요.'}</p>}
    </section>
    <div className="pdf-columns">
      <section className="pdf-viewer" aria-label="PDF 원문">
        <div className="pdf-toolbar line spread"><span className="pdf-filename">{pdf.name}</span><div className="line">
          <button disabled={number === 1} aria-label="이전 페이지" onClick={() => setPage(number - 1)}>‹</button>
          <label className="page-control">페이지<select value={number} onChange={(event) => setPage(Number(event.target.value))}>{pdf.pages.map((item) => <option key={item.page} value={item.page}>{item.page} / {pdf.pages.length}</option>)}</select></label>
          <button disabled={number === pdf.pages.length} aria-label="다음 페이지" onClick={() => setPage(number + 1)}>›</button><button onClick={download}>원본 저장</button>
        </div></div>
        <PdfPreview key={`${pdf.id}-${number}`} query={imageQuery} actor={actor} number={number} />
      </section>
      <aside className="pdf-sidebar">
        <nav className="desk-tabs" aria-label="문서 검토 패널">
          {[['results', '검증 결과'], ['feedback', `피드백 ${doc.feedback.length}`], ['guide', '검증 기준']].map(([key, label]) => <button key={key} aria-pressed={panel === key} onClick={() => setPanel(key)}>{label}</button>)}
        </nav>
        {panel === 'results' && <section className="results-panel stack">
          <div className="line spread"><h2>{number}쪽 검증</h2>{(reviewer || self) && <button disabled={busy} onClick={() => compose(self ? 'self' : 'feedback')}>직접 {self ? '경험' : '피드백'} 쓰기</button>}</div>
          <div className="filter-row" aria-label="검증 결과 필터">
            {[['issues', `확인 필요 ${pageCards.filter((card) => card.status !== 'pass').length}`], ['pass', `충족 ${pageCards.filter((card) => card.status === 'pass').length}`], ['all', `전체 ${pageCards.length}`]].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
          </div>
          {!visible.length && <div className="clear-state"><strong>{filter === 'issues' ? '이 페이지에 미해결 항목이 없어요.' : '해당하는 검증 항목이 없어요.'}</strong>
            {filter === 'issues' && pending > 0 ? <button onClick={() => { setPage(cards.find((card) => card.status !== 'pass').page); setFilter('issues') }}>다음 미해결 페이지 보기</button> : <button onClick={() => setFilter('all')}>전체 결과 보기</button>}
          </div>}
          {visible.map((card) => <PdfCard key={card.id} card={card} editable={writer || reviewer} busy={busy}
            onJudge={() => compose('judgment', card)} onFeedback={reviewer || self ? () => compose(self ? 'self' : 'feedback', card) : null}
            feedbackLabel={self ? '이 경험을 검증 기준에 반영' : '이 내용으로 수정 요청'}
            onPage={(target) => { if (pdf.pages.some((item) => item.page === target)) setPage(target) }} />)}
          {pending > 0 && pdf.pages.length > 1 && <button onClick={() => { const next = cards.find((card) => card.status !== 'pass' && card.page > number) ?? cards.find((card) => card.status !== 'pass'); setPage(next.page); setFilter('issues') }}>다음 미해결 페이지 →</button>}
        </section>}
        {panel === 'feedback' && <section className="results-panel stack">
          <div className="line spread"><h2>리뷰와 개선 기록</h2>{(reviewer || self) && <button disabled={busy} onClick={() => compose(self ? 'self' : 'feedback')}>직접 쓰기</button>}</div>
          {!doc.feedback.length && <div className="clear-state">아직 피드백이 없어요. 검증 결과의 문제 카드에서 바로 작성할 수 있어요.</div>}
          {[...doc.feedback].reverse().map((entry) => <div key={entry.id} className="feedback-entry stack">
            <div className="line spread"><button className="link" onClick={() => { setHistory(String(entry.revision)); setPage(entry.page); setPanel('results') }}>{entry.page}쪽 원문 보기</button><span className="meta">{people[entry.actor].name}</span></div>
            <p>{entry.issue}</p>{entry.action !== entry.issue && <p className="guide-summary">{entry.action}</p>}
            <details><summary>첨부 근거</summary><p className="spaced">{entry.evidence}</p></details>
            {entry.publishedVersion && <p className="tag pass">검증 기준 v{entry.publishedVersion} 반영</p>}
            {entry.guideSummary && <details><summary>AI가 정리한 변경 내용</summary><p className="spaced">{entry.guideSummary}</p></details>}
            {needsSynthesis(entry) && <p className="meta">{entry.synthesisReason ?? '검증 기준 반영을 기다리고 있어요.'}</p>}
            {needsSynthesis(entry) && people[actor].role === '리뷰어' && <button disabled={busy} onClick={() => submit('retryFeedback', { feedback: entry.id })}>AI 검증 기준 반영 다시 시도</button>}
          </div>)}
        </section>}
        {panel === 'guide' && <section className="results-panel"><h2 className="section-title">적용된 검증 기준 · v{guide.version}</h2><GuideStructure guide={guide} workType={doc.workType} visibleCards={pageCards} page={number} /></section>}
      </aside>
    </div>
    {composer && <ReviewComposer key={`${composer.mode}-${composer.base}-${composer.page}-${composer.card?.id ?? 'new'}`}
      {...composer} draftKey={`khala:draft:${actor}:${doc.id}:${composer.base}:${composer.page}:${composer.mode}:${composer.card?.id ?? 'new'}`} busy={busy}
      close={() => setComposer(null)} save={async (data) => {
        const op = composer.mode === 'judgment' ? 'verifyPdf' : composer.mode === 'self' ? 'proposal' : 'feedback'
        const result = await submit(op, { ...data, base: composer.base, page: composer.page, ...(composer.mode === 'judgment' && { card: composer.card.id }) })
        if (result?.ok) { setNotice(composer.mode === 'judgment' ? '판정을 저장했어요.' : '피드백을 저장했어요. 검증 기준 반영 상태를 확인하세요.'); if (composer.mode !== 'judgment') setPanel('feedback') }
        return result
      }} />}
  </article>
}

function PdfPreview({ query, actor, number }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let url
    fetch(`/api/pdf?${query}`, { headers: { 'x-khala-actor': actor }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('페이지를 표시하지 못했어요. PDF 원본을 저장해 열 수 있어요.')
        return response.blob()
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob)
          setImage(url)
        }
      })
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [query, actor])

  return <div className="pdf-paper">
    {image ? <img src={image} alt={`PDF 원문 ${number}쪽`} /> : <p role="status">{error || '페이지를 불러오는 중이에요.'}</p>}
  </div>
}

function PdfCard({ card, editable, busy, onJudge, onFeedback, feedbackLabel, onPage }) {
  return <section className={`result-card result-${card.status}`}>
    <div className="line spread"><h3>{card.title}</h3><span className={`tag ${card.status}`}>{cardText[card.status]}</span></div>
    {card.aiRecord?.claim && <blockquote>{card.aiRecord.claim}</blockquote>}
    <p>{card.record?.reason ?? card.procedure}</p>
    {card.aiRecord?.suggestion && <div className="suggestion"><strong>수정 방향</strong><p>{card.aiRecord.suggestion}</p></div>}
    <details className="card-evidence"><summary>원문 근거 · 적용 기준 보기</summary><div className="stack spaced">
      {card.record?.citations?.length ? card.record.citations.map((ref, index) => <div key={index} className="evidence">{ref.verified ? <button className="link" onClick={() => onPage(ref.page)}>{ref.page}쪽으로 이동</button> : <span className="meta">원문 위치 미확인</span>}<p>{ref.quote}</p></div>) : <p>{card.record?.evidence || '확인된 원문 근거가 없어요.'}</p>}
      <p className="meta">{card.context}<br />{card.procedure}</p>
    </div></details>
    <div className="line spread card-actions"><span className="meta">{card.record?.origin === 'ai' ? 'AI 판정' : card.record ? `${people[card.record.actor]?.name ?? '사용자'} 판정` : '판정 전'}</span>
      {editable && <button className="link" disabled={busy} onClick={onJudge}>판정 정정</button>}
    </div>
    {card.aiRecord && card.record?.origin !== 'ai' && <details><summary>원래 AI 판정</summary><p>{cardText[card.aiRecord.status]} · {card.aiRecord.reason}</p></details>}
    {onFeedback && <button className="feedback-action" disabled={busy} onClick={onFeedback}>{feedbackLabel}</button>}
  </section>
}
