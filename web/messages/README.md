# Message catalogs (web UI i18n — M3.9)

Localized UI-chrome strings for the four supported locales. **Document content is
never translated** (SPEC m3.9): only the chrome around it lives here.

```
messages/
  en-US/   ← authored source of truth
  es-US/   ← machine-seeded (native review gated before Launch)
  de-DE/   ← machine-seeded (native review gated before Launch)
  mn-MN/   ← founder-reviewed
```

## Layout: one file per surface, per locale

Each `<locale>/<surface>.json` file is one **namespace**. The namespace name is
the filename without `.json`. In code you read it with the namespace as the first
argument:

```ts
// Server Component
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('app-shell');
t('actions.import');

// Client Component
import { useTranslations } from 'next-intl';
const t = useTranslations('app-shell');
t('nav.documents');
```

The request config (`web/i18n/request.ts` → `lib/i18n/messages.ts`) **discovers
every namespace from the `en-US/` directory** and deep-merges each locale over its
en-US counterpart. Consequences:

- **Adding a surface = adding files, never editing a shared one.** Create
  `en-US/<surface>.json` (+ the other three locales) and it is picked up
  automatically. This is deliberate: the M3.9 surface tickets (#123 app chrome,
  #124 auth/shared/demo, #125 landing, #126 review) run in parallel and must not
  collide on a shared catalog. Keep filenames unique per surface — the top-level
  merge keys off the filename, so two surfaces sharing a filename would clobber
  each other.
- **en-US is authoritative.** It defines which namespaces and keys exist. A key
  present in en-US but missing from another locale renders the English string at
  runtime (deep-merge fallback, eng-review B1) and is flagged by the CI key-parity
  test (`test/i18n-catalog.test.ts`) and by dev-time missing-key logging.
- **Every key must exist in all four catalogs.** The parity test fails CI
  otherwise. Add a key to en-US and you owe it in es-US, de-DE, and mn-MN.

## Adding a locale

1. Add the tag to `SUPPORTED_LOCALES` in `lib/i18n/config.ts`.
2. Create `messages/<tag>/` with a translated copy of every namespace file.
3. Add a switcher label (endonym) in `components/language-switcher.tsx`.
4. If the display font (Space Grotesk) lacks the script, override
   `--font-display` for that `html[lang=…]` in `app/global.css` (see the mn-MN
   rule, eng-review 12A).

## Translator notes (`_notes`)

A namespace whose strings carry hard constraints declares them in a top-level
`_notes` object inside the catalog file itself — translator-facing prose, never
referenced by code. The convention (established by #123 for the chip glossary):

- `_notes` keys are ordinary catalog keys, so the parity test holds them to the
  same four-locale shape; keep the note text identical (English) across locales.
- `chips.json` is the constrained glossary (eng-review 13A): every label renders
  inside a small uppercase mono chip. **Budget: 15 characters max per label**;
  chips clamp at `16ch` with a truncation class as belt-and-braces, and the
  length lint (`test/i18n-chip-glossary.test.ts`) enforces the budget on de-DE.
  German stays deliberately short — OFFEN/PRÜFUNG style, never compound prose.

## Provenance

en-US is authored. es-US / de-DE are machine-seeded and **gated on native review
before Launch** (TODOS user action). mn-MN is founder-reviewed. Chip strings
(added by #123) carry translator-facing max-length notes — they are labels, not
prose (eng-review 13A).
