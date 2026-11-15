import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { connection } from './store.js'
import { ensure } from './workflow.js'
import { environmentModel, providerDefaults, modelStatus, invokeModel } from './llm.js'

const standardOrigins = ['https://api.openai.com','https://api.x.ai','https://api.deepseek.com','https://api.mistral.ai','https://api.groq.com','https://api.together.xyz','https://openrouter.ai',...['localhost','127.0.0.1','[::1]'].flatMap(host=>[11434,1234,8000].map(port=>`http://${host}:${port}`))]
export const allowedOrigins = () => [...new Set([...standardOrigins,...(process.env.KHALA_ALLOWED_API_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)])]
async function database() {
  const {db}=await connection()
  globalThis.khalaModelSchema ??= db.query('CREATE TABLE IF NOT EXISTS khala_model_settings(owner text PRIMARY KEY,config jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())').catch(e=>{delete globalThis.khalaModelSchema;throw e})
  await globalThis.khalaModelSchema;return db
}
async function encryptionKey() {
  if(process.env.KHALA_ENCRYPTION_KEY) { const key=Buffer.from(process.env.KHALA_ENCRYPTION_KEY,'base64');ensure(key.length===32,'서버의 KHALA_ENCRYPTION_KEY는 32바이트 Base64 키여야 해요.',503);return key }
  ensure(!process.env.DATABASE_URL,'외부 DB를 사용할 때는 서버의 KHALA_ENCRYPTION_KEY를 설정하세요.',503)
  globalThis.khalaEncryptionKey ??= (async()=>{
    const dir=resolve(process.cwd(),'.khala');await mkdir(dir,{recursive:true});const path=resolve(dir,'api-key.key')
    try{await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
    const key=await readFile(path);ensure(key.length===32,'API 키 암호화 파일을 확인하세요.',503);return key
  })().catch(e=>{delete globalThis.khalaEncryptionKey;throw e})
  return globalThis.khalaEncryptionKey
}
export async function encryptSecret(value,owner) {
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',await encryptionKey(),iv);cipher.setAAD(Buffer.from(owner))
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()])
  return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}
}
export async function decryptSecret(value,owner) {
  const decipher=createDecipheriv('aes-256-gcm',await encryptionKey(),Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(owner));decipher.setAuthTag(Buffer.from(value.tag,'base64'))
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8')
}
async function read(owner) { return (await (await database()).query('SELECT config FROM khala_model_settings WHERE owner=$1',[owner])).rows[0]?.config ?? null }
function scopeOwner(user,scope) { ensure(['personal','organization'].includes(scope),'설정 범위를 확인하세요.');ensure(scope!=='organization'||user.role==='admin','조직 기본 모델은 관리자만 변경할 수 있어요.',403);return scope==='organization'?'organization':user.id }
const masked = config => config ? {provider:config.provider,model:config.model,baseUrl:config.baseUrl,outputMode:config.outputMode,hasKey:!!config.secret,updatedAt:config.updatedAt} : null
export async function resolveModelConfig(userId) {
  const personal=await read(userId);const org=personal?null:await read('organization');const config=personal||org
  if(!config)return environmentModel()
  return {provider:config.provider,model:config.model,baseUrl:config.baseUrl,outputMode:config.outputMode,apiKey:config.secret?await decryptSecret(config.secret,personal?userId:'organization'):'',source:personal?'personal':'organization'}
}
export async function modelSettings(user) {
  let effective
  try{effective=modelStatus(await resolveModelConfig(user.id))}catch{effective={configured:false,source:'unavailable',note:'저장된 API 키를 읽을 수 없어요. 서버 암호화 키를 확인하세요.'}}
  return {personal:masked(await read(user.id)),organization:masked(await read('organization')),effective,allowedOrigins:allowedOrigins(),defaults:providerDefaults}
}
export function validateConfig(body) {
  ensure(Object.hasOwn(providerDefaults,body.provider),'제공자를 선택하세요.')
  ensure(typeof body.model==='string'&&body.model.trim().length>0&&body.model.length<=160&&!/[\r\n]/.test(body.model),'모델 ID를 입력하세요.')
  const baseUrl=body.provider==='compatible'?body.baseUrl:providerDefaults[body.provider]
  let url;try{url=new URL(baseUrl)}catch{ensure(false,'API 주소를 확인하세요.')}
  ensure(!url.username&&!url.password&&!url.search&&!url.hash&&['http:','https:'].includes(url.protocol),'API 주소에 인증정보·쿼리·해시를 넣을 수 없어요.')
  ensure(body.provider!=='compatible'||allowedOrigins().includes(url.origin),'허용되지 않은 API 서버예요. 관리자가 KHALA_ALLOWED_API_ORIGINS에 주소를 추가해야 해요.')
  ensure(/^\/[a-zA-Z0-9/_-]*$/.test(url.pathname),'API 기본 경로를 확인하세요.')
  const outputMode=body.provider==='compatible'?(body.outputMode||'schema'):'schema'
  ensure(['schema','json','prompt'].includes(outputMode),'출력 모드를 확인하세요.')
  ensure(body.apiKey===undefined||(typeof body.apiKey==='string'&&body.apiKey.length<=4096&&!/[\r\n]/.test(body.apiKey)),'API 키를 확인하세요.')
  return {provider:body.provider,model:body.model.trim(),baseUrl:url.toString().replace(/\/+$/,''),outputMode}
}
export async function saveModelSettings(user,body) {
  const owner=scopeOwner(user,body.scope);const config=validateConfig(body);const previous=await read(owner)
  const sameDestination=previous?.provider===config.provider&&new URL(previous.baseUrl).origin===new URL(config.baseUrl).origin
  const secret=body.apiKey?.trim()?await encryptSecret(body.apiKey.trim(),owner):!body.clearKey&&sameDestination?previous.secret:null
  ensure(config.provider==='compatible'||secret,'이 제공자는 API 키가 필요해요.')
  await (await database()).query('INSERT INTO khala_model_settings(owner,config) VALUES($1,$2::jsonb) ON CONFLICT(owner) DO UPDATE SET config=EXCLUDED.config,updated_at=now()',[owner,JSON.stringify({...config,secret,updatedAt:new Date().toISOString()})])
  return modelSettings(user)
}
export async function deleteModelSettings(user,scope) { const owner=scopeOwner(user,scope);await (await database()).query('DELETE FROM khala_model_settings WHERE owner=$1',[owner]);return modelSettings(user) }
export async function testModelSettings(user,scope) {
  const owner=scopeOwner(user,scope);const config=await read(owner)
  const resolved=config?{...config,apiKey:config.secret?await decryptSecret(config.secret,owner):''}:await resolveModelConfig(user.id)
  const result=await invokeModel(resolved,'Return {"answer":"KHALA 연결 확인"} as JSON.',{purpose:'Connection test; no user documents are included.'},{answer:{type:'string'}})
  return {ok:true,model:result.model,message:'API 연결과 구조화 응답을 확인했어요. 이미지 입력은 해당 모델의 지원 여부에 따라 달라요.'}
}
