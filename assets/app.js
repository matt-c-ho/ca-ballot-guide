/*
 * California Ballot Guide — app
 * All content lives in /data. This file only loads and renders it.
 * Routes (URL hash):  #<jurisdiction-id>  #m-<measure-id>  #linked  #g-<group-id>  #money  #glossary  #about
 * Election is chosen with ?election=<id> (defaults to data/elections.json "default").
 */

const DATA = "data";
const $ = (id) => document.getElementById(id);
const $view = $("view");

const S = {
  index: null, election: null, measures: [], byId: {}, groups: {},
  glossary: {}, topics: {}, results: null, filter: new Set(), mine: {}  // filter: selected topic ids; empty = All
};

/* ---------- Loading ---------- */
async function getJSON(path, optional = false) {
  const r = await fetch(`${DATA}/${path}`, { cache: "no-cache" });
  if (!r.ok) { if (optional) return null; throw new Error(`Could not load ${path} (${r.status})`); }
  return r.json();
}

async function load() {
  S.index = await getJSON("elections.json");
  const want = new URLSearchParams(location.search).get("election");
  const id = S.index.elections.some(e => e.id === want) ? want : S.index.default;
  const [election, glossary, topics, groups, results] = await Promise.all([
    getJSON(`${id}/election.json`), getJSON("glossary.json"), getJSON("topics.json"),
    getJSON(`${id}/groups.json`, true), getJSON(`${id}/results.json`, true)
  ]);
  Object.assign(S, { election, glossary, topics, groups: Object.assign(Object.create(null), groups), results });
  const lists = await Promise.all(election.jurisdictions.map(j => getJSON(`${id}/${j.file}`)));
  S.measures = [];
  election.jurisdictions.forEach((j, i) => lists[i].forEach(m => S.measures.push({ ...m, _j: j.id })));
  S.byId = Object.assign(Object.create(null), Object.fromEntries(S.measures.map(m => [m.id, m])));
  S.mine = store.get();
}

/* ---------- Per-viewer notes (localStorage) ---------- */
const store = {
  key: () => `ballot-guide:${S.election?.id}`,
  get() { try { return JSON.parse(localStorage.getItem(this.key()) || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem(this.key(), JSON.stringify(v)); } catch {} }
};
// Whether the viewer has cast their ballot: { voted: true, on: "YYYY-MM-DD" }. Also local only.
const ballotStore = {
  key: () => `ballot-guide:${S.election?.id}:status`,
  get() { try { return JSON.parse(localStorage.getItem(this.key()) || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem(this.key(), JSON.stringify(v)); } catch {} }
};
// N/A is offered only for measures that are not on every ballot (see dependsOnAddress).
const leansFor = m => ["Undecided", "Yes", "No", ...(dependsOnAddress(m) ? ["N/A"] : [])];
// Icons for the My ballot choice grid (adapted from Lucide, ISC license).
const ICON = {
  "Undecided": '<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "Yes": '<path d="M20 6 9 17l-5-5"/>',
  "No": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "N/A": '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>'
};
const icon = k => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const CHOICES = ["Undecided", "Yes", "No", "N/A"];
const choiceName = { "Undecided": "Undecided", "Yes": "Yes", "No": "No", "N/A": "Not on my ballot" };

/* ---------- Helpers ---------- */
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// [[term-key|label]] in data becomes a glossary button. Data may also contain simple trusted HTML.
const rich = (t) => String(t ?? "").replace(/\[\[([\w-]+)\|([^\]]+)\]\]/g,
  (_, k, l) => S.glossary[k] ? `<button class="term" data-term="${k}">${l}</button>` : l);
const T = (k, l) => rich(`[[${k}|${l}]]`);
// A one-line summary with an (i) button that expands the full explanation in place,
// so intros don't push the content people came for below the fold on phones.
let infoSeq = 0;
const intro = (short, full) => {
  if (!full) return `<p class="muted one">${short}</p>`;
  const id = `more-${++infoSeq}`;
  return `<div class="intro"><p class="muted one">${short}&nbsp;<button class="info" type="button" aria-expanded="false" aria-controls="${id}" aria-label="More about this">i</button></p>
    <div class="more muted" id="${id}" hidden>${full}</div></div>`;
};
const fmt = v => v >= 1 ? `$${v.toFixed(v % 1 ? 1 : 0)}M` : "under $1M";
const topicOf = m => m.topics.find(t => t !== "local") || "local";
const tcol = m => `--tc:var(--c-${topicOf(m)})`;
const topicLabel = k => S.topics[k]?.label || "";
// Topics shown on a card: all of them, main topic first. "Local government" is
// left off cards on the local tabs, where every measure has it.
const cardTopics = m => m.topics.filter(t => S.topics[t] && !(t === "local" && m._j !== S.election.jurisdictions[0].id));
const isLinkedTax = m => (m.groups || []).some(g => S.groups[g]?.legalConflict);
const jur = id => S.election.jurisdictions.find(j => j.id === id);
const originLabel = o => o === "Legislature" ? "the Legislature" : o === "School board" ? "the school board" : "petition signatures";

// Results are shown only after polls close (election.pollsClose, California time),
// whatever results.json contains. This also keeps any pre-election test data off the site.
const caNow = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }).format(new Date());
const pollsClosed = () => !!S.election.date && caNow() >= `${S.election.date} ${S.election.pollsClose || "20:00"}`;
const resultFor = id => pollsClosed() ? S.results?.measures?.[id] : undefined;

