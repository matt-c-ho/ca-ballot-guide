# California Ballot Guide

A nonpartisan, plain-language guide to California ballot measures. For each measure it shows:

- what a Yes or No vote does
- the fiscal impact and its short- and long-term effects
- each side's arguments, in their own words
- the money behind each side
- linked measures that interact with each other

It covers statewide propositions and local measures, currently Santa Clara County and San José.

It is a static site: plain HTML, CSS, and JavaScript, with all content in JSON files under `data/`. There is no build step and nothing to install.

## Run it locally

The page loads its data with `fetch`, so it must be served over HTTP. Opening `index.html` directly from disk won't work.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works, for example `npx serve`.

## Deploy on Vercel

The site is hosted on Vercel, connected to the GitHub repository.

- Each push to `main` deploys to production. Each pull request gets its own preview URL.
- `vercel.json` runs `node scripts/validate.mjs` first, so a deploy fails if the data is invalid. It then copies only `index.html`, `assets/`, and `data/` into `dist/`, which is what gets served. README, scripts, and config files are not published. There is no install step.
- `vercel.json` also sets security headers (Content-Security-Policy and others). If you add a script, font, or image from a new domain, add that domain to the policy or the browser will block it.

To deploy by hand, run `npx vercel` for a preview or `npx vercel --prod` for production. To use a custom domain, add it in the Vercel project under **Settings → Domains**.

## Project layout

```
index.html                  page shell
assets/styles.css           design tokens (light + dark), components
assets/app.js               loads data, routing, rendering, notes
data/
  elections.json            list of elections + which one is the default
  glossary.json             key terms, shared across elections
  topics.json               topic ids → label and tagging rule (each has a color token in styles.css)
  2026-11-03/
    election.json           name, key dates, tabs (jurisdictions), money summary, sources
    measures-state.json     statewide propositions
    measures-santa-clara.json  local measures for Santa Clara County / San José
    groups.json             "linked measures" groups
    results.json            election results (empty until results are in)
scripts/validate.mjs        data checks (runs on every Vercel build)
vercel.json                 Vercel build settings and security headers
```

## Editing content

All content lives in `data/`, so you never need to touch `app.js` to update text.

- **Glossary links.** Write `[[term-key|text shown]]` in any text field, for example `[[go-bond|general obligation bonds]]`. Keys must exist in `data/glossary.json`.
- **HTML.** Group `body` fields and local `notOnBallot` and `note` fields accept simple HTML, such as tables and lists. All other text is shown as plain text.
- **Check your changes.** After editing, run `node scripts/validate.mjs`. It catches:
  - missing fields
  - unknown topics, groups, and glossary terms
  - duplicate ids
  - bad results entries

### Measure fields

| Field | Meaning |
|---|---|
| `id` | Short id shown in the tile: `"40"`, `"RTM"`, `"O"`. Must be unique within the election. |
| `label` | How it's referred to in text: `"Prop 40"`, `"Measure RTM"` |
| `title`, `short` | Plain-language name and one-line summary |
| `official` | Official ballot title |
| `origin` | `Legislature`, `Petition`, or `School board` |
| `type`, `threshold` | Measure type and the vote needed to pass |
| `area` | (local) Who votes on it |
| `topics` | Topic ids from `topics.json`. Give a measure **every** topic whose rule it meets (the rules are in `topics.json` and on the Method & sources page). List the main subject first; the first non-`local` topic sets the color. Cards show all topics. |
| `what`, `yes`, `no`, `yesNoSrc` | What it does, what each vote means, and where that wording comes from |
| `fiscal`, `short_term`, `long_term` | Impact |
| `supporters`, `opponents`, `pro`, `con`, `argSrc` | Listed supporters and opponents, and each side's argument. `argSrc: null` on a statewide measure means "official ballot argument." |
| `money` | `{ "yes": 32.3, "no": 99.15, "yesNote": "...", "noNote": "..." }` in millions of dollars, or `null` |
| `deep` | List of "Go deeper" bullet points |
| `faq` | (optional) "Common questions": `[{ "q": "...", "a": "...", "src": "LAO analysis" }]`. Answers are plain text with glossary links, factual, and name their source. No "should I vote" questions. |
| `reading` | (optional) "Further reading" links shown under Go deeper: `[{ "source": "CalMatters", "title": "Voter guide: Prop 1", "url": "https://..." }]`. Use nonpartisan news organizations and public agencies only, never campaign or endorsement pages. |
| `groups` | Ids of linked groups in `groups.json` |
| `sources` | Statewide: `guide`, `analysis`, `arguments`, `text` URLs. Local: `links: [[title, url], ...]` |

