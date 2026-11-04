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
    committees.json         committee donors and giving (generated, do not edit)
scripts/validate.mjs        data checks (runs on every Vercel build)
scripts/build-committees.py generates committees.json from official sources
scripts/check-committees.py decides whether a new committees.json is safe to publish
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

### Fetching results

`python3 scripts/fetch-results.py` updates the statewide propositions from the Secretary of State feed (`https://api.sos.ca.gov/returns/ballot-measures`). It exits 0 when it updates, 3 when the report is unchanged, and 1 when it refuses. It refuses, leaving `results.json` as it was, if:

- the report is stamped before polls close (the feed serves test data before Election Day)
- any proposition is missing
- a percentage disagrees with its vote counts
- the report is older than the published one
- any proposition lost more than 1% of its votes

Outcomes are only `leading` or `trailing`, worked out from `passPct`. The feed's `/returns/status` endpoint was still serving 2024 test data on election night, so it is not used.

Two cloud routines run the fetcher and push to `main`: "CA Ballot Guide: results, election week" runs hourly at 5 past the hour on Nov 3–4, and "CA Ballot Guide: results, daily" runs at 6 p.m. Pacific from Nov 5 through Dec 11. Their environment must allow `api.sos.ca.gov`.

**Local measures (O, P, Q, R, RTM) are entered by hand.** The Santa Clara County Registrar blocks automated requests. RTM passes on the combined vote of five counties (Alameda, Contra Costa, San Francisco, San Mateo, Santa Clara), so enter it only from a combined official total or after summing all five counties' official results. For example:

```
python3 scripts/fetch-results.py --local O=41250,19870 --local P=40110,21020 \
  --source "Santa Clara County Registrar of Voters" --source-url https://... --as-of "Nov 4, 5:00 p.m. PT"
```

Later state refreshes keep these entries. After certification (counties by Dec 3, Secretary of State by Dec 11), change each `outcome` to `passed` or `failed` and set `final` to `true` by hand.

## Updating campaign money

Money figures come from the FPPC's [Top 10 Contributors](https://www.fppc.ca.gov/search-filings/top-10-contributors-list/november-2026-general-election/) page. Use its **Top Aggregated Contributions** table (support and oppose totals per measure) rather than adding up committees by hand, which double-counts money passed between committees. Check the page's "Last Modified" date; FPPC updates within about a day of new filings close to the election.

To refresh:

1. Update `money.yes`, `money.no`, `yesNote`, and `noNote` for each measure in `measures-state.json` (millions of dollars).
2. In `election.json`, update `money.asOf`, the totals in `money.intro`, `money.funders`, and `money.max` (the chart's scale) if the largest bar grows.
3. Update any dated figures elsewhere, such as the "largest single committee" bullet on Prop 42 and the Prop 38 funder bullet.

A daily cloud routine ("CA Ballot Guide: daily FPPC money refresh", 3am Pacific, through Nov 4, 2026) follows these steps automatically: it compares FPPC's "Last Modified" date with `money.asOf`, does nothing if they match, and otherwise updates the figures, runs the validator, and pushes to `main`. Manage it at claude.ai/code/routines. Its cloud environment must allow `www.fppc.ca.gov`, `github.com`, and `campaignfinance.cdn.sos.ca.gov`.

Props 41 and 42 have no separate opposing committee; the Yes on 40 campaign opposes them. The FPPC table lists that committee under all three measures. This guide counts it once, under Prop 40, and shows 41 and 42 with no opposing money.

## Committee detail

`data/<election>/committees.json` powers the committee pages (`#c-<id>`): who gave to each committee and what it gave to others. It comes only from official sources, and nothing in it is typed by hand:

```
python3 scripts/build-committees.py --cache /tmp/calaccess --report /tmp/committees-report.txt
```

The script reads the [FPPC list](https://www.fppc.ca.gov/search-filings/top-10-contributors-list/november-2026-general-election/) to find each measure's committees and any committee FPPC lists as giving them $1M or more. It then streams those committees' records from the Secretary of State's [CAL-ACCESS raw export](https://www.sos.ca.gov/campaign-lobbying/helpful-resources/raw-data-campaign-finance-and-lobbying-activity). Cached extracts are tied to the export's date and the committee list, so a stale cache can't be reused.

The daily routine refreshes this too, once its cloud environment allows `campaignfinance.cdn.sos.ca.gov`. It runs at 3am Pacific because the state updates the export a little after 1am. It only publishes if `scripts/check-committees.py` passes, comparing the new build with the published file and the build report. Otherwise it leaves the site as it was and reports why.

Rules it applies:

- **Latest version only.** Uses the highest amendment of each Form 460, counting from January 1, 2025, and adds Form 497 late reports dated after the last Form 460 period.
- **What counts as received.** Cash (Schedule A), stock and in-kind gifts (Schedule C), and loans still owed (Schedule B). Memo rows are skipped because filers do not count them in totals. Gifts under $100 are only reported as a lump sum, so they appear as their own line.
- **What counts as given.** Schedule D contributions. Where Schedule D leaves the recipient blank, the same `TRAN_ID` on Schedule E names it. Otherwise the page says the recipient is not named.
- **Reconciliation.** A committee is left out unless its itemized rows match its own filed schedule totals, within 0.5% or $1,000.
- **IDs.** Older committees file under legacy IDs, which `FILER_XREF_CD` maps to their public IDs. Cal-Access links use public IDs.
- **Privacy.** Publishes names and amounts only, never addresses, employers, or occupations. `validate.mjs` enforces this.

When running by hand, also run the checker and read the `--report` file. FPPC differences are normal but not always harmless. The export can be newer than FPPC, FPPC combines affiliated donors (Homeownership for Families and California Association of Realtors, for example), and FPPC's page can contain typos ("$2,000,0000" for the Graton Rancheria tribal council). The checker stops on any donor more than 1% below FPPC unless its `KNOWN_LOWER` list holds a reason traced by hand. A few small gaps remain unexplained, such as about 0.1–0.2% on in-kind gifts to Yes on 40.

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

### Keeping a copy

The **Keep a copy** panel on My ballot builds files on the viewer's device (nothing is uploaded):

- **Download spreadsheet (CSV):** one row per measure with the viewer's choice, note, and (after polls close) the result. Text that a spreadsheet could run as a formula is made literal.
- **Download backup (JSON):** `{ app: "ca-ballot-guide", version: 1, election, exportedAt, ballot, choices }`.
- **Restore from backup:** reads that JSON, asks before replacing what's saved, and keeps only known measures, valid choices (N/A only where `dependsOnAddress` applies), and notes as plain text. Backups from a different election are refused.
- **Print or save as PDF:** a print stylesheet hides the header, tabs, and buttons and prints each choice as text.

## District-dependent measures

In `election.json`, a jurisdiction section with `"dependsOnAddress": true` (for example, school district measures) marks measures that are only on some voters' ballots. Those measures get an extra **N/A** choice in My notes, shown on cards as "Not on my ballot".

## Privacy

Leanings and notes are stored only in the visitor's own browser (`localStorage`). The site has no analytics and no server. Fonts load from Google Fonts.
