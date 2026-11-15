const demoPeople = {
  writer: { name: '김지우', role: '업무 사용자' },
  reviewer: { name: '이서윤', role: '리뷰어', publish: true },
  peer: { name: '박도현', role: '리뷰어' },
}
let readPeople = () => null
export function registerPeopleReader(reader) { readPeople = reader }
export const people = new Proxy(demoPeople, {
  get: (target, key) => readPeople()?.[key] ?? target[key] ?? { name: '미지정', role: '업무 사용자' },
  ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...Object.keys(readPeople() ?? {})])],
  getOwnPropertyDescriptor: (target, key) => Object.hasOwn(readPeople() ?? {}, key) ? { configurable: true, enumerable: true, value: readPeople()[key] } : Reflect.getOwnPropertyDescriptor(target,key),
})
export const reviewerFor = (actor) => people[actor].reviewerId ?? (Object.hasOwn(demoPeople,actor) ? actor === 'reviewer' ? 'peer' : 'reviewer' : '')

export const workTypes = { market: '시장조사 보고서', general: '일반 문서' }

export class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function ensure(condition, message, status) {
  if (!condition) throw new WorkflowError(message, status)
}

export function input(value, label, max = 4000) {
  ensure(typeof value === 'string' && value.trim().length > 0, `${label}을(를) 입력하세요.`)
  ensure(value.trim().length <= max, `${label}은(는) ${max}자까지 입력할 수 있어요.`)
  return value.trim()
}
