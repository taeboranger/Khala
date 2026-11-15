import { apiFailure, assertSameOrigin, signup, login, logout, sessionCookie, sessionUser, userDirectory, authDatabase } from '../../../lib/auth.js'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request) {
  try { const user=await sessionUser(request); const {db}=await authDatabase(); const needsAdmin=!(await db.query("SELECT id FROM khala_user WHERE role='admin'")).rows.length; return Response.json({user,people:user?await userDirectory():{},needsAdmin},{headers:{'Cache-Control':'no-store'}}) } catch(e) { return apiFailure(e) }
}
export async function POST(request) {
  try {
    assertSameOrigin(request)
    const text=await request.text(); if(text.length>10000) return Response.json({error:'입력이 너무 길어요.'},{status:413})
    const body=JSON.parse(text)
    if(body.op==='signup') { await signup(body); return Response.json({message:'가입 신청을 완료했어요. 관리자 승인 후 로그인할 수 있어요.'}) }
    if(body.op==='login') { const result=await login(body); return Response.json({user:result.user},{headers:{'Set-Cookie':sessionCookie(result.token),'Cache-Control':'no-store'}}) }
    if(body.op==='logout') { await logout(request); return Response.json({ok:true},{headers:{'Set-Cookie':sessionCookie('',true)}}) }
    return Response.json({error:'지원하지 않는 요청이에요.'},{status:400})
  } catch(e) { return apiFailure(e) }
}
