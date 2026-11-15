import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { connection } from './store.js'
import { ensure, input, registerPeopleReader } from './workspace.js'
import { requestContext } from './request-context.js'
import { resolveModelConfig } from './model-settings.js'

const scrypt = promisify(scryptCallback)
const digest = (s) => createHash('sha256').update(s).digest('hex')
registerPeopleReader(() => requestContext.getStore()?.people)
export async function authDatabase() {
  const conn = await connection()
  globalThis.khalaAuthSchema ??= (async () => {
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_user(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,password_hash text NOT NULL,role text NOT NULL DEFAULT 'member',status text NOT NULL DEFAULT 'pending',reviewer_id uuid REFERENCES khala_user(id),created_at timestamptz NOT NULL DEFAULT now())`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_session(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES khala_user(id),expires_at timestamptz NOT NULL)`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_auth_rate(key text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL)`)
    await conn.db.query(`CREATE TABLE IF NOT EXISTS khala_admin_audit(id uuid PRIMARY KEY,actor text NOT NULL,data jsonb NOT NULL,at timestamptz NOT NULL DEFAULT now())`)
  })().catch((e) => { delete globalThis.khalaAuthSchema; throw e })
  await globalThis.khalaAuthSchema; return conn
}
export async function authTransaction(work) {
  const {db,external} = await authDatabase()
  if (!external) return db.transaction(work)
  const tx = await db.connect()
  try { await tx.query('BEGIN'); const value=await work(tx); await tx.query('COMMIT'); return value }
  catch(e) { await tx.query('ROLLBACK'); throw e } finally { tx.release() }
}
export function publicUser(row) { return {id:row.id,email:row.email,name:row.name,role:row.role,status:row.status,reviewerId:row.reviewer_id,createdAt:row.created_at} }
function emailInput(value) { const email=input(value,'이메일',254).toLowerCase(); ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'이메일 형식을 확인하세요.'); return email }
export async function hashPassword(password) {
  ensure(typeof password === 'string' && password.length >= 12 && password.length <= 128,'비밀번호는 12~128자로 입력하세요.')
  const salt=randomBytes(16).toString('hex'); const hash=await scrypt(password,salt,64)
  return `scrypt:${salt}:${hash.toString('hex')}`
}
async function verifyPassword(password, encoded) {
  const [,salt,hex]=encoded.split(':'); const actual=await scrypt(password,salt,64); const expected=Buffer.from(hex,'hex')
  return expected.length===actual.length && timingSafeEqual(expected,actual)
}
async function consumeRate(key, max, seconds=900) {
  const {db}=await authDatabase()
  const row=(await db.query(`INSERT INTO khala_auth_rate VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN khala_auth_rate.expires_at<now() THEN 1 ELSE khala_auth_rate.count+1 END,expires_at=CASE WHEN khala_auth_rate.expires_at<now() THEN EXCLUDED.expires_at ELSE khala_auth_rate.expires_at END RETURNING count`,[key,seconds])).rows[0]
  ensure(row.count<=max,'시도가 너무 많아요. 잠시 후 다시 시도하세요.',429)
}
export async function signup({name,email,password}) {
  const normalized=emailInput(email); const display=input(name,'이름',80)
  await consumeRate('signup',50,3600)
  const hash=await hashPassword(password); const {db}=await authDatabase()
  const row=(await db.query(`INSERT INTO khala_user(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING *`,[crypto.randomUUID(),normalized,display,hash])).rows[0]
  ensure(row,'이미 가입된 이메일이에요. 로그인하거나 관리자에게 문의하세요.',409)
  return publicUser(row)
}
export async function bootstrapAdmin({name,email,password}) {
  const normalized=emailInput(email); const hash=await hashPassword(password); const display=input(name,'이름',80)
  return authTransaction(async(tx)=>{
    await tx.query('LOCK TABLE khala_user IN SHARE ROW EXCLUSIVE MODE')
    ensure(!(await tx.query("SELECT id FROM khala_user WHERE role='admin'")).rows.length,'이미 관리자가 있어요. 기존 관리자에게 승인을 요청하세요.',409)
    const row=(await tx.query(`INSERT INTO khala_user(id,email,name,password_hash,role,status) VALUES($1,$2,$3,$4,'admin','active') RETURNING *`,[crypto.randomUUID(),normalized,display,hash])).rows[0]
    return publicUser(row)
  })
}
export async function login({email,password}) {
  const normalized=emailInput(email)
  ensure(typeof password==='string' && password.length<=128,'이메일 또는 비밀번호가 올바르지 않아요.',401)
  await consumeRate('login-global',500,900); await consumeRate('login:'+digest(normalized),10)
  const {db}=await authDatabase(); const row=(await db.query('SELECT * FROM khala_user WHERE email=$1',[normalized])).rows[0]
  const valid=await verifyPassword(password,row?.password_hash ?? `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`)
  ensure(row && valid,'이메일 또는 비밀번호가 올바르지 않아요.',401)
  ensure(row.status==='active',row.status==='pending'?'관리자 승인 대기 중이에요.':'계정 사용이 승인되지 않았어요. 관리자에게 문의하세요.',403)
  const token=randomBytes(32).toString('hex')
  await db.query('INSERT INTO khala_session VALUES($1,$2,now()+interval \'7 days\')',[digest(token),row.id])
  await db.query('DELETE FROM khala_auth_rate WHERE key=$1',['login:'+digest(normalized)])
  return {user:publicUser(row),token}
}
function cookieToken(request) { return request.headers.get('cookie')?.split(';').map((s)=>s.trim()).find((s)=>s.startsWith('khala_session='))?.slice(14) || '' }
export function sessionCookie(token, clear=false) {
  const secure=process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE==='true' : process.env.NODE_ENV==='production'
  return `khala_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:604800}${secure?'; Secure':''}`
}
export function assertSameOrigin(request) {
  const expected=process.env.APP_ORIGIN || new URL(request.url).origin
  ensure(request.headers.get('origin')===expected,'다른 사이트에서 보낸 요청은 허용하지 않아요.',403)
}
export async function sessionUser(request) {
  const token=cookieToken(request)
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const {db}=await authDatabase()
  const row=(await db.query(`SELECT u.* FROM khala_session s JOIN khala_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'`,[digest(token)])).rows[0]
  return row ? publicUser(row) : null
}
export async function logout(request) { const {db}=await authDatabase(); await db.query('DELETE FROM khala_session WHERE token_hash=$1',[digest(cookieToken(request))]) }
export async function userDirectory() {
  const {db}=await authDatabase()
  return Object.fromEntries((await db.query('SELECT id,name,role,status,reviewer_id FROM khala_user')).rows.map((u)=>[u.id,{name:u.name,role:u.role==='member'?'업무 사용자':'리뷰어',publish:u.role!=='member',reviewerId:u.reviewer_id,status:u.status}]))
}
export function currentActor() { const user=requestContext.getStore()?.user; ensure(user,'로그인이 필요해요.',401); return user.id }
export function apiFailure(error) { return Response.json({error:error.status?error.message:'요청을 처리하지 못했어요.'},{status:error.status??500,headers:{'Cache-Control':'no-store'}}) }
export async function authenticated(request,handler,{admin=false}={}) {
  try {
    if (!['GET','HEAD'].includes(request.method)) assertSameOrigin(request)
    const user=await sessionUser(request); ensure(user,'로그인이 필요해요.',401)
    ensure(!admin || user.role==='admin','관리자만 사용할 수 있어요.',403)
    const people=await userDirectory()
    const modelConfig=await resolveModelConfig(user.id).catch(()=>({provider:'openai',model:'',apiKey:'',source:'unavailable'}))
    return await requestContext.run({user,people,modelConfig},()=>handler(user))
  } catch(error) { return apiFailure(error) }
}
export async function listUsers() { const {db}=await authDatabase(); return (await db.query('SELECT * FROM khala_user ORDER BY created_at DESC')).rows.map(publicUser) }
export async function administerUser(actor,{id,role,status,reviewerId}) {
  ensure(actor.role==='admin','관리자만 사용할 수 있어요.',403)
  ensure(['member','reviewer','admin'].includes(role) && ['active','pending','rejected','suspended'].includes(status),'역할과 상태를 확인하세요.')
  return authTransaction(async(tx)=>{
    await tx.query('LOCK TABLE khala_user IN SHARE ROW EXCLUSIVE MODE')
    const target=(await tx.query('SELECT * FROM khala_user WHERE id=$1',[id])).rows[0]; ensure(target,'사용자를 찾을 수 없어요.',404)
    if (target.role==='admin' && target.status==='active' && (role!=='admin'||status!=='active')) ensure((await tx.query("SELECT id FROM khala_user WHERE role='admin' AND status='active' AND id<>$1",[id])).rows.length,'마지막 관리자는 중지하거나 권한을 해제할 수 없어요.',409)
    if (reviewerId) { const reviewer=(await tx.query("SELECT id FROM khala_user WHERE id=$1 AND id<>$2 AND role IN ('admin','reviewer') AND status='active'",[reviewerId,id])).rows[0]; ensure(reviewer,'승인된 다른 리뷰어를 지정하세요.') }
    if (status==='active' && role==='member') ensure(reviewerId,'업무 사용자의 담당 리뷰어를 지정하세요.')
    if (target.role!=='member' && (role==='member'||status!=='active')) ensure(!(await tx.query("SELECT id FROM khala_user WHERE reviewer_id=$1 AND status='active'",[id])).rows.length,'담당 구성원을 다른 리뷰어에게 배정한 뒤 변경하세요.',409)
    const updated=(await tx.query('UPDATE khala_user SET role=$2,status=$3,reviewer_id=$4 WHERE id=$1 RETURNING *',[id,role,status,reviewerId||null])).rows[0]
    await tx.query('DELETE FROM khala_session WHERE user_id=$1',[id])
    if ((await tx.query("SELECT to_regclass('khala_chat') AS name")).rows[0].name) await tx.query(`UPDATE khala_chat SET reviewer=$2,data=jsonb_set(data,'{reviewer}',to_jsonb($2::text)) WHERE owner=$1`,[id,reviewerId||''])
    await tx.query('INSERT INTO khala_admin_audit(id,actor,data) VALUES($1,$2,$3::jsonb)',[crypto.randomUUID(),actor.id,JSON.stringify({action:'user_update',target:id,before:publicUser(target),after:publicUser(updated)})])
    return publicUser(updated)
  })
}
