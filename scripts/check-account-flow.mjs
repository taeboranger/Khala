// One real HTTP/browser pass against an isolated DB and a mock LLM; no production data or paid calls.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { bootstrapAdmin } from '../lib/auth.js'
import { connection } from '../lib/store.js'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=resolve(import.meta.dirname,'..');const directory=resolve(root,'tmp',`account-smoke-${Date.now()}`)
await mkdir(directory,{recursive:true})
Object.assign(process.env,{DATABASE_URL:'',KHALA_DATA_DIR:directory,KHALA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),SESSION_COOKIE_SECURE:'false',LLM_PROVIDER:'openai',LLM_MODEL:'',LLM_API_KEY:'',OPENAI_MODEL:'',OPENAI_API_KEY:''})
const password=randomBytes(18).toString('hex')
await bootstrapAdmin({name:'테스트 관리자',email:'admin@example.test',password})
await (await connection()).db.close();delete globalThis.khalaConnection
const calls=[]
const valueFor=(schema)=>schema.type==='object'?Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,valueFor(v)])):schema.type==='array'?[]:schema.type==='boolean'?false:schema.type==='number'?0:'모의 API 연결 성공'
const mock=createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);calls.push(body);const result=valueFor(body.response_format.json_schema.schema);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}))}catch{res.writeHead(500);res.end()}})
await new Promise(r=>mock.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${mock.address().port}`
const port=Number(process.env.KHALA_SMOKE_PORT||3012);const origin=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:'production',APP_ORIGIN:origin,KHALA_ALLOWED_API_ORIGINS:endpoint},stdio:['ignore','pipe','pipe']})
let serverLog='';server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d)
let browser
try{
  let ready=false
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(serverLog);try{if((await fetch(origin+'/api/auth')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}assert(ready,'server readiness')
  assert.equal((await fetch(origin+'/api/chat',{headers:{'x-khala-actor':'reviewer'}})).status,401)
  const home = await fetch(origin, { redirect: 'manual' })
  assert.equal(home.status, 307)
  assert.equal(new URL(home.headers.get('location'), origin).pathname, '/chat')
  for (const path of ['/api/workspace', '/api/pdf']) {
    assert.equal((await fetch(origin + path)).status, 404)
  }
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})})
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin);await page.waitForURL('**/login')
  await page.getByRole('button',{name:'회원가입',exact:true}).click();await page.getByLabel('이름',{exact:true}).fill('테스트 작성자');await page.getByLabel('이메일',{exact:true}).fill('member@example.test');await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'가입 신청',exact:true}).click();await page.getByRole('status').filter({hasText:'가입 신청을 완료'}).waitFor()
  await page.getByLabel('이메일',{exact:true}).fill('member@example.test');await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('alert').filter({hasText:'승인 대기'}).waitFor()
  await page.getByLabel('이메일',{exact:true}).fill('admin@example.test');await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'로그인',exact:true}).click();await page.waitForURL('**/chat')
  await page.getByRole('link',{name:'계정 관리',exact:true}).click();const row=page.locator('.account-user').filter({hasText:'member@example.test'});await row.getByLabel('담당 리뷰어').selectOption({label:'테스트 관리자'});await row.getByLabel('상태').selectOption('active');await row.getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('status').filter({hasText:'계정 설정을 저장'}).waitFor()
  await page.getByRole('link',{name:'모델 설정',exact:true}).click();await page.getByRole('button',{name:'조직 기본 모델',exact:true}).click();await page.getByLabel(/^제공자/).selectOption('compatible');await page.getByLabel(/^API 기본 주소/).fill(endpoint+'/v1');await page.getByLabel(/^모델 ID/).fill('mock-org-model');await page.getByRole('button',{name:'설정 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'저장했어요'}).waitFor();await page.getByRole('button',{name:'연결 테스트',exact:true}).click();await page.getByRole('status').filter({hasText:'구조화 응답을 확인'}).waitFor()
  await page.screenshot({path:resolve(directory,'model-settings.png'),fullPage:true})
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.waitForURL('**/login');await page.getByLabel('이메일',{exact:true}).fill('member@example.test');await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'로그인',exact:true}).click();await page.waitForURL('**/chat')
  assert.equal((await context.request.get(origin+'/api/admin/users')).status(),403)
  assert.equal((await context.request.post(origin+'/api/settings/model',{headers:{origin},data:{op:'delete',scope:'organization'}})).status(),403)
  await page.getByRole('button',{name:'＋ 새 대화',exact:true}).click();await page.getByLabel('AI에게 메시지',{exact:true}).fill('회원 승인 후 조직 기본 모델을 사용하는지 확인해 줘.');await page.getByRole('button',{name:'보내기 ↑',exact:true}).click();await page.locator('.chat-message.assistant').filter({hasText:'모의 API 연결 성공'}).waitFor({timeout:60000})
  assert(calls.length>=2);assert(calls.every(c=>c.model==='mock-org-model'))
  const chats=await (await context.request.get(origin+'/api/chat')).json();assert(chats.threads.length===1)
  const messages=await(await context.request.get(origin+'/api/chat?id='+chats.threads[0].id)).json();assert.equal(messages.messages.at(-1).model,'compatible/mock-org-model')
  await page.screenshot({path:resolve(directory,'signed-in-chat.png'),fullPage:true});assert.deepEqual(errors,[])
  console.log('PASS: isolated real signup → pending denial → admin approval/reviewer assignment → encrypted settings → mock API probe → member login → organization-model chat; spoofed header and admin access denied; no browser errors.')
  console.log('Screenshots: '+directory)
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:resolve(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,3000))}throw error}finally{await browser?.close();server.kill();await new Promise(r=>mock.close(r))}
