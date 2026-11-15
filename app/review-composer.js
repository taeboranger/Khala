'use client'

import { useEffect, useId, useRef, useState } from 'react'

function useDraft(key, initial) {
  const [draft, setDraft] = useState(() => {
    try { return { ...initial, ...JSON.parse(sessionStorage.getItem(key) || '{}') } } catch { return initial }
  })
  const [stored, setStored] = useState(false)
  function update(patch) {
    const next = { ...draft, ...patch }
    setDraft(next)
    try { sessionStorage.setItem(key, JSON.stringify(next)); setStored(true) } catch { setStored(false) }
  }
  function clear() { try { sessionStorage.removeItem(key) } catch {} }
  return [draft, update, clear, stored]
}

export default function ReviewComposer({ mode, card, page, text, draftKey, busy, save, close }) {
  const dialog = useRef(null)
  const titleId = useId()
  const judgment = mode === 'judgment'
  const self = mode === 'self'
  const record = card?.record ?? card?.aiRecord
  const suggestion = card?.aiRecord?.suggestion
  const seed = [record?.reason, suggestion && `수정 방향: ${suggestion}`].filter(Boolean).join('\n\n').slice(0, 4000)
  const [draft, update, clear, stored] = useDraft(draftKey, {
    message: seed, evidence: (record?.evidence || text || '').slice(0, 4000),
    reason: record?.reason ?? '', status: card?.status === 'stale' ? 'pending' : card?.status ?? 'pending', requestChanges: true,
  })
  const [error, setError] = useState('')
  const [showEvidence, setShowEvidence] = useState(!draft.evidence.trim())
  const [sending, setSending] = useState(false)
  const locked = busy || sending
  const title = judgment ? '판정 정정' : self ? '내 경험을 검증 기준에 반영' : '작성자에게 피드백 보내기'
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])

  async function submit(event) {
    event.preventDefault()
    if (locked) return
    setError('')
    setSending(true)
    const data = judgment
      ? { status: draft.status, reason: draft.reason.trim(), evidence: draft.evidence.trim() }
      : { issue: draft.message.trim(), action: draft.message.trim(), evidence: draft.evidence.trim(), requestChanges: draft.requestChanges }
    try {
      const response = await save(data)
      if (response?.ok) { clear(); close() }
      else setError(response?.error ?? '저장하지 못했어요. 작성한 내용은 유지돼요.')
    } catch { setError('연결이 끊겼어요. 작성한 내용은 유지돼요. 다시 시도해 주세요.') }
    finally { setSending(false) }
  }

  return <dialog className="composer" ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!locked) close() }}>
    <form onSubmit={submit} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.requestSubmit() }
    }}>
      <header className="composer-header">
        <div><p className="meta">{page}쪽{card ? ` · ${card.title}` : ' · 직접 작성'}</p><h2 id={titleId}>{title}</h2></div>
        <button type="button" aria-label="입력창 닫기" disabled={locked} onClick={close}>✕</button>
      </header>
      <div className="composer-body stack">
        {error && <p className="alert" role="alert">{error}</p>}
        {judgment ? <>
          <fieldset className="verdict-options"><legend>변경할 판정</legend>
            {[['pass', '충족'], ['fail', '불충족'], ['pending', '미확인']].map(([value, label]) => <label key={value} className={draft.status === value ? `chosen ${value}` : ''}>
              <input type="radio" name="verdict" value={value} checked={draft.status === value} disabled={locked} onChange={() => update({ status: value, reason: value === card?.status ? record?.reason ?? '' : '' })} />{label}
            </label>)}
          </fieldset>
          <label>판단 이유<textarea aria-label="판단 이유" autoFocus rows={5} maxLength={4000} value={draft.reason} disabled={locked} onChange={(event) => update({ reason: event.target.value })} placeholder="추가로 확인한 사실과 판정을 바꾼 이유를 적어주세요." required /></label>
        </> : <>
          <p className="composer-hint">{card ? 'AI가 찾은 문제와 수정 방향을 채워뒀어요. 필요한 부분만 고치세요.' : '문제와 원하는 수정 방향을 한 번에 적으세요. 현재 페이지는 근거로 함께 첨부돼요.'}</p>
          <label>{self ? '공유할 검증 경험' : '피드백'}<textarea aria-label={self ? '공유할 검증 경험' : '피드백'} autoFocus rows={8} maxLength={4000} value={draft.message} disabled={locked} onChange={(event) => update({ message: event.target.value })} placeholder="예: 국내와 글로벌 수치를 비교하고 있어요. 같은 국내 시장 자료로 교체하고 성장률을 다시 계산해 주세요." required /></label>
          <div className="line spread meta"><span>{stored ? '이 탭에 초안 저장됨' : '닫았다 열어도 작성 내용이 유지돼요.'}</span><span>{draft.message.length.toLocaleString()} / 4,000</span></div>
        </>}
        <details className="attached-evidence" open={showEvidence} onToggle={(event) => setShowEvidence(event.currentTarget.open)}>
          <summary>첨부 근거{draft.evidence.trim() ? ' · 자동 입력됨' : ' · 근거를 입력해 주세요'} <span className="meta">확인·수정</span></summary>
          <label className="spaced">PDF 원문 근거<textarea aria-label="PDF 원문 근거" rows={5} maxLength={4000} value={draft.evidence} disabled={locked} onChange={(event) => update({ evidence: event.target.value })} required /></label>
          {!record?.evidence && text && <p className="meta">현재 페이지에서 추출한 텍스트예요. 필요한 문장만 남길 수 있어요.</p>}
        </details>
        {!judgment && !self && <label className="checkbox-row"><input type="checkbox" checked={draft.requestChanges} disabled={locked} onChange={(event) => update({ requestChanges: event.target.checked })} /><span>작성자에게 수정 요청하기<small>끄면 피드백만 남기고 리뷰를 계속해요.</small></span></label>}
        {!judgment && <p className="meta">보내면 AI가 기존 기준과 함께 정리해 다음 검증 기준에 반영해요.</p>}
      </div>
      <footer className="composer-footer">
        <button type="button" disabled={locked} onClick={close}>나중에 계속</button>
        <span className="meta">Ctrl + Enter로 보내기</span>
        <button className="primary" disabled={locked || !draft.evidence.trim() || !(judgment ? draft.reason : draft.message).trim()}>
          {locked ? '처리 중…' : judgment ? '판정 저장' : self ? '검증 기준에 반영' : draft.requestChanges ? '수정 요청 보내기' : '피드백 보내기'}
        </button>
      </footer>
    </form>
  </dialog>
}
