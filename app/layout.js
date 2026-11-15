import './style.css'
import SessionProvider from './session-provider'

export const metadata = {
  title: 'KHALA · 팀의 경험으로 더 나은 AI',
  description: 'AI 업무 대화, 담당 리뷰어의 피드백과 팀의 검증 기준',
}

export default function Layout({ children }) {
  return <html lang="ko"><body><SessionProvider>{children}</SessionProvider></body></html>
}
