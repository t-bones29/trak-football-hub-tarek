#!/usr/bin/env node
// TRAK-24: the 25-player synthetic roster for the deployed rehearsal.
//
//   node scripts/rehearsal/make-roster.mjs --inbox you@gmail.com --out /tmp/trak24-roster.csv
//
// Writes a CSV for scripts/load-roster.mjs. 25 children in two age groups:
//   - 3 phone children who really sign up, at plus-addresses of --inbox:
//     two siblings (U15 and U17) who share one guardian, and one child whose
//     guardian will withhold consent;
//   - 22 children who never sign up, at @rehearsal.trak.dev (undeliverable
//     on purpose), each with a guardian at the same domain.
// Every child is under 18, so every one needs consent (G1).
//
// --inbox is a tester's own mailbox, used with plus-addressing
// (you+sib1@gmail.com). It is written only to --out, which must be outside
// the repository. Never commit the output or paste it into Slack or Linear;
// load-roster.mjs itself prints only row numbers and counts.
import { writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COACHES = { U15: 'coach.u15@rehearsal.trak.dev', U17: 'coach.u17@rehearsal.trak.dev' };
const SYNTH = 'rehearsal.trak.dev';

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

export function rows(inbox, today = new Date()) {
  if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(inbox)) throw new Error('--inbox must be a plain address like you@gmail.com (no +tag)');
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
      child_email: `roster.${n}@${SYNTH}`,
      guardian_emails: `parent.roster.${n}@${SYNTH}`,
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
  if (!args.inbox || !args.out) throw new Error('Usage: --inbox you@gmail.com --out /path/outside/the/repo.csv');
  const out = resolve(args.out);
  const rel = relative(process.cwd(), out);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('--out must be outside the repository: the file holds real inboxes');
  const list = rows(args.inbox);
  await writeFile(out, toCsv(list), { mode: 0o600 });
  console.log(`[make-roster] ${list.length} children written (3 phone children, 22 that never sign up). Keep the file out of the repo and chat.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`[make-roster] ${e.message}`); process.exitCode = 1; });
}
