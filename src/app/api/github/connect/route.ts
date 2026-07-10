import { NextResponse } from 'next/server'
import { GITHUB_APP_SLUG } from '@/lib/github'

export async function GET() {
  return NextResponse.redirect(`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`)
}
