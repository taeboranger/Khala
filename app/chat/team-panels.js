'use client'

import { useEffect, useState } from 'react'
import { people, workTypes } from '../../lib/workflow'

const when = (at) => new Date(at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const labels = { active: '대화 중', review_requested: '리뷰 요청', reviewed: '검토 완료', changes: '보완 필요' }
const learning = { pending: '추출 대기', complete: '기준 반영', empty: '원문 보존 · 추출할 판단 없음', failed: '추출 실패' }

export function Monitoring({ threads, actor, open, busy }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [work, setWork] = useState('all')
  const assigned = threads.filter((c) => c.reviewer === actor && c.owner !== actor)
  const fresh = (c) => c.revision > (c.seenRevision ?? 0)
  const unreviewed = (c) => c.revision > (c.reviewedRevision ?? 0)
  const views = { all: () => true, fresh, requested: (c) => c.status === 'review_requested', unreviewed, changes: (c) => c.status === 'changes' }
  const matches = assigned.filter((c) => views[filter](c) && (work === 'all' || c.workType === work) && `${c.title} ${c.summary} ${people[c.owner].name}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="team-panel"><div className="chat-line"><div><span className="chat-eyebrow">담당 구성원의 AI 업무</span><h1>대화 모니터링</h1></div><span className="team-live">● 5초마다 자동 갱신</span></div><p>새 메시지와 리뷰 요청을 확인하고 대화의 실제 질문·답변·첨부파일을 읽으세요.</p>
    <div className="team-stats">{[['all','전체 대화'],['fresh','새 메시지'],['requested','리뷰 요청'],['unreviewed','미평가 대화'],['changes','보완 필요']].map(([key,title]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}><strong>{assigned.filter(views[key]).length}</strong>{title}</button>)}</div>
    <div className="chat-knowledge-filters"><input type="search" aria-label="모니터링 검색" placeholder="구성원 · 대화 제목 · 요약 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="모니터링 업무" value={work} onChange={(e) => setWork(e.target.value)}><option value="all">모든 업무</option>{Object.entries(workTypes).map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select></div>
    <div className="monitor-rows">{!matches.length && <div className="chat-knowledge-empty">조건에 맞는 대화가 없어요. 구성원이 대화를 시작하면 여기에 자동으로 나타납니다.</div>}{matches.map((c) => <button className="monitor-row" key={c.id} disabled={busy} onClick={() => open(c)}><div className="chat-line"><span>{people[c.owner].name} · {workTypes[c.workType]}</span><small>{when(c.updatedAt ?? c.at)}</small></div><h2>{fresh(c) && <span className="new-dot" aria-label="새 메시지" />}{c.title}</h2><p>{c.summary || '아직 요약이 없어요. 대화 원문에서 확인할 수 있습니다.'}</p><div className="chat-line"><small>메시지 {c.messageCount ?? c.revision} · 리뷰 {c.reviewCount ?? 0} · {unreviewed(c) ? '최근 대화 평가 필요' : c.revision ? '현재 대화까지 평가됨' : '메시지 없음'}</small><span className="chat-status">{c.pending ? 'AI 응답 중' : labels[c.status]}</span></div></button>)}</div>
  </section>
}

export function Experience({ items = [], busy, learn, open }) {
  const [filter, setFilter] = useState('all')
  const matches = items.filter((m) => filter === 'all' || (filter === 'complete' ? m.extraction?.status === 'complete' : !['complete','empty'].includes(m.extraction?.status)))
  return <section className="team-panel"><span className="chat-eyebrow">상사 자신의 업무 경험</span><h1>내 전문 지식 기록</h1><p>최근 업무 발언 100개와 추출 결과입니다. 질문과 AI 답변은 전문 판단으로 간주하지 않고, 모든 대화 원문은 대화 목록에 보존합니다.</p><div className="chat-knowledge-filters"><select aria-label="전문 지식 상태" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">모든 원문</option><option value="complete">검증 기준으로 반영됨</option><option value="pending">미처리 · 실패</option></select></div><div className="experience-list">{!matches.length && <div className="chat-knowledge-empty">AI와 업무 판단을 나누면 이곳에 원문과 추출 결과가 쌓입니다.</div>}{matches.map((m) => <article key={m.id}><div className="chat-line"><small>{workTypes[m.workType]} · {when(m.at)}</small><span className="chat-status">{learning[m.extraction?.status] ?? '추출 전'}</span></div><h2>{m.title}</h2><p>{m.text || '(첨부파일 메시지)'}</p>{!!m.extraction?.published?.length && <p className="chat-learning">검증 기준 {m.extraction.published.length}개 반영 · {m.extraction.published.map((p) => `v${p.version}`).join(', ')}</p>}<div className="chat-line"><button disabled={busy} onClick={() => open(m.chatId, m.id)}>대화 원문 보기</button>{!['complete','empty'].includes(m.extraction?.status) && <button className="primary" disabled={busy} onClick={() => learn(m)}>기준 추출 다시 시도</button>}</div></article>)}</div></section>
}

export function KnowledgeLibrary({ items, actor, busy, changeActive, open, selected, select }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const version = items.find((r) => r.id === selected)?.version
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController(); setDetail(null); setError('')
    fetch(`/api/chat?knowledge=${selected}`, { headers: {  }, signal: controller.signal }).then(async (r) => { const value = await r.json(); if (!r.ok) throw new Error(value.error); setDetail(value) }).catch((e) => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [selected, actor, version])
  const matches = items.filter((r) => (filter === 'all' || r.workType === filter) && `${r.title} ${r.criterion}`.includes(query))
  if (selected) return <section className="team-panel"><button onClick={() => select(null)}>← 검증 기준 목록</button>{error && <p role="alert">{error}</p>}{!detail ? <p>기준 이력을 불러오고 있어요…</p> : <><span className="chat-eyebrow">{workTypes[detail.item.workType]}</span><div className="chat-line"><h1>{detail.item.title}</h1><span className="chat-status">v{detail.item.version} · {detail.item.active ? '사용 중' : '사용 중지'}</span></div><p>{detail.item.criterion}</p><div className="chat-rule-procedure"><strong>확인 방법</strong><p>{detail.item.procedure}</p></div>{people[actor].role === '리뷰어' && <button disabled={busy} onClick={() => changeActive(detail.item)}>{detail.item.active ? '앞으로의 검색에서 제외' : '다시 사용하기'}</button>}<p className="chat-muted">과거 답변과 PDF 검증은 당시 기준 버전으로 남습니다.</p>
    <div className="knowledge-detail-grid"><section><h2>어떤 경험에서 나왔나요?</h2>{detail.sources.map((s,i) => <article key={i}><small>{people[s.actor]?.name} · {s.kind === 'review_feedback' ? '신입 대화 평가' : s.kind === 'pdf_feedback' ? 'PDF 검증 피드백' : '상사의 업무 대화'}</small><blockquote>{s.quote}</blockquote>{s.canOpen && <button disabled={busy} onClick={() => open(s.chatId, s.kind === 'expert_conversation' ? s.messageId : null)}>원래 대화 열기</button>}{s.docId && <a href="/">PDF 검증 화면 열기 ↗</a>}</article>)}<h2>버전 이력</h2>{detail.versions.map((v) => <details key={v.version}><summary>v{v.version} · {when(v.at)} · {v.change ?? '전문 판단 반영'}</summary><p>{v.criterion}</p><p>{v.procedure}</p></details>)}</section><section><h2>실제로 쓰인 대화</h2><p className="chat-muted">내가 볼 수 있는 대화의 최근 적용 100건입니다.</p>{!detail.uses.length && <p>아직 대화 적용 기록이 없어요.</p>}{detail.uses.map((u) => <button className="knowledge-use" key={u.id} disabled={busy} onClick={() => open(u.chat_id, u.id)}><strong>{u.title}</strong><small>v{u.version} · {when(u.at)}</small></button>)}</section></div></>}</section>
  return <section className="team-panel"><span className="chat-eyebrow">대화와 PDF 리뷰에서 축적된 팀의 경험</span><h1>검증 기준</h1><p>상사의 전문 판단을 LLM이 정리하고 업무에 맞춰 적용합니다. 기준을 선택하면 원문 근거·버전·사용 이력을 확인할 수 있습니다.</p><div className="chat-knowledge-filters"><select aria-label="검증 기준 업무 필터" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">모든 업무</option>{Object.entries(workTypes).map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select><input type="search" aria-label="검증 기준 검색" placeholder="검증 기준 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="chat-knowledge-grid">{!matches.length && <div className="chat-knowledge-empty">아직 일치하는 기준이 없어요. 상사의 업무 대화나 리뷰에서 자동으로 축적됩니다.</div>}{matches.map((r) => <article key={r.id}><div className="chat-line"><small>{workTypes[r.workType]}</small><span>v{r.version} · {r.active ? '사용 중' : '중지'}</span></div><h2>{r.title}</h2><p>{r.criterion}</p><div className="chat-rule-procedure">{r.procedure}</div><button onClick={() => select(r.id)}>근거 {r.sources.length}건 · 버전 · 적용 이력 →</button></article>)}</div></section>
}