A group with `"legalConflict": true` marks its measures with a **Linked** tag on their cards.

## Adding a new election

1. Copy `data/2026-11-03/` to a new folder named after the election date, for example `data/2028-03-07/`.
2. Edit `election.json`:
   - name, dates, and lede
   - `jurisdictions` (each one becomes a tab and points to a measures file)
   - `money`
   - `sources`
3. Replace the measures files and `groups.json`. Reset `results.json` to `"status": "pending"` with empty `measures`.
4. Add the election to `data/elections.json`. Set `default` to it once it's ready.
5. Run `node scripts/validate.mjs`.

When `elections.json` lists more than one election, the site shows an election picker. Past elections stay available at `?election=<id>`.

## Adding results

Fill in `data/<election>/results.json`:

```json
{
  "status": "partial",
  "updated": "2026-11-04 9:00 PT",
  "source": "California Secretary of State, semi-official results",
  "sourceUrl": "https://electionresults.sos.ca.gov/",
  "measures": {
    "40": { "yes": 5123456, "no": 4987654, "yesPct": 50.7, "outcome": "leading", "final": false }
  }
}
```

`outcome` is one of `passed`, `failed`, `leading`, or `trailing`. Set it with the measure's threshold in mind: a school parcel tax needs two-thirds, so 60% yes is still `trailing`. When results exist, each measure card shows a status chip and each measure page gets a Results section. Fetching results automatically (for example, a scheduled GitHub Action that writes this file) is a planned future step.

## Editorial rules (neutrality)

- **Facts** come from the official ballot title and summary and the Legislative Analyst's Office (LAO) analysis. For local measures, they come from the county impartial analysis or named sources.
- **Arguments** are each side's own words, attributed to them. Give both sides the same treatment.
- **Context** (money, news background) always names its source.
- **Further reading** links go to nonpartisan news organizations (CalMatters, KQED, Local News Matters) and public agencies (Secretary of State). No campaign sites, endorsement guides, or polling. Give every measure in a jurisdiction the same set of sources where coverage exists.
- Every measure has the same sections in the same order. Yes and No are styled identically.
- No recommendations and no polling.

## My ballot

The **My ballot** tab lists every measure with the viewer's choice: Undecided, Yes, or No, plus N/A for district-dependent measures that are not on their ballot. These are the same leanings set on each measure page. An "I've cast my ballot" checkbox records the date it was checked; unchecked means no vote is assumed.

The page's wording follows the date (California time) and the checkbox:

| | Before polls close | After polls close (8 p.m. PT on Election Day) |
|---|---|---|
| Not marked as cast | "My ballot plan" | "My leanings" (not counted as votes; switches when polls close) |
| Marked as cast | "My votes" | "My votes" |

Results appear only after polls close (`pollsClose` in `election.json`, California time, default 8 p.m.), even if `results.json` already has entries; this keeps any pre-election test data off the site. After that, once `results.json` has entries, each measure shows its result and whether the viewer's side is ahead, behind, won, or lost, with a summary at the top. Choices and the checkbox are stored only in the browser.

## District-dependent measures

In `election.json`, a jurisdiction section with `"dependsOnAddress": true` (for example, school district measures) marks measures that are only on some voters' ballots. Those measures get an extra **N/A** choice in My notes, shown on cards as "Not on my ballot".

## Privacy

Leanings and notes are stored only in the visitor's own browser (`localStorage`). The site has no analytics and no server. Fonts load from Google Fonts.