function resultChip(id) {
  const r = resultFor(id);
  if (!r) return "";
  const word = { passed: "Passed", failed: "Failed", leading: "Leading", trailing: "Trailing" }[r.outcome] || "";
  const cls = r.outcome === "passed" || r.outcome === "leading" ? "pass" : "fail";
  const need = S.byId[id]?.passPct || 50;
  return `<span class="result ${cls}">${word}${r.yesPct != null ? ` · ${r.yesPct}% yes` : ""}${need !== 50 ? ` · needs ${need > 66 ? "66.7" : need}%` : ""}${r.final ? "" : " · counting"}</span>`;
}
const leanChip = id => { const l = (S.mine[id] || {}).lean; return l ? `<span class="lean">${l === "N/A" ? "Not on my ballot" : `My lean: ${esc(l)}`}</span>` : ""; };
// Measures in a section marked dependsOnAddress (e.g. school district measures) may not be on everyone's ballot.
const dependsOnAddress = m => (jur(m._j)?.sections || []).some(sec => sec.dependsOnAddress && sec.measures.includes(m.id));

function card(m) {
  const big = m.id.length > 2;
  return `<button class="card" data-open="${m.id}" style="${tcol(m)}">
    <span class="pnum num"${big ? ' style="font-size:1.15rem"' : ""}>${esc(m.id)}</span>
    <span class="t">${esc(m.title)}</span>
    <span class="s">${esc(m.short)}</span>
    <span class="meta">${cardTopics(m).map(t => `<span class="tag topic${S.filter.has(t) ? " on" : ""}" style="--tc:var(--c-${t})">${esc(topicLabel(t))}</span>`).join("")}<span class="tag">${esc(m.origin)}</span>${isLinkedTax(m) ? '<span class="tag link">Linked</span>' : ""}${resultChip(m.id)}${leanChip(m.id)}</span>
  </button>`;
}

