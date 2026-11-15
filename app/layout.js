import './style.css'

export const metadata = {
  title: 'KHALA · 팀의 경험으로 더 나은 AI',
  description: 'AI 업무 대화, 상사 리뷰와 조직의 검증 기준',
}

export default function Layout({ children }) {
  return <html lang="ko"><body>{children}</body></html>
}
