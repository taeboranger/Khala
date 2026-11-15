'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { registerPeopleReader } from '../lib/workspace'

const Session = createContext(null)
export const useSession = () => useContext(Session)
export default function SessionProvider({children}) {
  const [session,setSession]=useState(null)
  const [error,setError]=useState('')
  const pathname=usePathname(); const router=useRouter()
  async function reload() {
    const response=await fetch('/api/auth',{cache:'no-store'})
    const body=await response.json()
    if(!response.ok) throw new Error(body.error)
    registerPeopleReader(()=>body.people)
    setSession(body); setError(''); return body
  }
  useEffect(()=>{ reload().catch((e)=>setError(e.message)) },[pathname])
  useEffect(()=>{ if(session && !session.user && pathname!=='/login') router.replace('/login') },[session,pathname,router])
  async function logout() {
    const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'logout'})})
    if(!response.ok) { setError('로그아웃하지 못했어요. 다시 시도하세요.'); return }
    sessionStorage.clear(); registerPeopleReader(()=>({})); setSession({user:null,people:{}}); router.replace('/login')
  }
  if(error) return <main className="account-shell"><p role="alert">{error}</p><button onClick={()=>reload().catch((e)=>setError(e.message))}>다시 연결</button></main>
  if(!session || (!session.user && pathname!=='/login')) return <main className="account-shell" role="status">계정을 확인하고 있어요…</main>
  return <Session.Provider value={{...session,reload,logout}}>{children}</Session.Provider>
}
export function AccountNav() {
  const {user,logout}=useSession()
  return <div className="account-nav"><strong>{user.name}</strong><span>{user.role==='admin'?'관리자':user.role==='reviewer'?'리뷰어':'업무 사용자'}</span><a href="/settings">모델 설정</a>{user.role==='admin'&&<a href="/admin">계정 관리</a>}<button onClick={logout}>로그아웃</button></div>
}