/* ---------- Views ---------- */
function jurisdictionView(j) {
  const list = S.measures.filter(m => m._j === j.id);
  const sectioned = !!j.sections;
  const topicsHere = [...new Set(list.flatMap(m => m.topics))].filter(t => S.topics[t]);
  const chips = sectioned ? "" : `<div class="filters" role="group" aria-label="Filter by topic">
    <button class="chip" aria-pressed="${!S.filter.size}" data-filter="all">All</button>
    ${topicsHere.map(k => `<button class="chip" aria-pressed="${S.filter.has(k)}" data-filter="${k}" style="--tc:var(--c-${k})">${esc(topicLabel(k))}</button>`).join("")}</div>`;
  // Several topics can be on at once; a measure shows if it has any of them.
  const shown = list.filter(m => !S.filter.size || m.topics.some(t => S.filter.has(t)));
  const decided = list.filter(m => (S.mine[m.id] || {}).lean).length;
  $view.innerHTML = `
    <section style="display:grid;gap:10px">
      ${j.eyebrow ? `<span class="eyebrow">${esc(j.eyebrow)}</span>` : ""}
      <h2>${esc(j.title)}</h2>
      ${intro(j.summary ? rich(j.summary) : rich(j.intro), j.summary ? `<p>${rich(j.intro)}</p>${sectioned ? "" : `<p>You've noted a leaning on ${decided} of ${list.length}. Leanings stay in this browser only.</p>`}` : "")}
    </section>
    ${j.notOnBallot ? `<details class="section deep fold"><summary>What's not on the ballot</summary><div class="prose small">${j.notOnBallot.map(p => `<p>${p}</p>`).join("")}</div></details>` : ""}
    ${chips}
    ${sectioned
      ? j.sections.map(sec => `<div style="display:grid;gap:10px"><span class="eyebrow">${esc(sec.title)}</span>
          <div class="grid">${sec.measures.map(id => S.byId[id]).filter(Boolean).map(card).join("")}</div>
          ${sec.note ? `<p class="small muted">${sec.note}</p>` : ""}</div>`).join("")
      : `${S.filter.size ? `<p class="small muted" aria-live="polite">Showing ${shown.length} of ${list.length} · matching any selected topic</p>` : ""}<div class="grid">${shown.map(card).join("")}</div>`}
    ${j.groups ? `<section class="section"><h3>Read together</h3><div class="plinks">${j.groups.filter(g => S.groups[g]).map(g => `<button data-group="${g}">${esc(S.groups[g].title)} →</button>`).join("")}</div></section>` : ""}`;
  // On phones the filters are one swipeable row; re-rendering resets it, so put it
  // back where the viewer left it when they tapped a chip.
  const row = $view.querySelector(".filters");
  if (row && S.filterScroll) { row.scrollLeft = S.filterScroll; S.filterScroll = 0; }
  if (row) {
    const edge = () => row.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 2);
    row.addEventListener("scroll", edge, { passive: true }); edge();
  }
}

function arg(text, side, m) {
  if (!text) return m.argSrc === null && m._j !== "ca"
    ? `<blockquote class="muted">Not compiled yet. The official arguments are printed in your county voter information guide.</blockquote>`
    : `<blockquote class="muted">No argument ${side === "pro" ? "in favor" : "against"} was submitted for the official guide.</blockquote>`;
  const cite = m.argSrc || `Official ballot argument ${side === "pro" ? "in favor" : "against"}, ${m.label} (summary as printed)`;
  return `<blockquote>${esc(text)}<cite>${esc(cite)}</cite></blockquote>`;
}

// Share of the yes vote a measure needs, as words for captions and labels.
const passWords = pct => pct > 66 ? "two-thirds (66.7%) yes" : pct === 50 ? "more than 50% yes" : `${pct}% yes`;

// Results as a two-bar chart: Yes and No on one 0–100% scale, each labeled with its
// share and vote count (--yes / --no colors; the labels, not the colors, carry the
// meaning). A tick on the Yes bar marks the share needed to pass.
function resultsSection(m) {
  const r = resultFor(m.id);
  if (!r) return "";
  const yes = r.yesPct ?? 0, no = r.noPct ?? Math.round((100 - yes) * 10) / 10, need = m.passPct || 50;
  const count = v => v != null ? `<span class="muted">${v.toLocaleString()}</span>` : "";
  const bar = (k, pct, votes, tick) => `<div class="rrow">
      <span class="rk">${k}</span>
      <span class="rtrack"><span class="rfill${k === "No" ? " no" : ""}" style="width:${pct}%"></span>${tick ? `<span class="rneed" style="left:${need}%"></span>` : ""}</span>
      <span class="rv"><b>${pct}%</b> ${count(votes)}</span></div>`;
  return `<section class="section"><h3>Results</h3>
    <div>${resultChip(m.id)}</div>
    <div class="rchart" role="img" aria-label="Yes ${yes}%${r.yes != null ? ` (${r.yes.toLocaleString()} votes)` : ""}, No ${no}%${r.no != null ? ` (${r.no.toLocaleString()} votes)` : ""}. Needs ${passWords(need)} to pass.">
      ${bar("Yes", yes, r.yes, true)}
      ${bar("No", no, r.no, false)}
    </div>
    <p class="small muted"><span class="rneed-key" aria-hidden="true"></span>Needs ${passWords(need)} to pass.</p>
    <p class="src">${esc(S.results.source || "")}${S.results.updated ? ` · updated ${esc(S.results.updated)}` : ""}${S.results.sourceUrl ? ` · <a href="${S.results.sourceUrl}" target="_blank" rel="noopener">official results</a>` : ""}</p>
  </section>`;
}

function detail(id) {
  const m = S.byId[id];
  if (!m) return jurisdictionView(S.election.jurisdictions[0]);
  const j = jur(m._j);
  const n = S.mine[id] || {};
  const mo = m.money;
  const src = m.sources || {};
  const readLinks = src.analysis
    ? `<a href="${src.analysis}" target="_blank" rel="noopener">LAO analysis</a> · <a href="${src.text}" target="_blank" rel="noopener">Full text (PDF)</a>`
    : (src.links || []).length ? src.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")
    : "your county voter information guide";
  const local = m._j !== "ca";
  $view.innerHTML = `
   <button class="back" data-view="${j.id}">← ${esc(j.tab)}</button>
   <div class="dhead" style="${tcol(m)}">
    <span class="pnum num"${m.id.length > 2 ? ' style="font-size:1.6rem"' : ""}>${esc(m.id)}</span>
    <div class="dtext">
     <span class="eyebrow">${local ? esc(m.label) + " · " : ""}${esc(m.type)} · placed by ${originLabel(m.origin)}</span>
     <h2>${esc(m.title)}</h2>
     <p class="muted small">${local ? "" : "Official title: "}${esc(m.official)}</p>
     ${m.area ? `<p class="small"><b>Who votes on it:</b> ${esc(m.area)}</p>` : ""}
    </div>
   </div>
   ${resultsSection(m)}
   <section class="section"><h3>What it does</h3><div class="prose"><p>${rich(m.what)}</p></div></section>
   <div class="two">
    <section class="section"><div class="vote"><span class="oval">YES</span><p>${esc(m.yes)}</p></div></section>
    <section class="section"><div class="vote"><span class="oval">NO</span><p>${esc(m.no)}</p></div></section>
   </div>
   <p class="src" style="margin-top:-18px">${esc(m.yesNoSrc || "")}</p>
   <section class="section"><h3>Impact</h3>
    <dl class="kv">
     <dt>To pass</dt><dd>${esc(m.threshold)}</dd>
     <dt>Fiscal${local ? "" : " (LAO)"}</dt><dd>${rich(m.fiscal)}</dd>
     <dt>Short term</dt><dd>${rich(m.short_term)}</dd>
     <dt>Long term</dt><dd>${rich(m.long_term)}</dd>
    </dl>
   </section>
   ${(m.faq || []).length ? `<section class="section"><h3>Common questions</h3>
    <div class="faq">${m.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${rich(f.a)}</p>${f.src ? `<p class="src">Source: ${esc(f.src)}</p>` : ""}</details>`).join("")}</div>
    <p class="src">Plain-language answers written for this guide from the sources named under each answer.</p>
   </section>` : ""}
   <section class="section"><h3>The case each side makes</h3>
    <div class="two">
     <div style="display:grid;gap:8px;min-width:0;align-content:start"><span class="eyebrow">For</span>${arg(m.pro, "pro", m)}<p class="small"><b>Listed supporters:</b> ${esc(m.supporters)}</p></div>
     <div style="display:grid;gap:8px;min-width:0;align-content:start"><span class="eyebrow">Against</span>${arg(m.con, "con", m)}<p class="small"><b>Listed opponents:</b> ${esc(m.opponents)}</p></div>
    </div>
    <p class="src">${local ? "Arguments are each side's own claims, summarized by the named source, and are not fact-checked."
      : `Arguments are written by each campaign, not by the state, and are not fact-checked. Full arguments and rebuttals: <a href="${src.arguments}" target="_blank" rel="noopener">Official guide, ${esc(m.label)}</a>.`}</p>
   </section>
   <section class="section"><h3>Money behind each side</h3>
    ${mo ? `<dl class="kv">
      <dt>Supporting</dt><dd><b class="num">${mo.yes ? fmt(mo.yes) : "under $1M"}</b>${mo.yesNote ? ` · ${esc(mo.yesNote)}` : ""}</dd>
      <dt>Opposing</dt><dd><b class="num">${mo.no ? fmt(mo.no) : "under $1M"}</b>${mo.noNote ? ` · ${esc(mo.noNote)}` : ""}</dd></dl>
      <p class="src">Top-contributor totals reported to the ${T("fppc", "FPPC")} as of ${esc(S.election.money?.asOf || "")}. Current lists at fppc.ca.gov.</p>`
      : `<p class="small muted">Not compiled yet. Local committees file with the county registrar.</p>`}
   </section>
   <section class="section">
    <details class="deep" style="border:0;padding:0"><summary>Go deeper: details and context</summary>
     <div class="prose"><ul>${(m.deep || []).map(d => `<li>${rich(d)}</li>`).join("")}</ul>
     <p class="small">Read the source: ${readLinks}</p>
     ${(m.reading || []).length ? `<h4>Further reading</h4>
     <ul class="small">${m.reading.map(r => `<li><b>${esc(r.source)}:</b> <a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)}</a></li>`).join("")}</ul>
     <p class="src">Independent coverage from nonpartisan news organizations and public agencies, offered for context. Their framing and conclusions are their own.</p>` : ""}</div>
    </details>
   </section>
   ${(m.groups || []).filter(g => S.groups[g]).length ? `<section class="section"><h3>Read it together with</h3><div class="plinks">${m.groups.filter(g => S.groups[g]).map(g => `<button data-group="${g}">${esc(S.groups[g].title)} →</button>`).join("")}</div></section>` : ""}
   <section class="section"><h3>My notes</h3>
    <div class="seg" role="group" aria-label="My leaning">${leansFor(m).map(o => `<button data-lean="${o}" aria-pressed="${(n.lean || "Undecided") === o}"${o === "N/A" ? ' title="Not on my ballot"' : ""}>${o}</button>`).join("")}</div>
    ${dependsOnAddress(m) ? '<p class="src">This measure is only on ballots in its district. Choose N/A if it isn\'t on yours.</p>' : ""}
    <textarea id="note-${m.id}" data-note="${m.id}" placeholder="Questions, reasons, things to check…">${esc(n.note || "")}</textarea>
    <p class="src">Saved only in this browser.</p>
   </section>`;
  $view.dataset.id = m.id;
}

