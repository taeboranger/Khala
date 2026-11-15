import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { saveModelSettings, deleteModelSettings, resolveModelConfig, modelSettings, validateConfig, decryptSecret } from '../lib/model-settings.js'
import { requestContext } from '../lib/request-context.js'
import { currentModel } from '../lib/llm.js'
test('encrypted personal keys, admin-only defaults, destination binding and request isolation',async()=>{
  const db=new PGlite();globalThis.khalaConnection=Promise.resolve({db,external:false});delete globalThis.khalaModelSchema
  const oldKey=process.env.KHALA_ENCRYPTION_KEY;process.env.KHALA_ENCRYPTION_KEY=randomBytes(32).toString('base64')
  const admin={id:crypto.randomUUID(),role:'admin'},member={id:crypto.randomUUID(),role:'member'},other={id:crypto.randomUUID(),role:'member'}
  const secret='fake-key-for-unit-test-only';const body={scope:'organization',provider:'openai',model:'test-model',apiKey:secret}
  try{
    await assert.rejects(()=>saveModelSettings(member,body),{status:403})
    const saved=await saveModelSettings(admin,body);assert.equal(saved.organization.hasKey,true);assert(!JSON.stringify(saved).includes(secret))
    const stored=(await db.query("SELECT config FROM khala_model_settings WHERE owner='organization'")).rows[0].config
    assert(!JSON.stringify(stored).includes(secret));assert.equal(await decryptSecret(stored.secret,'organization'),secret)
    await assert.rejects(()=>decryptSecret(stored.secret,member.id))
    const tampered={...stored.secret,tag:randomBytes(16).toString('base64')};await assert.rejects(()=>decryptSecret(tampered,'organization'))
    assert.equal((await resolveModelConfig(member.id)).source,'organization')
    await saveModelSettings(member,{...body,scope:'personal',model:'personal-model'})
    await saveModelSettings(member,{...body,scope:'personal',model:'renamed-model',apiKey:''})
    assert.equal((await resolveModelConfig(member.id)).apiKey,secret)
    assert.equal((await resolveModelConfig(other.id)).model,'test-model')
    await assert.rejects(()=>saveModelSettings(member,{scope:'personal',provider:'anthropic',model:'another-model',apiKey:''}),/API 키/)
    await saveModelSettings(member,{scope:'personal',provider:'compatible',baseUrl:'http://127.0.0.1:11434/v1',model:'local-model'})
    assert.equal((await resolveModelConfig(member.id)).apiKey,'')
    const configs=await Promise.all([resolveModelConfig(member.id),resolveModelConfig(other.id)])
    await Promise.all(configs.map(config=>requestContext.run({modelConfig:config},async()=>{await new Promise(r=>setTimeout(r,5));assert.equal(currentModel().model,config.model)})))
    for(const baseUrl of ['http://169.254.169.254/latest','http://127.0.0.1:22/v1','https://api.openai.com.evil.test/v1','https://key:secret@api.openai.com/v1','https://api.openai.com/v1?token=secret']) assert.throws(()=>validateConfig({provider:'compatible',model:'test',baseUrl}))
    await assert.rejects(()=>deleteModelSettings(member,'organization'),{status:403})
    await deleteModelSettings(member,'personal');assert.equal((await resolveModelConfig(member.id)).source,'organization')
    assert(!('secret' in (await modelSettings(member)).organization))
  }finally{if(oldKey===undefined)delete process.env.KHALA_ENCRYPTION_KEY;else process.env.KHALA_ENCRYPTION_KEY=oldKey;await db.close();delete globalThis.khalaConnection;delete globalThis.khalaModelSchema}
})
