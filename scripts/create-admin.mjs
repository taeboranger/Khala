import nextEnv from '@next/env'
nextEnv.loadEnvConfig(process.cwd())
import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { bootstrapAdmin } from '../lib/auth.js'
import { connection } from '../lib/store.js'
if (!process.stdin.isTTY) throw new Error('로컬 터미널에서 대화형으로 실행하세요. 비밀번호를 명령 인수로 받지 않습니다.')
const rl=createInterface({input:process.stdin,output:process.stdout})
const name=await rl.question('관리자 이름: '); const email=await rl.question('관리자 이메일: '); rl.close()
function secret(prompt) { return new Promise((resolve,reject)=>{ process.stdout.write(prompt); let value=''; emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); const listen=(str,key)=>{ if(key?.ctrl&&key.name==='c'){finish();reject(new Error('취소됨'))} else if(key?.name==='return'){finish();resolve(value)} else if(key?.name==='backspace'){value=value.slice(0,-1)} else if(str&&!key?.ctrl){value+=str} }; const finish=()=>{process.stdin.off('keypress',listen);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n')}; process.stdin.on('keypress',listen) }) }
try { const password=await secret('비밀번호 (12자 이상, 화면에 표시되지 않음): '); if(password!==await secret('비밀번호 확인: ')) throw new Error('비밀번호가 일치하지 않습니다.'); await bootstrapAdmin({name,email,password}); console.log('최초 관리자 생성 완료. /login 에서 로그인하세요.') }
finally { const {db,external}=await connection(); await (external?db.end():db.close()) }