function linkedView(only) {
  if (only && S.groups[only]) {
    const g = S.groups[only];
    $view.innerHTML = `<button class="back" data-view="linked">← All linked groups</button>
     <section style="display:grid;gap:10px"><span class="eyebrow">${g.measures.map(id => esc(S.byId[id]?.label || id)).join(" · ")}</span><h2>${esc(g.title)}</h2><p class="muted">${rich(g.summary)}</p></section>
     <section class="section">${rich(g.body)}</section>
     <section class="section"><h3>Open a measure</h3><div class="plinks">${g.measures.filter(id => S.byId[id]).map(id => `<button data-open="${id}">${esc(S.byId[id].label)}: ${esc(S.byId[id].title)}</button>`).join("")}</div></section>`;
    return;
  }
  $view.innerHTML = `<section style="display:grid;gap:10px"><h2>Linked measures</h2>${intro("Measures best read together.", "<p>Some measures only make sense read together. Groups marked as a legal conflict have real consequences for how your votes combine; the others share a subject or a budget.</p>")}</section>
   <div class="grouplist">${Object.entries(S.groups).map(([k, g]) => `<button class="gcard" data-group="${k}">
     <span class="gnums">${g.measures.map(id => `<span style="${S.byId[id] ? tcol(S.byId[id]) : ""}">${esc(id)}</span>`).join("")}${g.legalConflict ? '<span class="tag link" style="align-self:center">Legal conflict</span>' : ""}</span>
     <h3>${esc(g.title)}</h3><span class="muted small">${rich(g.summary).replace(/<[^>]+>/g, "")}</span></button>`).join("")}</div>`;
}

