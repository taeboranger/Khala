import { subscriptionStatus } from '../../../lib/subscription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  return Response.json(await subscriptionStatus())
}
