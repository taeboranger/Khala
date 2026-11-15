import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

async function executable() {
  if (process.env.KHALA_CODEX_PATH) return process.env.KHALA_CODEX_PATH
  if (process.platform === 'win32') {
    const candidate = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')
    try { await access(candidate); return candidate } catch {}
  }
  return 'codex'
}

async function run(args, input = '', timeout = 120000, cwd = process.cwd()) {
  const binary = await executable()
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('구독 모델 응답 시간이 초과됐어요. 다시 실행하세요.')) }, timeout)
    child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-32000) })
    child.stderr.on('data', (chunk) => { if (args[0] === 'login') output = (output + chunk).slice(-32000) })
    child.on('error', () => { clearTimeout(timer); reject(new Error('Codex CLI를 실행할 수 없어요. 설치 상태를 확인하세요.')) })
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? accept(output) : reject(new Error('Codex 연결 또는 구독 사용량을 확인하세요.')) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export async function subscriptionStatus() {
  try {
    const value = await run(['login', 'status'], '', 8000)
    return { connected: /logged in using chatgpt/i.test(value), provider: 'ChatGPT 구독' }
  } catch {
    return { connected: false, provider: 'ChatGPT 구독' }
  }
}

export async function subscriptionModel(instructions, data, properties, images = []) {
  const directory = await mkdtemp(join(tmpdir(), 'khala-inference-'))
  try {
    const schema = join(directory, 'schema.json')
    const result = join(directory, 'result.json')
    await writeFile(schema, JSON.stringify({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }))
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', 'features.shell_tool=false', '--color', 'never', '--output-schema', schema, '--output-last-message', result, '-']
    for (const [index, attachment] of images.entries()) {
      const path = join(directory, `image-${index}.${attachment.mime === 'image/jpeg' ? 'jpg' : 'png'}`)
      await writeFile(path, attachment.content)
      args.splice(args.length - 1, 0, '--image', path)
    }
    if (process.env.KHALA_CODEX_MODEL) args.splice(1, 0, '--model', process.env.KHALA_CODEX_MODEL)
    await run(args, 'Return only the structured result. Use only the supplied document data; no tools are needed.\n' + instructions + '\n' + JSON.stringify(data), 120000, directory)
    return { data: JSON.parse(await readFile(result, 'utf8')), model: process.env.KHALA_CODEX_MODEL ?? 'ChatGPT 구독 모델' }
  } finally {
    const target = resolve(directory)
    if (target.startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')) && target.includes('khala-inference-')) await rm(target, { recursive: true, force: true })
  }
}
