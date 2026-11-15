import { authenticated, currentActor } from '../../../lib/auth.js'
import { modelStatus } from '../../../lib/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
async function handleGET() {
  return Response.json(modelStatus())
}

export const GET = (request) => authenticated(request, () => handleGET(request))