function moneyView() {
  const M = S.election.money;
  if (!M) { $view.innerHTML = `<h2>Follow the money</h2><p class="muted">Not compiled for this election.</p>`; return; }
  const max = M.max || 100, ticks = [0, .25, .5, .75, 1].map(f => Math.round(f * max));
  const rows = S.measures.filter(m => m.money).sort((a, b) => (b.money.yes + b.money.no) - (a.money.yes + a.money.no));
  const w = v => `calc(${Math.min(v, max) / max} * (100% - 5.5rem))`;
  $view.innerHTML = `
   <section style="display:grid;gap:10px"><h2>Follow the money</h2>${intro(M.summary ? `<b>$${Math.round(S.measures.reduce((t, m) => t + (m.money ? m.money.yes + m.money.no : 0), 0))}M</b> ${esc(M.summary)}, as of ${fmtDay(M.asOf)}.` : esc(M.intro), M.summary ? `<p>${esc(M.intro)}</p>` : "")}</section>
   <section class="section">
    <div class="legend"><span><i class="sw" style="background:var(--accent)"></i>Supporting</span><span><i class="sw" style="background:var(--muted)"></i>Opposing</span><span class="muted small">Millions of dollars · sorted by total</span></div>
    <div class="bars">${rows.map(m => `
     <div class="brow"><button class="pn" data-open="${m.id}" style="background:none;border:0;cursor:pointer;padding:0;${tcol(m)}">${esc(m.id)}</button>
      <div class="bpair">
       <div class="bline"><span class="k">YES</span><div class="track"><span class="bar y" style="width:${w(m.money.yes)}"></span><span>${m.money.yes ? fmt(m.money.yes) : "&lt;$1M"}</span></div></div>
       <div class="bline"><span class="k">NO</span><div class="track"><span class="bar n" style="width:${w(m.money.no)}"></span><span>${m.money.no ? fmt(m.money.no) : "&lt;$1M"}</span></div></div>
      </div></div>`).join("")}</div>
    <div class="axis"><span></span><div class="ticks">${ticks.map(t => `<span style="left:calc(${t / max} * (100% - 5.5rem))">$${t}M</span>`).join("")}</div></div>
   </section>
   <section class="section"><h3>Largest funders</h3>
    <dl class="kv">${(M.funders || []).map(([k, v, who]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${who ? `<span class="who">${esc(who)}</span>` : ""}</dd>`).join("")}</dl>
    <p class="src">${esc(M.source)}${M.fundersSource ? ` ${esc(M.fundersSource)}` : ""}</p>
   </section>`;
}

/* ---------- My ballot ----------
 * The viewer's planned or cast choices, worded by date and by whether they
 * marked their ballot as cast, with results alongside once they are reported. */
// "after" starts when polls close, not at midnight: from then on, an unmarked ballot can't be cast.
function ballotPhase() {
  const day = S.election.date;
  return !day || caToday() < day ? "before" : pollsClosed() ? "after" : "eday";
}
const hasResults = () => pollsClosed() && Object.keys(S.results?.measures || {}).length > 0;
const fmtDay = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// How the viewer's Yes/No choice compares with the reported outcome.
function sideStatus(lean, r) {
  if (!r || (lean !== "Yes" && lean !== "No")) return null;
  const yesWinning = r.outcome === "passed" || r.outcome === "leading";
  const mine = lean === "Yes" ? yesWinning : !yesWinning;
  const done = r.outcome === "passed" || r.outcome === "failed";
  return { mine, done, text: done ? (mine ? "Your side won" : "Your side lost") : (mine ? "Your side is ahead" : "Your side is behind") };
}

function myBallotView() {
  const E = S.election, b = ballotStore.get(), phase = ballotPhase(), results = hasResults();
  const voted = !!b.voted;
  const all = S.measures;
  const leanOf = id => (S.mine[id] || {}).lean || "";
  const decided = all.filter(m => ["Yes", "No"].includes(leanOf(m.id))).length;
  const skipped = all.filter(m => leanOf(m.id) === "N/A").length;
  const counted = all.length - skipped;
  const word = voted ? "My vote" : phase === "after" ? "My leaning" : "My plan";
  const days = E.date ? daysUntil(E.date) : null;

  let title, intro;
  if (voted) {
    title = "My votes";
    intro = `You marked your ballot as cast${b.on ? ` on ${fmtDay(b.on)}` : ""}. These are the choices you recorded.`;
  } else if (phase === "after") {
    title = "My leanings";
    intro = "You didn't mark your ballot as cast, so these are shown as the leanings you saved, not votes.";
  } else {
    title = "My ballot plan";
    intro = phase === "eday"
      ? "Election Day is today. Polls are open 7 a.m. to 8 p.m., and mail ballots must be postmarked today."
      : `Plan your choices before you fill in your ballot. Election Day is ${fmtDay(E.date)}, ${when(days).toLowerCase()}.`;
  }

  let summary = `${decided} of ${counted} decided${skipped ? ` · ${skipped} not on my ballot` : ""}`;
  if (results) {
    const st = all.map(m => sideStatus(leanOf(m.id), resultFor(m.id))).filter(Boolean);
    const won = st.filter(x => x.done && x.mine).length, lost = st.filter(x => x.done && !x.mine).length;
    const ahead = st.filter(x => !x.done && x.mine).length, behind = st.filter(x => !x.done && !x.mine).length;
    const parts = [won && `won ${won}`, lost && `lost ${lost}`, ahead && `ahead on ${ahead}`, behind && `behind on ${behind}`].filter(Boolean);
    summary = parts.length ? `Your side: ${parts.join(" · ")}` : "No results yet for the measures you decided";
  }

  const row = m => {
    const lean = leanOf(m.id), st = sideStatus(lean, resultFor(m.id));
    return `<div class="brow-m">
      <button class="pn" data-open="${esc(m.id)}" style="${tcol(m)}" aria-label="Open ${esc(m.label)}">${esc(m.id)}</button>
      <div class="bm-t"><button class="linkish" data-open="${esc(m.id)}">${esc(m.title)}</button>
        ${results ? `<span class="bm-r">${resultChip(m.id) || '<span class="small muted">No results yet</span>'}${st ? `<span class="side ${st.mine ? "pass" : "fail"}">${st.text}</span>` : ""}</span>` : ""}</div>
      <div class="iseg" role="group" aria-label="${word} on ${esc(m.label)}">${CHOICES.map(o => leansFor(m).includes(o)
        ? `<button class="ib" data-lean="${o}" data-mid="${esc(m.id)}" aria-pressed="${(lean || "Undecided") === o}" aria-label="${choiceName[o]}" title="${choiceName[o]}">${icon(o)}</button>`
        : `<span class="ib off" title="On every ballot, so N/A doesn't apply">${icon(o)}</span>`).join("")}</div>
      <span class="pchoice">${esc(choiceName[lean || "Undecided"])}</span>
    </div>`;
  };

  $view.innerHTML = `
    <section style="display:grid;gap:10px"><h2>${title}</h2><p class="muted">${esc(intro)}</p></section>
    <section class="section">
      <label class="voted"><input type="checkbox" data-voted${voted ? " checked" : ""}> I've cast my ballot${voted && b.on ? ` <span class="muted small">(marked ${fmtDay(b.on)})</span>` : ""}</label>
      <p class="small"><b>${esc(summary)}</b></p>
      ${results ? `<p class="src">${esc(S.results.source || "Results")}${S.results.updated ? ` · updated ${esc(S.results.updated)}` : ""}${S.results.status !== "final" ? " · counting continues" : ""}</p>` : ""}
    </section>
    ${E.jurisdictions.map(j => {
      const list = all.filter(m => m._j === j.id);
      const n = o => list.filter(m => (leanOf(m.id) || "Undecided") === o).length;
      const head = `<div class="brow-m bhead" aria-hidden="true"><span></span><span></span><div class="iseg">${CHOICES.map(o => `<span class="ih"><span class="ihl">${o === "N/A" ? "N/A" : o === "Undecided" ? "?" : o}</span><b>${n(o)}</b></span>`).join("")}</div></div>`;
      return list.length ? `<section class="section"><h3>${esc(j.tab)}</h3><div class="blist">${head}${list.map(row).join("")}</div>
        ${list.some(dependsOnAddress) ? '<p class="src">Some of these depend on your district. Choose N/A for any that are not on your ballot.</p>' : ""}</section>` : "";
    }).join("")}
    <section class="section noprint"><h3>Keep a copy</h3>
      <div class="plinks">
        <button data-export="csv">Download spreadsheet (CSV)</button>
        <button data-export="json">Download backup (JSON)</button>
        <button data-export="restore">Restore from backup</button>
        <button data-export="print">Print or save as PDF</button>
      </div>
      <input type="file" id="restore-file" accept="application/json,.json" hidden>
      <p class="small muted" id="export-status" role="status"></p>
      <p class="src">Your choices, notes, and the checkbox are saved only in this browser. Downloads are made on your device; nothing is sent anywhere. Restore a backup to move them to another browser or device.</p>
    </section>`;
}

/* ---------- Export / restore (My ballot) ----------
 * Everything happens in the browser: files are built and read locally. */
const BACKUP_APP = "ca-ballot-guide";
function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// CSV cell: quoted, and text that a spreadsheet might run as a formula is made literal.
const csvCell = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };

function exportCSV() {
  const E = S.election, b = ballotStore.get();
  const rows = [
    [E.name], [`Ballot cast: ${b.voted ? (b.on || "yes") : "not marked"}`], [`Exported: ${new Date().toLocaleString()}`], [],
    ["Area", "Measure", "Title", "My choice", "My note", "Result (% yes)", "Outcome"]
  ];
  for (const m of S.measures) {
    const n = S.mine[m.id] || {}, r = resultFor(m.id);
    rows.push([jur(m._j)?.tab || "", m.label, m.title, choiceName[n.lean || "Undecided"], n.note || "", r?.yesPct ?? "", r?.outcome ?? ""]);
  }
  download(`my-ballot-${E.id}.csv`, "text/csv;charset=utf-8", "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n"));
  return "Spreadsheet downloaded.";
}

function exportJSON() {
  const E = S.election;
  const data = { app: BACKUP_APP, version: 1, election: E.id, exportedAt: new Date().toISOString(), ballot: ballotStore.get(), choices: S.mine };
  download(`my-ballot-${E.id}-backup.json`, "application/json", JSON.stringify(data, null, 2));
  return "Backup downloaded. Keep it somewhere safe; it includes your notes.";
}

// Accept only known measures, valid choices, and plain-text notes from a backup file.
function restoreBackup(text) {
  let d; try { d = JSON.parse(text); } catch { return "That file isn't a valid backup."; }
  if (!d || d.app !== BACKUP_APP || typeof d.choices !== "object") return "That file isn't a backup from this guide.";
  if (d.election !== S.election.id) return `That backup is for a different election (${String(d.election).slice(0, 20)}).`;
  const mine = {};
  for (const m of S.measures) {
    const c = d.choices[m.id]; if (!c || typeof c !== "object") continue;
    const lean = leansFor(m).includes(c.lean) && c.lean !== "Undecided" ? c.lean : "";
    const note = typeof c.note === "string" ? c.note.slice(0, 5000) : "";
    if (lean || note) mine[m.id] = { ...(lean && { lean }), ...(note && { note }) };
  }
  const b = d.ballot && d.ballot.voted === true ? { voted: true, ...(/^\d{4}-\d{2}-\d{2}$/.test(d.ballot.on || "") && { on: d.ballot.on }) } : {};
  if (!confirm(`Replace the choices and notes saved in this browser with this backup (${Object.keys(mine).length} measures)?`)) return "Restore cancelled.";
  S.mine = mine; store.set(mine); ballotStore.set(b);
  myBallotView(); dateTicker(S.election.keyDates || []);
  return `Restored ${Object.keys(mine).length} measures from the backup.`;
}

function glossaryView() {
  $view.innerHTML = `<section style="display:grid;gap:10px"><h2>Key terms</h2>${intro("Tap any dotted word for its definition.")}</section>
   <div class="gloss">${Object.entries(S.glossary).sort((a, b) => a[1].term.localeCompare(b[1].term)).map(([k, g]) => `<article id="t-${k}"><h3>${esc(g.term)}</h3><p class="small">${esc(g.definition)}</p></article>`).join("")}</div>`;
}

function aboutView() {
  const E = S.election;
  $view.innerHTML = `<section style="display:grid;gap:10px"><h2>Method &amp; sources</h2></section>
   <section class="section"><div class="prose">
    <h3>How this guide stays neutral</h3>
    <ul>
     <li><b>Facts</b> (what a measure does, its cost) come from the official title and summary and the ${T("lao", "Legislative Analyst's Office")} analysis.</li>
     <li><b>Arguments</b> are each campaign's own official ballot argument, quoted and attributed. They are advocacy and are not fact-checked by the state.</li>
     <li><b>Context</b> (money, background, news) comes from named secondary sources and is labeled.</li>
     <li>Every measure gets the same sections in the same order. Measures appear in ballot order. Yes and No are styled identically. No recommendations and no polling.</li>
    </ul>
    <h3>How measures are tagged by topic</h3>
    <p>A measure gets every topic whose rule it meets. The first topic is its main subject and sets its color. Topics are this guide's own grouping; the state does not categorize measures.</p>
    <ul>${Object.values(S.topics).map(t => `<li><b>${esc(t.label)}:</b> ${esc(t.rule)}</li>`).join("")}</ul>
    <h3>Things every voter should know</h3>
    <ul>
     <li>Every statewide proposition passes with a simple majority (more than 50% yes).</li>
     <li>A ${T("ica", "constitutional amendment")} can only be undone by another statewide vote. ${T("statute", "Initiative statutes")} are also hard for the Legislature to change.</li>
     <li>When two passing measures conflict, the one with more yes votes generally prevails (see ${T("conflict", "conflicting measures")}).</li>
     <li>Bonds are borrowing, repaid with interest from the state budget unless they are revenue bonds.</li>
    </ul>
    ${E.jurisdictions.filter(j => j.method).map(j => `<h3>${esc(j.tab)}</h3><p>${esc(j.method)}</p>`).join("")}
    <h3>Sources</h3>
    <ul class="small">${(E.sources || []).map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join("")}</ul>
    <p class="small muted">Content last checked ${esc(E.lastChecked)}.</p>
   </div></section>`;
}

/* ---------- Key dates ticker ----------
 * Shows one upcoming deadline at a time (California time), starting with the
 * next one, and rolls up to the following one every 15 seconds. */
const TICK_MS = 15000;
const caToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const daysUntil = (iso) => Math.round((Date.parse(iso) - Date.parse(caToday())) / 864e5);
const when = (n) => n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`;
let tickTimer = null;

