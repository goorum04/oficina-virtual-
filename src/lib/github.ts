import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'

export const GITHUB_APP_SLUG = 'oficina-virtual-agentes'

export function getAppOctokit() {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    },
  })
}

export function getInstallationOctokit(installationId: string | number) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    },
  })
}
