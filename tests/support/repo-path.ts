import path from 'node:path'

/**
 * A file's path relative to the repository root, always with `/`.
 * path.relative() uses `\` on Windows, and repository guards compare against
 * `/` paths (allowlists, "anything under src/"), so an unnormalised path makes
 * them fail on Windows for every file.
 */
export function repoRelative(
  root: string,
  file: string,
  p: Pick<typeof path, 'relative' | 'sep'> = path,
): string {
  return p.relative(root, file).split(p.sep).join('/')
}
