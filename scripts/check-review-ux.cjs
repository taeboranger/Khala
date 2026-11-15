// One isolated browser run. Requests are mocked; no app DB writes or LLM calls.
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { chromium } = require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright')

;(async () => {
  const { apply, current, view } = await import(pathToFileURL(path.resolve('lib/workflow.js')))
  const state = JSON.parse(await fs.readFile('tmp/verification/ui-state.json', 'utf8'))
  const employee = state.docs[0]
  employee.title = '직원 테스트'; employee.status = 'review'
  employee.submissions = [{ revision: current(employee).number, at: new Date().toISOString() }]
  const self = structuredClone(employee)
  self.id = 'self-test'; self.title = '상사 테스트'; self.owner = 'reviewer'; self.reviewer = 'peer'; self.status = 'draft'; self.submissions = []
  state.docs.push(self)
  const png = await fs.readFile('tmp/verification/ui-page.png')
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const errors = []; const posts = []
  let failOnce = true
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/auth', route => route.fulfill({json:{user:{id:'reviewer',name:'이서윤',role:'reviewer'},people:{reviewer:{name:'이서윤',role:'리뷰어',publish:true}}}}))
    await page.route('**/api/connection', route => route.fulfill({json:{connected:true,provider:'mock',model:'test'}}))
    await page.route('**/api/pdf?*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    await page.route('**/api/workspace', async (route) => {
      const actor = 'reviewer'
      if (route.request().method() === 'GET') return route.fulfill({ json: { ...view(state, actor), modelReady: true } })
      const body = route.request().postDataJSON()
      if (body.op === 'feedback' && failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { error: '테스트 연결 오류 · 입력 유지 확인' } }) }
      posts.push(body)
      if (['feedback', 'proposal'].includes(body.op)) body.synthesis = { mode: 'llm', baseVersion: state.guides.at(-1).version, summary: '모의 검증 기준 반영', rules: [] }
      const result = apply(state, actor, body)
      return route.fulfill({ json: { ...view(state, actor), modelReady: true, result } })
    })
    await page.goto('http://127.0.0.1:3010')
    async function openEmployee() {
      await page.getByRole('button', { name: '리뷰 대기열', exact: true }).click()
      await page.getByRole('button', { name: '직원 테스트', exact: true }).click()
      await page.getByRole('button', { name: '이 내용으로 수정 요청', exact: true }).first().click()
    }
    await openEmployee()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.match(await dialog.getByLabel('피드백', { exact: true }).inputValue(), /글로벌/)
    assert.ok((await dialog.getByLabel('PDF 원문 근거').inputValue()).length > 30)
    const message = '국내와 글로벌 자료의 범위가 다릅니다. 국내 자료로 통일하고 계산해 주세요.'
    await dialog.getByLabel('피드백', { exact: true }).fill(message)
    await dialog.getByLabel('피드백', { exact: true }).press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '이 내용으로 수정 요청', exact: true }).first().click()
    assert.equal(await dialog.getByLabel('피드백', { exact: true }).inputValue(), message)
    await page.reload(); await openEmployee()
    assert.equal(await dialog.getByLabel('피드백', { exact: true }).inputValue(), message)
    await page.screenshot({ path: 'tmp/verification/review-composer-ui.png' })
    await dialog.getByLabel('피드백', { exact: true }).press('Control+Enter')
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByLabel('피드백', { exact: true }).inputValue(), message)
    await dialog.getByRole('button', { name: '수정 요청 보내기', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(employee.status, 'changes')
    assert.equal(employee.feedback[0].issue, message)
    assert.equal(employee.feedback[0].page, 1)
    assert.equal(employee.feedback[0].publishedVersion, 2)
    await page.getByRole('button', { name: '내 문서', exact: true }).click()
    await page.getByRole('button', { name: '상사 테스트', exact: true }).click()
    await page.getByRole('button', { name: '판정 정정', exact: true }).first().click()
    await dialog.getByLabel('충족', { exact: true }).check()
    assert.equal(await dialog.getByLabel('판단 이유').inputValue(), '')
    await dialog.getByLabel('판단 이유').fill('추가 원문으로 해당 주장에 사용된 자료를 확인했습니다.')
    await dialog.getByRole('button', { name: '판정 저장', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '이 경험을 검증 기준에 반영', exact: true }).first().click()
    assert.ok((await dialog.getByLabel('공유할 검증 경험').inputValue()).length > 20)
    await dialog.getByRole('button', { name: '검증 기준에 반영', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(self.feedback[0].kind, 'self')
    await page.getByRole('button', { name: '검증 결과', exact: true }).click()
    await page.screenshot({ path: 'tmp/verification/review-workspace-ui.png', fullPage: true })
    await page.getByLabel('수정본 PDF', { exact: true }).setInputFiles('output/pdf/test-kit/04-reviewer-metric-fixed.pdf')
    await page.getByRole('button', { name: '이 PDF로 교체하고 검증', exact: true }).waitFor()
    assert.ok((await page.locator('.next-action').innerText()).includes('04-reviewer-metric-fixed.pdf'))
    await page.getByRole('button', { name: '내 문서', exact: true }).click()
    await page.getByLabel('PDF 파일', { exact: true }).setInputFiles('output/pdf/test-kit/06-general-survey-error.pdf')
    await page.getByRole('radio', { name: /일반 문서/ }).check()
    assert.equal(await page.getByRole('button', { name: 'PDF 검증 시작', exact: true }).isEnabled(), true)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ result: 'passed', checks: ['AI prefill', 'attached evidence', 'draft after close and reload', 'Ctrl+Enter', 'failed save retains draft', 'review feedback published once', 'human judgment', 'self feedback', 'replacement selection', 'new upload selection'], mutations: 'mock requests only', posts: posts.map((body) => body.op) }))
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