// The viewer's next step, shown first in the carousel. Logistics only: it never
// suggests how to vote. Measures marked N/A don't count toward "decided".
function nextAction() {
  const E = S.election, b = ballotStore.get();
  const all = S.measures.filter(m => (S.mine[m.id] || {}).lean !== "N/A");
  const decided = all.filter(m => ["Yes", "No"].includes((S.mine[m.id] || {}).lean)).length;
  const phase = ballotPhase();
  if (phase === "after") return hasResults()
    ? { label: "NEXT", text: "Results are in · See them next to your choices", view: "mine" }
    : { label: "NEXT", text: "Polls are closed · Results will appear on My ballot", view: "mine" };
  if (b.voted) return { label: "DONE", text: `Ballot cast ✓ · Results after polls close, ${fmtDay(E.date)} 8 p.m.`, view: "mine" };
  if (phase === "eday") return { label: "TODAY", text: `Polls close 8 p.m. today · ${decided} of ${all.length} decided`, view: "mine" };
  if (decided < all.length) return { label: "NEXT", text: `${decided} of ${all.length} decided · Finish My ballot`, view: "mine" };
  return { label: "NEXT", text: `All ${all.length} decided · Return your ballot by ${fmtDay(E.date)}, then mark it cast`, view: "mine" };
}

