import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { bootstrapAdmin, signup, login, administerUser, sessionUser, sessionCookie, authenticated, currentActor, logout, assertSameOrigin } from '../lib/auth.js'
import { people } from '../lib/workflow.js'
import { createChat } from '../lib/chat-service.js'
import { getChat, chatDatabase } from '../lib/chat-store.js'

test('approval, roles, opaque sessions, owner/reviewer permissions and revocation',async()=>{
  const db=new PGlite();globalThis.khalaConnection=Promise.resolve({db,external:false});delete globalThis.khalaAuthSchema
  await db.query('CREATE TABLE khala_workspace(id integer PRIMARY KEY,state jsonb)')
  const password='test-password-at-least-12'
  const request=(token,method='GET',extra={})=>new Request('http://localhost/api/test',{method,headers:{cookie:`khala_session=${token}`,origin:'http://localhost',...extra}})
  try{
    const admin=await bootstrapAdmin({name:'관리자',email:'admin@example.test',password})
    await assert.rejects(()=>bootstrapAdmin({name:'탈취',email:'attacker@example.test',password}),{status:409})
    const member=await signup({name:'작성자',email:'member@example.test',password,role:'admin',status:'active'})
    assert.equal(member.role,'member');assert.equal(member.status,'pending')
    await assert.rejects(()=>login({email:member.email,password}),{status:403})
    await assert.rejects(()=>administerUser(member,{id:member.id,role:'admin',status:'active'}),{status:403})
    await assert.rejects(()=>administerUser(admin,{id:member.id,role:'member',status:'active'}),/리뷰어/)
    await administerUser(admin,{id:member.id,role:'member',status:'active',reviewerId:admin.id})
    const session=await login({email:member.email,password});const adminSession=await login({email:admin.email,password})
    const stored=(await db.query('SELECT * FROM khala_session')).rows
    assert(!stored.some(s=>s.token_hash===session.token));assert(!('password_hash' in session.user))
    assert.match(sessionCookie(session.token),/HttpOnly; SameSite=Lax/)
    assert.equal((await sessionUser(request(session.token))).id,member.id)
    assert.equal((await authenticated(request('', 'GET',{'x-khala-actor':admin.id}),()=>Response.json({ok:true}))).status,401)
    assert.equal((await authenticated(request(session.token),()=>Response.json({ok:true}),{admin:true})).status,403)
    assert.equal((await authenticated(request(session.token,'POST',{origin:'https://other.example'}),()=>Response.json({ok:true}))).status,403)
    assert.throws(()=>assertSameOrigin(request(session.token,'POST',{origin:''})),{status:403})
    const response=await authenticated(request(session.token,'GET',{'x-khala-actor':admin.id}),async()=>{
      assert.equal(currentActor(),member.id);assert.equal(people[member.id].reviewerId,admin.id)
      const id=await createChat(member.id,'market');return Response.json(await getChat(db,id,member.id))
    })
    const chat=await response.json();assert.equal(chat.owner,member.id);assert.equal(chat.reviewer,admin.id)
    await getChat((await chatDatabase()).db,chat.id,admin.id)
    await assert.rejects(()=>getChat(db,chat.id,crypto.randomUUID()),{status:403})
    await assert.rejects(()=>administerUser(admin,{id:admin.id,role:'member',status:'suspended'}),/마지막 관리자/)
    await administerUser(admin,{id:member.id,role:'member',status:'suspended',reviewerId:admin.id})
    assert.equal(await sessionUser(request(session.token)),null)
    await logout(request(adminSession.token));assert.equal(await sessionUser(request(adminSession.token)),null)
  }finally{await db.close();delete globalThis.khalaConnection;delete globalThis.khalaAuthSchema;delete globalThis.khalaChatSchema}
})
