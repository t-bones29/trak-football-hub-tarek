# Trak kit templates

Reusable blank, front-facing shirt, shorts and socks for J8 event announcements
and the shared event sheet. TRAK-203 connects the templates to the coach's
event form, saved squad sets and shared coach/parent/player announcements.
Deployment still follows the repository's migration and independent review gate.

## Included

- 36 transparent SVGs: 12 colour collections, each with home, away and alternate.
- Six neutral templates: plain, stripes, hoops, sash, halves and chest band.
- 24 named colours and arbitrary six-digit hex colours. Shirt, pattern, trim,
  shorts and socks can be changed independently for each kit.
- No crests, sponsors, player names or numbers. The artwork is drawn as vector
  paths; the reference image is not embedded or distributed.
- A short, one-time reveal of shirt, shorts and socks. Reduced motion shows the
  full kit immediately. The SVG background is transparent.

The saved files live in `public/kits/`. `catalog.json` contains the complete
versioned designs and their asset paths. Generated SVGs come from the same
renderer used in React; edit the source and regenerate instead of editing SVGs.
Use SVGs as separate image resources, not pasted together into the same DOM;
use `KitIllustration` for inline rendering with unique clipping/gradient IDs.

## Preview and export

Use the repository's Node 22 and npm version, then run:

```sh
npm run dev -- --host 127.0.0.1 --port 8086
# Open http://127.0.0.1:8086/kit-preview.html
```

The preview lets you choose a kit, change its colours/style, apply a complete
collection, download an animated SVG, or export all three designs as JSON.
The announcement opens in the existing Vaul drawer. Coach, parent and player
views all receive the same selected kit. Its event, venue and note are synthetic.
Edits exist only in memory: export the JSON to keep them before reloading.
The standalone HTML entry is not referenced by `src/App.tsx` and is not included
in the normal production build. The public SVG library is copied by Vite.

Regenerate the saved SVGs and catalog:

```sh
node scripts/export-kit-templates.mjs
```

## Use in Trak

`src/lib/kit-templates.ts` defines the catalog and Zod schemas. Validate JSON
read from storage with `teamKitSetSchema.parse()` before passing it to the UI.
Use `copyKitSet()` before editing catalog entries.

```tsx
import { KIT_COLLECTIONS, copyKitSet, type KitSlot } from '@/lib/kit-templates'
import { KitPicker } from '@/components/trak/kits/KitPicker'
import { KitAnnouncement } from '@/components/trak/kits/KitAnnouncement'

const [kits, setKits] = useState(() => copyKitSet(KIT_COLLECTIONS[0].kits))
const [slot, setSlot] = useState<KitSlot>('home')

// In the coach's event form; the parent owns saving.
<KitPicker kits={kits} value={slot} onChange={setSlot} />

// Within the shared event sheet; all audiences receive the same saved design.
<KitAnnouncement kit={kits[slot]} slot={slot} />
```

`KitIllustration` also works alone, accepts a readable `label`, and has optional
`animated` and `decorative` props. `KitAnnouncement` includes written garment
colours and an accessible description of pattern and trim. Without a kit/slot,
it shows “Kit to be confirmed by the coach” and does not invent a kit.

In Coach Schedule, open Add event (or Edit), then For families. Set up or edit
the squad's three kits, save the set, and choose one for the event. The event
Review shows that exact design. Saving templates alone does not select a kit.
Use text instructions instead for bibs or other clothing; extra instructions
belong in Message to players. Match venue and kit choice are independent.

`coach_team_kits` stores a versioned set per academy, coach and roster squad;
an empty squad key means the whole roster, matching a null event squad. RLS
requires the owning coach, current academy and active events switch. Parents
and players cannot browse team templates. `kit_snapshot` on the event stores
the chosen slot and validated design. Editing templates never changes it;
reselecting a kit while editing an event replaces it explicitly. The existing
event sequence tracks that edit. The legacy `kit` column receives a readable
description for calendar and sharing paths, or the coach's free text when no
visual is selected. Existing email-notice trigger rules are unchanged.
If an older client changes the text instruction without replacing the design,
the database clears the old illustration so the announcement shows the new text.

The `child_events` RPC returns the snapshot under its existing publication,
relationship, academy, squad and consent checks. Both full family event pages
and the shared bottom sheet display it. Existing text-only events still work;
malformed/unknown snapshots fall back to the text. No external images or
private notes are accepted in the kit JSON. The migration must deploy before
the frontend; a missing migration causes a visible retryable save/load error.

## Checks

```sh
npm exec vitest -- run src/lib/__tests__/kit-templates.test.ts src/components/trak/kits/KitTemplates.test.tsx
node scripts/check-kit-preview.mjs  # Vite must already be running on port 8086
node scripts/test-db.mjs --team-kits-review
npm run build
```

The browser check uses Chromium and saves screenshots in `test-results/kits/`.
Override `KIT_PREVIEW_URL` or `KIT_PREVIEW_OUTPUT` if needed. It exercises all
six styles, 12 collections, 36 asset URLs, independent edits, JSON/SVG exports,
keyboard selection, all three audience views, Escape/focus return, reduced
motion and overflow at 320, 390 and 768 px. These are local browser checks,
not physical-phone or production evidence. Full release checks and the
repository's independent approval gate still apply before integration ships.
