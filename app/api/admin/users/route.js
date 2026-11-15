import { authenticated, listUsers, administerUser } from '../../../../lib/auth.js'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=(request)=>authenticated(request,async()=>Response.json({users:await listUsers()},{headers:{'Cache-Control':'no-store'}}),{admin:true})
export const POST=(request)=>authenticated(request,async(user)=>{await administerUser(user,await request.json());return Response.json({users:await listUsers()})},{admin:true})
