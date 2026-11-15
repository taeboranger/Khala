import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

export async function embeddingModelId() {
  const manifest = JSON.parse(await readFile(resolve('.khala-models/multilingual-e5-small/manifest.json'), 'utf8'))
  return `${manifest.repo}@${manifest.revision}:mean-normalized-q8-v1`
}
export async function embedTexts(texts) {
  if (!texts.length) return []
  await embeddingModelId()
  return new Promise((accept, reject) => {
    const child = spawn(process.env.KHALA_PYTHON ?? 'python', [resolve('scripts/embed-rag.py')], { windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('로컬 의미 검색 응답 시간이 초과됐어요.')) }, 90000)
    child.stdout.on('data', (part) => { output += part; if (output.length > 16_000_000) child.kill() })
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); reject(new Error('로컬 임베딩 실행기를 확인하세요.')) })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        if (code !== 0) throw new Error('로컬 임베딩 모델을 실행하지 못했어요.')
        const result = JSON.parse(output)
        if (!Array.isArray(result) || result.length !== texts.length || result.some((v) => v.length !== 384 || v.some((n) => !Number.isFinite(n)))) throw new Error('임베딩 결과를 확인하세요.')
        accept(result)
      } catch (error) { reject(error) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ texts }))
  })
}
