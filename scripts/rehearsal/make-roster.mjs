#!/usr/bin/env node
// TRAK-24: the 25-player synthetic roster for the deployed rehearsal.
//
//   node scripts/rehearsal/make-roster.mjs --inbox you@gmail.com --out /tmp/trak24-roster.csv
//     [--phone-out /tmp/trak24-phones.csv] [--synthetic-domain rehearsal.trak.test]
//
// With --phone-out, the 3 phone families go to that file and the 22 synthetic
// children to --out, so only the phone families are loaded with
// load-roster.mjs --send-invites (it invites every row in a file, and the
// synthetic guardians are undeliverable).
//
// Writes a CSV for scripts/load-roster.mjs. 25 children in two age groups:
//   - 3 phone children who really sign up, at plus-addresses of --inbox:
//     two siblings (U15 and U17) who share one guardian, and one child whose
//     guardian will withhold consent;
//   - 22 children who never sign up, at @rehearsal.trak.test (a reserved .test
//     domain: nobody can register it or receive mail there), each with a
//     guardian at the same domain. The coaches are at that domain too.
// TRAK-89: never trak.dev, which belongs to someone else.
// Every child is under 18, so every one needs consent (G1).
//
// --inbox is a tester's own mailbox, used with plus-addressing
// (you+sib1@gmail.com). It is written only to --out, which must be outside
// the repository. Never commit the output or paste it into Slack or Linear;
// load-roster.mjs itself prints only row numbers and counts.
import { writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The repository root, from this file's own location: scripts/rehearsal/.
// Not the current folder, which is wherever the script happens to be run
// from (Kostas, #169: `cd scripts && … --out ../x.csv` got past a cwd check).
// Worked out when the command runs (a file: URL there), not at import.
const repoRoot = () => fileURLToPath(new URL('../..', import.meta.url));

/** True when `file` is the repository root or anywhere under it. */
export function insideRepo(file, root = repoRoot()) {
  const rel = relative(root, resolve(file));
  return rel === '' || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel));
}

export const SYNTHETIC_DOMAIN = 'rehearsal.trak.test';

/** A domain J7's pilot_synthetic_user_ids() counts as synthetic (reserved
    test domains, RFC 2606/6761), so rehearsal accounts never enter the pilot
    numbers. trak.dev is deliberately not accepted (TRAK-89). */
export function isSyntheticDomain(domain) {
  const d = String(domain).trim().toLowerCase();
  return ['example.com', 'example.org', 'example.net'].includes(d)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(example|test|invalid|localhost)$/.test(d);
}

const coaches = (domain) => ({ U15: `coach.u15@${domain}`, U17: `coach.u17@${domain}` });
export const COACHES = coaches(SYNTHETIC_DOMAIN);

const plus = (inbox, tag) => {
  const [local, domain] = inbox.split('@');
  return `${local}+${tag}@${domain}`;
};

// Born `years` years and a few months before `today`, so the age is stable
// for the whole pilot (8 weeks) and never crosses a birthday into 18.
export function dob(today, years, monthsAgo) {
  const d = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth() - monthsAgo, 10));
  return d.toISOString().slice(0, 10);
}

export function rows(inbox, today = new Date(), domain = SYNTHETIC_DOMAIN) {
  if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(inbox)) throw new Error('--inbox must be a plain address like you@gmail.com (no +tag)');
  if (!isSyntheticDomain(domain)) throw new Error(`--synthetic-domain must be a reserved test domain J7 counts as synthetic (e.g. ${SYNTHETIC_DOMAIN})`);
  const COACHES = coaches(domain);
  const out = [
    // The sibling family (J2 with siblings, G3 sibling isolation): one guardian, two children.
    { child_name: 'Synthetic Sibling One', date_of_birth: dob(today, 14, 3), age_group: 'U15',
      child_email: plus(inbox, 'sib1'), guardian_emails: plus(inbox, 'guardian-a'), coach_email: COACHES.U15 },
    { child_name: 'Synthetic Sibling Two', date_of_birth: dob(today, 16, 2), age_group: 'U17',
      child_email: plus(inbox, 'sib2'), guardian_emails: plus(inbox, 'guardian-a'), coach_email: COACHES.U17 },
    // The withheld-consent child (G1: nothing recorded without consent).
    { child_name: 'Synthetic Withheld', date_of_birth: dob(today, 14, 5), age_group: 'U15',
      child_email: plus(inbox, 'withheld'), guardian_emails: plus(inbox, 'guardian-b'), coach_email: COACHES.U15 },
  ];
  for (let i = 1; i <= 22; i++) {
    const n = String(i).padStart(2, '0');
    const group = i <= 11 ? 'U15' : 'U17';
    out.push({
      child_name: `Synthetic Roster ${n}`,
      date_of_birth: dob(today, group === 'U15' ? 14 : 16, i % 11),
      age_group: group,
      child_email: `roster.${n}@${domain}`,
      guardian_emails: `parent.roster.${n}@${domain}`,
      coach_email: COACHES[group],
    });
  }
  return out;
}

const COLUMNS = ['child_name', 'date_of_birth', 'age_group', 'child_email', 'guardian_emails', 'coach_email'];
const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
export const toCsv = (list) => [COLUMNS.join(','), ...list.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\n') + '\n';

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) =>
    (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.inbox || !args.out) throw new Error('Usage: --inbox you@gmail.com --out /path/outside/the/repo.csv [--phone-out /other/path.csv]');
  const out = resolve(args.out);
  const phoneOut = args['phone-out'] ? resolve(args['phone-out']) : null;
  // Check every destination before writing any, so a refusal writes nothing.
  for (const file of [out, phoneOut].filter(Boolean)) {
    if (insideRepo(file)) throw new Error('--out and --phone-out must be outside the repository: the files hold real inboxes');
  }
  if (phoneOut && phoneOut === out) throw new Error('--phone-out must be a different file from --out');
  const list = rows(args.inbox, new Date(), args['synthetic-domain'] ?? SYNTHETIC_DOMAIN);
  if (phoneOut) {
    const phones = list.slice(0, 3);
    await writeFile(phoneOut, toCsv(phones), { mode: 0o600 });
    await writeFile(out, toCsv(list.slice(3)), { mode: 0o600 });
    console.log(`[make-roster] ${phones.length} phone families written to --phone-out (load these with --send-invites), ${list.length - phones.length} synthetic children to --out (load without). Keep both files out of the repo and chat.`);
    return;
  }
  await writeFile(out, toCsv(list), { mode: 0o600 });
  console.log(`[make-roster] ${list.length} children written (3 phone children, 22 that never sign up). Keep the file out of the repo and chat.`);
}

// Only when run as a command; importing it (tests, node -e) has no argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`[make-roster] ${e.message}`); process.exitCode = 1; });
}
