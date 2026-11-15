import { authenticated } from '../../../../lib/auth.js'
import { modelSettings, saveModelSettings, deleteModelSettings, testModelSettings } from '../../../../lib/model-settings.js'
import { ensure } from '../../../../lib/workflow.js'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=(request)=>authenticated(request,async(user)=>Response.json(await modelSettings(user),{headers:{'Cache-Control':'no-store'}}))
export const POST=(request)=>authenticated(request,async(user)=>{
  const text=await request.text();ensure(text.length<12000,'설정 입력이 너무 길어요.',413);const body=JSON.parse(text)
  const result=body.op==='save'?await saveModelSettings(user,body):body.op==='delete'?await deleteModelSettings(user,body.scope):body.op==='test'?await testModelSettings(user,body.scope):null
  ensure(result,'지원하지 않는 요청이에요.')
  return Response.json(result,{headers:{'Cache-Control':'no-store'}})
})
