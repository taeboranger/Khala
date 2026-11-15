// One browser pass using synthetic live-test responses; never writes the user's DB.
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const { chromium } = require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright')
;(async () => {
  const result = JSON.parse(await fs.readFile('tmp/chat-verification/live-result.json', 'utf8'))
  const fixture = result.first
  const combined = { threads: [...fixture.threads, result.applied.chat, result.expert.chat], knowledge: result.expert.knowledge, experience: result.expert.experience }
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const errors = []; const posts = []
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.route('**/api/connection', (route) => route.fulfill({ json: { connected: true } }))
    await page.route('**/api/chat*', async (route) => {
      const request = route.request()
      if (request.url().includes('&file=')) return route.fulfill({ contentType: 'image/png', body: await fs.readFile('tmp/chat-verification/synthetic-chart.png') })
      if (request.url().includes('?knowledge=')) {
        const rule = combined.knowledge.find((r) => request.url().includes(r.id))
        return route.fulfill({ json: { item: rule, versions: [rule], sources: rule.sources.map((s) => ({ ...s, canOpen: true })), uses: [{ id: result.applied.messages.at(-1).id, chat_id: result.applied.chat.id, at: result.applied.messages.at(-1).at, title: result.applied.chat.title, version: 1 }] } })
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); posts.push(body)
        if (body.op === 'reaction') {
          const message = fixture.messages.find((m) => m.id === body.messageId)
          const reaction = message.reactions?.[0] ?? { actor: 'reviewer', vote: null, liked: false }
          if (body.action === 'like') reaction.liked = body.enabled
          else reaction.vote = body.enabled ? body.action : null
          message.reactions = [reaction]
        }
        return route.fulfill({ json: { ...fixture, ...combined } })
      }
      const state = request.url().includes(result.expert.chat.id) ? result.expert : request.url().includes(result.applied.chat.id) ? result.applied : fixture
      return route.fulfill({ json: request.url().includes('?id=') ? { ...state, ...combined } : combined })
    })
    await page.goto('http://127.0.0.1:3010/chat')
    await page.getByRole('button', { name: fixture.chat.title }).click()
    await page.getByLabel('AI에게 메시지').fill('유지되어야 하는 입력 초안')
    await page.reload()
    await page.getByRole('button', { name: fixture.chat.title }).click()
    assert.equal(await page.getByLabel('AI에게 메시지').inputValue(), '유지되어야 하는 입력 초안')
    await page.getByLabel('데모 사용자').selectOption('reviewer')
    await page.getByRole('button', { name: /^대화 모니터링/ }).click()
    await page.getByRole('heading', { name: '대화 모니터링' }).waitFor()
    await page.screenshot({ path: 'tmp/chat-verification/monitor-screen.png', fullPage: true })
    await page.locator('.monitor-row').filter({ hasText: fixture.chat.title }).click()
    assert.equal(await page.getByLabel('AI에게 메시지').count(), 0)
    const message = page.locator('.chat-message.assistant').last()
    await message.getByRole('button', { name: '추천', exact: true }).click()
    await message.locator('button[aria-label="추천"][aria-pressed="true"]').waitFor()
    await message.getByRole('button', { name: '좋아요', exact: true }).click()
    await message.locator('button[aria-label="좋아요"][aria-pressed="true"]').waitFor()
    await message.getByRole('button', { name: '비추천', exact: true }).click()
    await message.locator('button[aria-label="비추천"][aria-pressed="true"]').waitFor()
    assert.equal(await message.getByRole('button', { name: '추천', exact: true }).getAttribute('aria-pressed'), 'false')
    await message.click({ button: 'right' })
    const modal = page.getByRole('dialog', { name: '대화 피드백' })
    await modal.getByLabel('리뷰 의견').fill('두 수치의 시장 범위를 먼저 확인하세요.')
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden' })
    await message.click({ button: 'right' })
    assert.equal(await modal.getByLabel('리뷰 의견').inputValue(), '두 수치의 시장 범위를 먼저 확인하세요.')
    await page.screenshot({ path: 'tmp/chat-verification/feedback-modal.png', fullPage: true })
    await modal.getByRole('button', { name: '평가 저장 · 기준 자동 정리', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    assert.equal(posts.findLast((p) => p.op === 'review').messageId, fixture.messages.at(-1).id)
    assert.equal(posts.findLast((p) => p.op === 'review').comment, '두 수치의 시장 범위를 먼저 확인하세요.')
    await page.getByRole('button', { name: /^검증 기준/ }).click()
    await page.getByRole('heading', { name: fixture.knowledge[0].title }).waitFor()
    await page.getByRole('button', { name: /근거 .*버전/ }).first().click()
    await page.getByRole('heading', { name: '실제로 쓰인 대화' }).waitFor()
    await page.getByRole('button', { name: '내 전문 지식 기록', exact: true }).click()
    await page.getByRole('heading', { name: '내 전문 지식 기록' }).waitFor()
    assert.match(await page.locator('.experience-list').innerText(), /설문/)
    await page.getByRole('button', { name: /^대화 모니터링/ }).click()
    await page.locator('.monitor-row').filter({ hasText: result.applied.chat.title }).click()
    await page.getByText(/^참고한 유사 사례/).click()
    await page.getByRole('button', { name: '원래 대화 보기' }).first().waitFor()
    assert.deepEqual(errors, [])
    console.log('PASS: right-click modal, Escape/draft restore, vote exclusivity, independent likes, selected-message review, similar-case references; no browser errors')
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
