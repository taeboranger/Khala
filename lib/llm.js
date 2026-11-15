import Ajv from 'ajv'
import { ensure, WorkflowError } from './workspace.js'
import { requestContext } from './request-context.js'

const ajv = new Ajv({ strict: false, allErrors: false })
export const providerDefaults = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', compatible: 'http://127.0.0.1:11434/v1' }
export function environmentModel() {
  const provider = process.env.LLM_PROVIDER || 'openai'
  return { provider, model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || '', apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || providerDefaults[provider], outputMode: process.env.LLM_OUTPUT_MODE || 'schema', source: 'environment' }
}
export const currentModel = () => requestContext.getStore()?.modelConfig ?? environmentModel()
export function modelStatus(config = currentModel()) {
  const configured = !!config.model && (config.provider === 'compatible' || !!config.apiKey)
  return { configured, connected: configured, provider: config.provider, model: config.model, source: config.source, note: '설정 상태입니다. 실제 연결은 연결 테스트로 확인하세요.' }
}
export const modelReady = () => modelStatus().configured

export function buildModelRequest(config, instructions, data, properties, images = []) {
  ensure(Object.hasOwn(providerDefaults, config.provider), 'LLM 제공자를 선택하세요.')
  ensure(config.model && (config.apiKey || config.provider === 'compatible'), '모델 설정에서 제공자·모델·API 키를 입력하세요.', 503)
  const schema = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
  const base = config.baseUrl.replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json' }
  const text = JSON.stringify(data)
  const encoded = images.map((image) => ({ mime: image.mime, data: Buffer.from(image.content).toString('base64') }))
  let url; let body
  if (config.provider === 'openai') {
    url = `${base}/responses`; headers.Authorization = `Bearer ${config.apiKey}`
    body = { model: config.model, store: false, instructions, input: [{ role: 'user', content: [{ type: 'input_text', text }, ...encoded.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` }))] }], text: { format: { type: 'json_schema', name: 'khala_result', strict: true, schema } } }
  } else if (config.provider === 'anthropic') {
    url = `${base}/messages`; headers['x-api-key'] = config.apiKey; headers['anthropic-version'] = '2023-06-01'
    body = { model: config.model, max_tokens: 16384, system: instructions, messages: [{ role: 'user', content: [{ type: 'text', text }, ...encoded.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }))] }], output_config: { format: { type: 'json_schema', schema } } }
  } else if (config.provider === 'gemini') {
    url = `${base}/models/${encodeURIComponent(config.model)}:generateContent`; headers['x-goog-api-key'] = config.apiKey
    body = { systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: 'user', parts: [{ text }, ...encoded.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema } }
  } else {
    url = `${base}/chat/completions`
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    const mode = config.outputMode || 'schema'
    const system = mode === 'schema' ? instructions : `${instructions}\nReturn only valid JSON matching this schema: ${JSON.stringify(schema)}`
    body = { model: config.model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: encoded.length ? [{ type: 'text', text }, ...encoded.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : text }] }
    if (mode !== 'prompt') body.response_format = mode === 'json' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'khala_result', strict: true, schema } }
  }
  return { url, headers, body, schema }
}

export async function invokeModel(config, instructions, data, properties, images = [], transport = fetch) {
  const request = buildModelRequest(config, instructions, data, properties, images)
  let response
  try { response = await transport(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error', signal: AbortSignal.timeout(120000) }) }
  catch { throw new WorkflowError('LLM API에 연결하지 못했어요. 주소와 서버 상태를 확인하세요.', 502) }
  ensure(response.ok, `LLM API 요청 실패 (${response.status}). 키·모델·사용량·출력 모드를 확인하세요.`, 502)
  const result = await response.json()
  let value
  if (config.provider === 'openai') { ensure(result.status === 'completed', '모델 응답이 완료되지 않았어요.', 502); value = result.output?.flatMap((o) => o.content ?? []).filter((p) => p.type === 'output_text').map((p) => p.text).join('') }
  else if (config.provider === 'anthropic') { ensure(result.stop_reason === 'end_turn', '모델 응답이 중단되거나 거절됐어요.', 502); value = result.content?.filter((p) => p.type === 'text').map((p) => p.text).join('') }
  else if (config.provider === 'gemini') { const c = result.candidates?.[0]; ensure(c?.finishReason === 'STOP', '모델 응답이 중단되거나 거절됐어요.', 502); value = c.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') }
  else { ensure(result.choices?.[0]?.finish_reason === 'stop', '모델 응답이 중단되거나 거절됐어요.', 502); value = result.choices[0].message?.content }
  ensure(typeof value === 'string' && value.length < 2_000_000, '모델이 올바른 응답을 보내지 않았어요.', 502)
  let parsed
  try { parsed = JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) } catch { throw new WorkflowError('모델이 JSON 응답을 만들지 못했어요. 구조화 출력을 지원하는 모델이나 출력 모드를 선택하세요.', 502) }
  ensure(ajv.compile(request.schema)(parsed), '모델 응답이 검증 형식에 맞지 않아요. 모델 또는 출력 모드를 확인하세요.', 502)
  return { data: parsed, model: `${config.provider}/${config.model}` }
}
export const llmModel = (instructions, data, properties, images = []) => invokeModel(currentModel(), instructions, data, properties, images)
