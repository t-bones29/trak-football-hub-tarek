import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as burned from '../../scripts/burned-credentials.mjs'
import { repoRelative } from '../../tests/support/repo-path'

// The dev-account password was a literal in LandingPage.tsx, DevSetupPage.tsx
// and DevSwitcher.tsx. The /dev-setup ROUTE is registered behind
// `import.meta.env.DEV`, which is why it looked safe — but that guard decides
// which routes register, not which chunks Rollup emits. The built bundle shipped
// dist/assets/DevSetupPage-*.js containing the password twelve times, referenced
// from the entry bundle, on a public site.
//
// (LandingPage's and DevSwitcher's copies did NOT ship — their uses are dead in
// a production build and Rollup dropped them. Kostas caught that, by building
// the branch while I read the source. Source exposure on a public repository is
// still exposure, so they were removed anyway.)
//
// The FIRST version of this test searched only src/, scripts/ and
// supabase/functions/, and only .ts/.tsx/.js/.mjs/.cjs. It reported clean while
// three files still held the value — including supabase/seeds/dev_data.sql,
// which inserts into auth.users with crypt('TrakDev123', …) and would have
// silently restored the compromised password after a rotation. Kostas caught
// that too. A guard that appears to protect and does not is worse than no guard,
// so this version walks the whole repository and proves its own coverage first.

const ROOT = resolve(__dirname, '../..')

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'coverage', 'playwright-report', 'test-results', '.vercel',
])
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|pptx?|zip|mp4|lock)$/i

// Both guards import the list from one module rather than one parsing the
// other — Kostas's build-output check was reading this file with a regex,
// which is not what either of us wants permanent.
const { BURNED, ALLOWED_TO_NAME_THEM: ALLOWED } = burned

function allFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let s
      try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) walk(full)
      else if (!SKIP_EXT.test(entry) && s.size < 2_000_000) out.push(full)
    }
  }
  walk(ROOT)
  return out
}

describe('no committed credentials', () => {
  const files = allFiles()
  // Always `/`: the checks below compare against `/` paths, and
  // path.relative() gives `\` on Windows (the hook failed there, #166).
  const rel = files.map(f => repoRelative(ROOT, f))

  it('walks the whole repository, so a clean result means something', () => {
    // The previous version passed while missing three files, because its search
    // was scoped by directory and by extension. These pin the coverage itself,
    // which is the part that silently regressed.
    expect(rel.length).toBeGreaterThan(400)
    for (const dir of ['src', 'scripts', 'supabase/migrations', 'supabase/seeds', 'supabase/functions', 'docs']) {
      expect(rel.some(f => f.startsWith(dir + '/')), `nothing scanned under ${dir}/`).toBe(true)
    }
    for (const ext of ['.sql', '.md', '.html', '.mjs', '.tsx', '.json', '.yml']) {
      expect(rel.some(f => f.endsWith(ext)), `no ${ext} files scanned`).toBe(true)
    }
  })

  for (const secret of BURNED) {
    it(`${secret} appears only where it is meant to`, () => {
      const found = files
        .filter(f => readFileSync(f, 'utf8').includes(secret))
        .map(f => repoRelative(ROOT, f))
        .sort()
      const unexpected = found.filter(f => !ALLOWED.includes(f))
      expect(unexpected, `${secret} is in: ${unexpected.join(', ')}`).toEqual([])
    })
  }

  it('the allowlist is exactly the files that document the incident', () => {
    // If one of these stops naming the value, shrink the list rather than
    // leaving a permitted slot open for something else to fill.
    expect([...ALLOWED].sort()).toEqual([
      'docs/reviews/credential-boundary-2026-09-19.md',
      'scripts/burned-credentials.mjs',
      'src/__tests__/no-committed-credentials.test.ts',
    ])
  })

  it('no source file assigns a password literal', () => {
    const assignments: string[] = []
    for (const file of files) {
      const r = repoRelative(ROOT, file)
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(r)) continue
      // Test fixtures legitimately carry synthetic passwords; the burned-value
      // checks above still apply to them.
      if (/__tests__|\.test\.|\.spec\./.test(r)) continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?:password|PW|DEV_PASSWORD)\s*[:=]\s*(['"`])([^'"`]{6,})\1/gi)) {
        assignments.push(`${r}: ${m[2].slice(0, 4)}…`)
      }
    }
    expect(assignments, `literal password assignments: ${assignments.join(' | ')}`).toEqual([])
  })
})