function dateTicker(all) {
  const box = $("dates");
  clearTimeout(tickTimer);
  const upcoming = () => [nextAction(), ...all.filter(d => !d.date || d.date >= caToday())].filter(Boolean);
  const sig = l => l.map(d => d.label + d.text).join("|");
  let list = upcoming();
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  const item = (d) => d.view
    ? `<button type="button" class="date next" data-view="${d.view}"><b>${esc(d.label)}</b><span>${esc(d.text)}&nbsp;→</span></button>`
    : `<span class="date"><b>${esc(d.label)}</b><span>${esc(d.text)}${d.date ? ` <i>· ${when(daysUntil(d.date))}</i>` : ""}</span></span>`;
  box.setAttribute("role", "group"); box.setAttribute("aria-label", "Next step and key dates");
  box.innerHTML = `<div class="roll">${item(list[0])}</div>
    ${list.length > 1 ? `<div class="dots">${list.map((d, k) => `<button type="button" aria-label="Show ${d.view ? "next step" : esc(d.label)}"${k ? "" : ' aria-current="true"'}></button>`).join("")}</div>` : ""}`;
  if (list.length < 2) return;
  const roll = box.querySelector(".roll"), dots = [...box.querySelectorAll(".dots button")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let i = 0, held = false;

  const show = (k) => {
    if (k === i) return;
    i = k;
    dots.forEach((d, n) => d.toggleAttribute("aria-current", n === i));
    const cur = roll.lastElementChild;
    roll.style.height = cur.offsetHeight + "px";
    roll.insertAdjacentHTML("beforeend", item(list[i]));
    const nu = roll.lastElementChild;
    if (reduce.matches) { roll.querySelectorAll(".date:not(:last-child)").forEach(e => e.remove()); roll.style.height = ""; return; }
    nu.classList.add("enter");
    void nu.offsetHeight;
    roll.style.height = nu.offsetHeight + "px";
    cur.classList.add("leave"); nu.classList.remove("enter");
    setTimeout(() => { cur.remove(); if (roll.childElementCount === 1) roll.style.height = ""; }, 600);
  };
  const schedule = () => { clearTimeout(tickTimer); tickTimer = setTimeout(tick, TICK_MS); };
  const tick = () => {
    if (sig(upcoming()) !== sig(list)) return dateTicker(all);
    if (!held && !document.hidden) show((i + 1) % list.length);
    schedule();
  };
  dots.forEach((d, k) => d.onclick = () => { show(k); schedule(); });
  box.onmouseenter = box.onfocusin = () => { held = true; };
  box.onmouseleave = () => { held = box.contains(document.activeElement); };
  box.onfocusout = (e) => { if (!box.contains(e.relatedTarget)) held = box.matches(":hover"); };
  schedule();
}

/* ---------- Shell ---------- */
function shell() {
  const E = S.election;
  document.title = `${E.name} · California Ballot Guide`;
  $("eyebrow").textContent = E.eyebrow || E.name;
  $("lede").outerHTML = `<div class="lede" id="lede">${intro(esc(E.ledeShort || E.lede || ""), E.ledeShort ? `<p>${esc(E.lede)}</p>` : "")}</div>`;
  const sel = $("election-select");
  if (S.index.elections.length > 1) {
    sel.hidden = false;
    sel.innerHTML = S.index.elections.map(e => `<option value="${e.id}"${e.id === E.id ? " selected" : ""}>${esc(e.name)}</option>`).join("");
    sel.onchange = () => { location.search = `?election=${sel.value}`; };
  }
  const tabs = [...E.jurisdictions.map(j => [j.id, j.tab]), ["mine", "My ballot"], ["linked", "Linked measures"], ["money", "Follow the money"], ["glossary", "Key terms"], ["about", "Method & sources"]];
  $("tabbar").innerHTML = tabs.map(([k, t]) => `<button data-view="${k}">${esc(t)}</button>`).join("");
  $("footer").innerHTML = `A nonpartisan study guide. Verify against the <a href="https://voterguide.sos.ca.gov/" target="_blank" rel="noopener">Official Voter Information Guide</a> and your county sample ballot before you vote. Content checked ${esc(E.lastChecked)}.`;
}

// Malformed %-escapes in a shared link should fall back to the default view, not throw.
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };

function go(token, push = true) {
  const E = S.election;
  dateTicker(E.keyDates || []);
  token = token || E.jurisdictions[0].id;
  let tab = token;
  const m = token.match(/^m-(.+)$/), g = token.match(/^g-(.+)$/);
  if (m) { const id = safeDecode(m[1]); detail(id); tab = S.byId[id]?._j || E.jurisdictions[0].id; }
  else if (g) { linkedView(g[1]); tab = "linked"; }
  else if (jur(token)) jurisdictionView(jur(token));
  else ({ mine: myBallotView, linked: () => linkedView(), money: moneyView, glossary: glossaryView, about: aboutView }[token]
        || (() => { tab = E.jurisdictions[0].id; jurisdictionView(E.jurisdictions[0]); }))();
  document.querySelectorAll("#tabbar button").forEach(b => b.setAttribute("aria-current", b.dataset.view === tab));
  if (push) { history.pushState(null, "", `${location.search}#${token}`); window.scrollTo({ top: 0 }); }
}

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("button"); hidePop(e);
  if (!t) return;
  if (t.dataset.term) { e.stopPropagation(); showPop(t); return; }
  if (t.classList.contains("info")) {
    const box = document.getElementById(t.getAttribute("aria-controls")), open = t.getAttribute("aria-expanded") !== "true";
    t.setAttribute("aria-expanded", open); box.hidden = !open; return;
  }
  if (t.dataset.export) {
    const say = msg => { const el = $("export-status"); if (el) el.textContent = msg; };
    const k = t.dataset.export;
    if (k === "csv") return say(exportCSV());
    if (k === "json") return say(exportJSON());
    if (k === "print") return window.print();
    if (k === "restore") return $("restore-file").click();
  }
  if (t.dataset.view) return go(t.dataset.view);
  if (t.dataset.open) return go("m-" + encodeURIComponent(t.dataset.open));
  if (t.dataset.group) return go("g-" + t.dataset.group);
  if (t.dataset.filter) {
    const k = t.dataset.filter;
    S.filterScroll = t.closest(".filters")?.scrollLeft || 0;
    if (k === "all") S.filter.clear(); else S.filter.has(k) ? S.filter.delete(k) : S.filter.add(k);
    return go(location.hash.slice(1) || S.election.jurisdictions[0].id, false);
  }
  if (t.dataset.lean) {
    const id = t.dataset.mid || $view.dataset.id; S.mine[id] = S.mine[id] || {};
    S.mine[id].lean = t.dataset.lean === "Undecided" ? "" : t.dataset.lean; store.set(S.mine);
    t.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === t));
    if (t.dataset.mid) myBallotView();
    dateTicker(S.election.keyDates || []);
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "restore-file") {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(txt => { const msg = restoreBackup(txt); const el = $("export-status"); if (el) el.textContent = msg; });
    e.target.value = ""; return;
  }
  if (!e.target.matches("[data-voted]")) return;
  ballotStore.set(e.target.checked ? { voted: true, on: caToday() } : {});
  myBallotView();
  dateTicker(S.election.keyDates || []);
});
document.addEventListener("input", e => {
  const id = e.target.dataset?.note;
  if (id) { S.mine[id] = S.mine[id] || {}; S.mine[id].note = e.target.value; store.set(S.mine); }
});
window.addEventListener("popstate", () => go(location.hash.slice(1), false));

/* Glossary popover */
let pop;
function showPop(btn) {
  hidePop(); const g = S.glossary[btn.dataset.term]; if (!g) return;
  pop = document.createElement("div"); pop.className = "pop"; pop.setAttribute("role", "tooltip");
  pop.innerHTML = `<b>${esc(g.term)}</b>${esc(g.definition)}`; document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const x = Math.min(Math.max(16, r.left), window.innerWidth - pw - 16);
  let y = r.bottom + 8; if (y + ph > window.innerHeight - 16) y = r.top - ph - 8;
  pop.style.left = x + "px"; pop.style.top = Math.max(16, y) + "px";
}
function hidePop(e) { if (pop && (!e || !pop.contains(e.target))) { pop.remove(); pop = null; } }
window.addEventListener("scroll", () => hidePop(), { passive: true });
document.addEventListener("keydown", e => { if (e.key === "Escape") hidePop(); });

/* ---------- Start ---------- */
load().then(() => { shell(); go(location.hash.slice(1), false); })
  .catch(err => {
    $view.innerHTML = `<section class="section"><h3>The guide couldn't load its data</h3><p class="small">${esc(err.message)}. If you opened index.html directly from disk, run a local server instead (see README).</p></section>`;
  });
