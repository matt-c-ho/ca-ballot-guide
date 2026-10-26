# California Ballot Guide

A nonpartisan, plain-language guide to California ballot measures. For each measure it shows:

- what a Yes or No vote does
- the fiscal impact and its short- and long-term effects
- each side's arguments, in their own words
- the money behind each side
- linked measures that interact with each other

It covers statewide propositions and local measures, currently Santa Clara County and San José.

It is a static site: plain HTML, CSS, and JavaScript, with all content in JSON files under `data/`. There is nothing to install and nothing to build locally. (On Vercel, a small build step validates the data and copies the site files; see below.)

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

`main` is protected by a GitHub ruleset that blocks force-pushes and branch deletion, so never rewrite its history. Work on a branch, check its Vercel preview, then fast-forward `main`.

## Project layout

```
index.html                  page shell
assets/styles.css           design tokens (light + dark), components
assets/app.js               loads data, routing, rendering, notes, My ballot, header carousel
assets/favicon.svg          ballot-box icon (+ favicon-32.png, apple-touch-icon.png)
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
  - missing fields (including `passPct`)
  - unknown topics, groups, and glossary terms; topics without a label and rule
  - duplicate ids
  - malformed `faq` and `reading` entries
  - `keyDates` dates that aren't `YYYY-MM-DD` and a `pollsClose` that isn't `HH:MM`
  - summaries (`ledeShort`, `summary`, `money.summary`) longer than 50 characters
  - bad results entries

### Measure fields

| Field | Meaning |
|---|---|
| `id` | Short id shown in the tile: `"40"`, `"RTM"`, `"O"`. Must be unique within the election. |
| `label` | How it's referred to in text: `"Prop 40"`, `"Measure RTM"` |
| `title`, `short` | Plain-language name and one-line summary |
| `official` | Official ballot title |
| `origin` | `Legislature`, `Petition`, or `School board` |
| `type`, `threshold`, `passPct` | Measure type, the vote needed to pass in words, and as a number (`50`, `55`, `66.67`) for the results chart |
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
   - `name`, `date`, `pollsClose` (California time, e.g. `"20:00"`), `eyebrow`
   - `lede` (full) and `ledeShort` (one line, 50 characters max)
   - `keyDates`: `{ "date": "YYYY-MM-DD", "label": "NOV 3", "text": "..." }`
   - `jurisdictions` (each one becomes a tab and points to a measures file), each with a one-line `summary` and full `intro`. Mark sections whose measures aren't on every ballot with `"dependsOnAddress": true`.
   - `money` (`asOf`, `summary`, `intro`, `funders`, `max`)
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

`outcome` is one of `passed`, `failed`, `leading`, or `trailing`. Set it with the measure's `passPct` in mind: a school parcel tax needs two-thirds, so 60% yes is still `trailing`. Use `leading`/`trailing` while counting continues and switch to `passed`/`failed` only once results are certified (counties certify within 30 days, by Dec 3, 2026; the Secretary of State by Dec 11, 2026). `noPct` is optional; it defaults to `100 - yesPct`.

When results exist and polls have closed, each card shows a status chip, each measure page gets a Results chart (labeled Yes and No bars with a tick at the share needed to pass), and My ballot compares them with the viewer's choices.

### Planned: fetching results automatically

Not built yet; the `my-ballot` branch is kept for this work. Research so far:

- **State propositions:** the Secretary of State publishes JSON at `https://api.sos.ca.gov/returns/ballot-measures` (yes/no votes and percentages per proposition) and county reporting status at `/returns/status`. **Before Election Day this feed serves test data** (in October 2026 every proposition showed about 80% yes and 100% reporting), so a fetcher must never publish before polls close. The site's polls-close gate is a second safeguard.
- **Local measures (O, P, Q, R and Santa Clara's share of RTM):** published by the Santa Clara County Registrar. Its site blocks automated requests and the export format is unconfirmed, so these may need to be entered by hand.
- **RTM** passes on the combined vote of five counties (Alameda, Contra Costa, San Francisco, San Mateo, Santa Clara). There is no single official combined total; it has to be summed from the county results.
- Proposed approach: a script that writes `results.json` (manual first), then optionally a scheduled GitHub Action that commits it. Pushing workflow files needs the `workflow` scope on the GitHub login (`gh auth refresh -s workflow`).

## Updating campaign money

Money figures come from the FPPC's [Top 10 Contributors](https://www.fppc.ca.gov/search-filings/top-10-contributors-list/november-2026-general-election/) page. Use its **Top Aggregated Contributions** table (support and oppose totals per measure) rather than adding up committees by hand, which double-counts money passed between committees. Check the page's "Last Modified" date; FPPC updates within about a day of new filings close to the election.

To refresh:

1. Update `money.yes`, `money.no`, `yesNote`, and `noNote` for each measure in `measures-state.json` (millions of dollars).
2. In `election.json`, update `money.asOf`, the totals in `money.intro`, `money.funders`, and `money.max` (the chart's scale) if the largest bar grows.
3. Update any dated figures elsewhere, such as the "largest single committee" bullet on Prop 42 and the Prop 38 funder bullet.

Props 41 and 42 have no separate opposing committee; the Yes on 40 campaign opposes them. The FPPC table lists that committee under all three measures. This guide counts it once, under Prop 40, and shows 41 and 42 with no opposing money.

## Design

- **Fonts:** Newsreader (title and headings), Public Sans (body), IBM Plex Mono (chart numbers), all from Google Fonts. Change them with `--f-display`, `--f-body`, and `--f-mono` at the top of `styles.css`.
- **Colors:** light and dark tokens at the top of `styles.css`; topic colors are `--c-<topic>`.
- **Phones first:** intros are one line, headings are sized so most fit one line, and topic filters scroll sideways in one row. Topic filters can be combined; a measure shows if it has any selected topic.

## Editorial rules (neutrality)

- **Facts** come from the official ballot title and summary and the Legislative Analyst's Office (LAO) analysis. For local measures, they come from the county impartial analysis or named sources.
- **Arguments** are each side's own words, attributed to them. Give both sides the same treatment.
- **Context** (money, news background) always names its source.
- **Further reading** links go to nonpartisan news organizations (CalMatters, KQED, Local News Matters) and public agencies (Secretary of State). No campaign sites, endorsement guides, or polling. Give every measure in a jurisdiction the same set of sources where coverage exists.
- Every measure has the same sections in the same order. Yes and No are styled identically in every explanation of a measure. The only exception is reported results and the viewer's own choices on My ballot, which use fixed Yes/No colors (`--yes`, `--no` in `styles.css`: green/red in light mode, blue/gray in dark mode, checked for color-blind separation) and always carry a text label or icon.
- No recommendations and no polling.

## Header carousel

The header shows one card at a time and rolls to the next every 15 seconds. The first card is the viewer's **next step**, worked out from My ballot (how many measures are decided, whether the ballot is marked cast, Election Day, and whether results are in). It links to My ballot and only ever suggests logistics, never how to vote. The rest are the upcoming `keyDates` from `election.json`; past dates drop off.

## Short intros

Each page leads with a one-line `summary` (and the header with `ledeShort`), with an (i) button that expands the full `intro` / `lede` in place. Keep summaries to 50 characters so they fit one line on a phone; the validator enforces this.

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
