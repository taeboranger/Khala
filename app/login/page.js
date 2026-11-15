'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '../session-provider'
export default function Login() {
  const {user,needsAdmin,reload}=useSession(); const router=useRouter()
  const [mode,setMode]=useState('login'); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState('')
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    const form=e.currentTarget
    try { const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(form)),op:mode})}); const data=await r.json(); if(!r.ok) throw new Error(data.error); if(mode==='login') { await reload(); router.replace('/chat') } else { form.reset();setMode('login');setMessage(data.message) } } catch(e) {setError(e.message)} finally {setBusy(false)}
  }
  return <main className="account-shell account-login"><a className="logo" href="/chat">KHALA</a><h1>{mode==='login'?'팀의 경험을 이어가세요':'팀에 합류하세요'}</h1><p>대화와 문서를 검증하고, 전문가의 피드백을 다음 업무에 활용합니다.</p>{user?<a href="/chat">{user.name}님으로 계속하기 →</a>:<>
    {needsAdmin&&<aside className="notice">아직 관리자가 없어요. 서버 관리자가 <code>npm run admin:create</code>로 최초 관리자 계정을 만든 뒤 이용할 수 있어요.</aside>}
    <div className="account-tabs"><button aria-pressed={mode==='login'} onClick={()=>{setMode('login');setError('')}}>로그인</button><button aria-pressed={mode==='signup'} onClick={()=>{setMode('signup');setError('')}}>회원가입</button></div>
    <form className="account-form" onSubmit={submit}>{mode==='signup'&&<label>이름<input name="name" autoComplete="name" required maxLength={80}/></label>}<label>이메일<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>비밀번호<input name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='signup'?12:1} maxLength={128} required/></label>{mode==='signup'&&<small>비밀번호는 12자 이상입니다. 가입 후 관리자가 역할과 담당 리뷰어를 지정하면 로그인할 수 있어요.</small>}{error&&<p role="alert" className="account-error">{error}</p>}{message&&<p role="status">{message}</p>}<button className="primary" disabled={busy}>{busy?'처리 중…':mode==='login'?'로그인':'가입 신청'}</button></form></>}
  </main>
}
