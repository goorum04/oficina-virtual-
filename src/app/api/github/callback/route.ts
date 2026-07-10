import { db } from '@/lib/db'
import { getAppOctokit } from '@/lib/github'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const installationId = url.searchParams.get('installation_id')

  if (!installationId) {
    return NextResponse.redirect(new URL('/?github=error', req.url))
  }

  try {
    const app = getAppOctokit()
    const { data } = await app.rest.apps.getInstallation({
      installation_id: Number(installationId),
    })
    const accountLogin =
      (data.account && 'login' in data.account ? data.account.login : null) || 'unknown'

    await db.githubConnection.upsert({
      where: { installationId },
      update: { accountLogin },
      create: { installationId, accountLogin },
    })

    return NextResponse.redirect(new URL('/?github=connected', req.url))
  } catch {
    return NextResponse.redirect(new URL('/?github=error', req.url))
  }
}
