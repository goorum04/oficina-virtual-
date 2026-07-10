import { Octokit } from '@octokit/rest'
import type Anthropic from '@anthropic-ai/sdk'

export const GITHUB_TOOLS: Anthropic.Tool[] = [
  {
    name: 'github_list_files',
    description: 'List files and folders at a path in the repo (default branch). Use path "" for the repo root.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path within the repo, e.g. "src" or "" for root' } },
      required: ['path'],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read the text content of a file in the repo (default branch).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'github_write_file',
    description: 'Create or update a file on a branch (creates the branch from the default branch if it does not exist yet). Does not touch the default branch directly.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'Full new file content (text)' },
        message: { type: 'string', description: 'Commit message' },
        branch: { type: 'string', description: 'Branch name to commit to, e.g. "agent/rex-fix-login"' },
      },
      required: ['path', 'content', 'message', 'branch'],
    },
  },
  {
    name: 'github_create_pr',
    description: 'Open a Pull Request from a branch into the default branch. Use after committing changes with github_write_file.',
    input_schema: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['branch', 'title', 'body'],
    },
  },
  {
    name: 'github_merge_pr',
    description: 'Merge a Pull Request. ONLY call this after the human has explicitly confirmed in the conversation that you should merge (e.g. they replied "sí", "merge it", "adelante"). Never call it proactively.',
    input_schema: {
      type: 'object',
      properties: { pr_number: { type: 'number' } },
      required: ['pr_number'],
    },
  },
]

export async function runGithubTool(
  octokit: Octokit,
  owner: string,
  repo: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case 'github_list_files': {
        const path = (input.path as string) || ''
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path })
        if (!Array.isArray(data)) return `"${path}" is a file, not a directory.`
        return data.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}`).join('\n') || '(empty directory)'
      }
      case 'github_read_file': {
        const path = input.path as string
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path })
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
          return `"${path}" is not a readable file.`
        }
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }
      case 'github_write_file': {
        const { path, content, message, branch } = input as { path: string; content: string; message: string; branch: string }
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo })
        const defaultBranch = repoData.default_branch

        const branchExists = await octokit.rest.git
          .getRef({ owner, repo, ref: `heads/${branch}` })
          .then(() => true)
          .catch(() => false)

        if (!branchExists) {
          const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` })
          await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseRef.object.sha })
        }

        let sha: string | undefined
        try {
          const { data: existing } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
          if (!Array.isArray(existing) && existing.type === 'file') sha = existing.sha
        } catch { /* file doesn't exist yet, that's fine */ }

        await octokit.rest.repos.createOrUpdateFileContents({
          owner, repo, path, message, branch, sha,
          content: Buffer.from(content, 'utf-8').toString('base64'),
        })
        return `Committed "${path}" to branch "${branch}".`
      }
      case 'github_create_pr': {
        const { branch, title, body } = input as { branch: string; title: string; body: string }
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo })
        const { data: pr } = await octokit.rest.pulls.create({
          owner, repo, title, body, head: branch, base: repoData.default_branch,
        })
        return `Opened PR #${pr.number}: ${pr.html_url}`
      }
      case 'github_merge_pr': {
        const prNumber = input.pr_number as number
        const { data } = await octokit.rest.pulls.merge({ owner, repo, pull_number: prNumber })
        return data.merged ? `PR #${prNumber} merged.` : `Could not merge PR #${prNumber}: ${data.message}`
      }
      default:
        return `Unknown tool: ${toolName}`
    }
  } catch (err) {
    return `Error running ${toolName}: ${err instanceof Error ? err.message : 'unknown error'}`
  }
}
