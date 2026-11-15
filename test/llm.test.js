import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModelRequest, invokeModel, modelStatus } from '../lib/llm.js'
const properties = { answer: { type: 'string' } }
const image = { mime: 'image/png', content: Buffer.from('image') }
for (const provider of ['openai','anthropic','gemini','compatible']) test(`${provider} request and structured response including vision`, async () => {
  const config = { provider, model: 'test-model', apiKey: 'synthetic-key', baseUrl: 'https://example.test/v1', outputMode: 'schema' }
  const request = buildModelRequest(config, 'system', { question: 'hello' }, properties, [image])
  assert.ok(JSON.stringify(request.body).includes(Buffer.from('image').toString('base64')))
  assert.ok(!request.url.includes('synthetic-key'))
  const payload = { openai: { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"answer":"ok"}' }] }] }, anthropic: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"ok"}' }] }, gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"answer":"ok"}' }] } }] }, compatible: { choices: [{ finish_reason: 'stop', message: { content: '{"answer":"ok"}' } }] } }[provider]
  assert.equal((await invokeModel(config,'s',{},properties,[], async () => Response.json(payload))).data.answer,'ok')
  await assert.rejects(invokeModel(config,'s',{},properties,[],async()=>Response.json({}, {status:401})), /401/)
})
test('local JSON modes and validation do not silently accept malformed model output', async () => {
  const config = { provider: 'compatible', baseUrl:'http://127.0.0.1:11434/v1', model:'local', outputMode:'prompt' }
  assert.equal(modelStatus(config).configured,true)
  assert.equal(buildModelRequest(config,'s',{},properties).body.response_format,undefined)
  await assert.rejects(invokeModel(config,'s',{},properties,[],async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"wrong":1}'}}]})), /형식/)
})
