import { db } from '@/lib/db'
import { getInstallationOctokit } from '@/lib/github'
import { NextResponse } from 'next/server'

export async function GET() {
  const connection = await db.githubConnection.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!connection) {
    return NextResponse.json({ connected: false, repos: [] })
  }

  try {
    const octokit = getInstallationOctokit(connection.installationId)
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 })
    return NextResponse.json({
      connected: true,
      account: connection.accountLogin,
      repos: data.repositories.map(r => r.full_name),
    })
  } catch {
    return NextResponse.json({ connected: true, account: connection.accountLogin, repos: [] })
  }
}
