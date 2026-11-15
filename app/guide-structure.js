import { guideStructure } from '../lib/workflow'

export default function GuideStructure({ guide, mode = 'pdf', workType, visibleCards }) {
  const { base, comparison, growth, additional } = guideStructure(guide, mode, workType)
  const generalCondition = mode === 'pdf' ? '모든 PDF 페이지' : '일반 문단과 자료 요약'
  const comparisonCondition = mode === 'pdf' ? '성장률을 비교하는 PDF 페이지' : '두 출처의 수치로 성장률을 계산할 때'
  const rules = [
    ...[base, ...additional].map((rule) => ({ ...rule, condition: generalCondition })),
    ...(workType !== 'general' ? [...comparison, growth].map((rule) => ({ ...rule, condition: comparisonCondition })) : []),
  ]
  return <div className="guide-structure stack">
    {guide.summary && <p className="guide-summary">{guide.summary}</p>}
    {!!guide.sharedCriteria?.length && <details><summary>대화에서 축적된 조직 기준 {guide.sharedCriteria.length}개 참고</summary>{guide.sharedCriteria.map((item) => <p key={item.id}><strong>{item.title} · v{item.version}</strong><br />{item.criterion}</p>)}</details>}
    {!!guide.similarCases?.length && <details><summary>AI 검증에 전달된 유사 사례 {guide.similarCases.length}개</summary><p className="meta">검증을 돕는 참고 사례입니다. 현재 PDF의 원문 근거를 대신하지 않습니다.</p>{guide.similarCases.map((item) => <p key={item.id}><strong>{item.situation}</strong><br />{item.problem}<br />{item.resolution}</p>)}</details>}
    <p className="meta">각 검증 기준에 적용 조건과 확인 방법이 함께 들어 있어요.</p>
    {rules.map((rule) => <section className="stack" key={rule.key}>
      <div className="line spread"><h3>{rule.title}</h3>
        {visibleCards?.some((card) => card.key === rule.key) && <span className="tag pass">현재 페이지 적용</span>}
      </div>
      <p className="meta">적용 조건 · {rule.condition}</p>
      {rule.context && <p>{rule.context}</p>}
      <p><strong>확인 방법</strong><br />{rule.procedure}</p>
    </section>)}
    <p className="meta">미확인 상태에서도 리뷰를 요청할 수 있어요. 최종 승인은 필수 검증 기준을 모두 충족해야 가능해요.</p>
  </div>
}
