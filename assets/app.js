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
  glossary: {}, topics: {}, results: null, filter: "all", mine: {}
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
  Object.assign(S, { election, glossary, topics, groups: groups || {}, results });
  const lists = await Promise.all(election.jurisdictions.map(j => getJSON(`${id}/${j.file}`)));
  S.measures = [];
  election.jurisdictions.forEach((j, i) => lists[i].forEach(m => S.measures.push({ ...m, _j: j.id })));
  S.byId = Object.fromEntries(S.measures.map(m => [m.id, m]));
  S.mine = store.get();
}

/* ---------- Per-viewer notes (localStorage) ---------- */
const store = {
  key: () => `ballot-guide:${S.election?.id}`,
  get() { try { return JSON.parse(localStorage.getItem(this.key()) || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem(this.key(), JSON.stringify(v)); } catch {} }
};

/* ---------- Helpers ---------- */
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// [[term-key|label]] in data becomes a glossary button. Data may also contain simple trusted HTML.
const rich = (t) => String(t ?? "").replace(/\[\[([\w-]+)\|([^\]]+)\]\]/g,
  (_, k, l) => S.glossary[k] ? `<button class="term" data-term="${k}">${l}</button>` : l);
const T = (k, l) => rich(`[[${k}|${l}]]`);
const fmt = v => v >= 1 ? `$${v.toFixed(v % 1 ? 1 : 0)}M` : "under $1M";
const topicOf = m => m.topics.find(t => t !== "local") || "local";
const tcol = m => `--tc:var(--c-${topicOf(m)})`;
const isLinkedTax = m => (m.groups || []).some(g => S.groups[g]?.legalConflict);
const jur = id => S.election.jurisdictions.find(j => j.id === id);
const originLabel = o => o === "Legislature" ? "the Legislature" : o === "School board" ? "the school board" : "petition signatures";

function resultChip(id) {
  const r = S.results?.measures?.[id];
  if (!r) return "";
  const word = { passed: "Passed", failed: "Failed", leading: "Leading", trailing: "Trailing" }[r.outcome] || "";
  const cls = r.outcome === "passed" || r.outcome === "leading" ? "pass" : "fail";
  return `<span class="result ${cls}">${word}${r.yesPct != null ? ` · ${r.yesPct}% yes` : ""}${r.final ? "" : " · counting"}</span>`;
}
const leanChip = id => { const l = (S.mine[id] || {}).lean; return l ? `<span class="lean">My lean: ${l}</span>` : ""; };

function card(m) {
  const big = m.id.length > 2;
  return `<button class="card" data-open="${m.id}" style="${tcol(m)}">
    <span class="pnum num"${big ? ' style="font-size:1.15rem"' : ""}>${esc(m.id)}</span>
    <span class="t">${esc(m.title)}</span>
    <span class="s">${esc(m.short)}</span>
    <span class="meta"><span class="tag topic">${esc(S.topics[topicOf(m)] || "")}</span><span class="tag">${esc(m.origin)}</span>${isLinkedTax(m) ? '<span class="tag link">Linked</span>' : ""}${resultChip(m.id)}${leanChip(m.id)}</span>
  </button>`;
}

/* ---------- Views ---------- */
function jurisdictionView(j) {
  const list = S.measures.filter(m => m._j === j.id);
  const sectioned = !!j.sections;
  const topicsHere = [...new Set(list.flatMap(m => m.topics))].filter(t => S.topics[t]);
  const chips = sectioned ? "" : `<div class="filters" role="group" aria-label="Filter by topic">
    <button class="chip" aria-pressed="${S.filter === "all"}" data-filter="all">All</button>
    ${topicsHere.map(k => `<button class="chip" aria-pressed="${S.filter === k}" data-filter="${k}" style="--tc:var(--c-${k})">${esc(S.topics[k])}</button>`).join("")}</div>`;
  const shown = list.filter(m => S.filter === "all" || m.topics.includes(S.filter));
  const decided = list.filter(m => (S.mine[m.id] || {}).lean).length;
  $view.innerHTML = `
    <section style="display:grid;gap:10px">
      ${j.eyebrow ? `<span class="eyebrow">${esc(j.eyebrow)}</span>` : ""}
      <h2>${esc(j.title)}</h2>
      <p class="muted" style="max-width:68ch">${rich(j.intro)}</p>
      ${sectioned ? "" : `<p class="small muted">You've noted a leaning on ${decided} of ${list.length}. Leanings stay in this browser only.</p>`}
    </section>
    ${j.notOnBallot ? `<section class="section"><h3>What's not on the ballot</h3><div class="prose small">${j.notOnBallot.map(p => `<p>${p}</p>`).join("")}</div></section>` : ""}
    ${chips}
    ${sectioned
      ? j.sections.map(sec => `<div style="display:grid;gap:10px"><span class="eyebrow">${esc(sec.title)}</span>
          <div class="grid">${sec.measures.map(id => S.byId[id]).filter(Boolean).map(card).join("")}</div>
          ${sec.note ? `<p class="small muted">${sec.note}</p>` : ""}</div>`).join("")
      : `<div class="grid">${shown.map(card).join("")}</div>`}
    ${j.groups ? `<section class="section"><h3>Read together</h3><div class="plinks">${j.groups.filter(g => S.groups[g]).map(g => `<button data-group="${g}">${esc(S.groups[g].title)} →</button>`).join("")}</div></section>` : ""}`;
}

function arg(text, side, m) {
  if (!text) return m.argSrc === null && m._j !== "ca"
    ? `<blockquote class="muted">Not compiled yet. The official arguments are printed in your county voter information guide.</blockquote>`
    : `<blockquote class="muted">No argument ${side === "pro" ? "in favor" : "against"} was submitted for the official guide.</blockquote>`;
  const cite = m.argSrc || `Official ballot argument ${side === "pro" ? "in favor" : "against"}, ${m.label} (summary as printed)`;
  return `<blockquote>${esc(text)}<cite>${esc(cite)}</cite></blockquote>`;
}

function resultsSection(m) {
  const r = S.results?.measures?.[m.id];
  if (!r) return "";
  const y = r.yesPct ?? 0;
  return `<section class="section"><h3>Results</h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${resultChip(m.id)}
      ${r.yes != null ? `<span class="small muted num">${r.yes.toLocaleString()} yes · ${r.no.toLocaleString()} no</span>` : ""}</div>
    <div class="rbar" role="img" aria-label="${y}% yes"><span class="ry" style="width:${y}%"></span><span class="rn" style="width:${100 - y}%"></span></div>
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
    <div class="seg" role="group" aria-label="My leaning">${["Undecided", "Yes", "No"].map(o => `<button data-lean="${o}" aria-pressed="${(n.lean || "Undecided") === o}">${o}</button>`).join("")}</div>
    <textarea id="note-${m.id}" data-note="${m.id}" placeholder="Questions, reasons, things to check…">${esc(n.note || "")}</textarea>
    <p class="src">Saved only in this browser.</p>
   </section>`;
  $view.dataset.id = m.id;
}

function linkedView(only) {
  if (only && S.groups[only]) {
    const g = S.groups[only];
    $view.innerHTML = `<button class="back" data-view="linked">← All linked groups</button>
     <section style="display:grid;gap:10px"><span class="eyebrow">${g.measures.map(id => esc(S.byId[id]?.label || id)).join(" · ")}</span><h2>${esc(g.title)}</h2><p class="muted" style="max-width:68ch">${rich(g.summary)}</p></section>
     <section class="section">${rich(g.body)}</section>
     <section class="section"><h3>Open a measure</h3><div class="plinks">${g.measures.filter(id => S.byId[id]).map(id => `<button data-open="${id}">${esc(S.byId[id].label)}: ${esc(S.byId[id].title)}</button>`).join("")}</div></section>`;
    return;
  }
  $view.innerHTML = `<section style="display:grid;gap:10px"><h2>Linked measures</h2><p class="muted" style="max-width:68ch">Some measures only make sense read together. Groups marked as a legal conflict have real consequences for how your votes combine; the others share a subject or a budget.</p></section>
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
   <section style="display:grid;gap:10px"><h2>Follow the money</h2><p class="muted" style="max-width:68ch">${esc(M.intro)}</p></section>
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

function glossaryView() {
  $view.innerHTML = `<section style="display:grid;gap:10px"><h2>Key terms</h2><p class="muted" style="max-width:68ch">Dotted-underlined words throughout the guide open these definitions.</p></section>
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

/* ---------- Shell ---------- */
function shell() {
  const E = S.election;
  document.title = `${E.name} · California Ballot Guide`;
  $("eyebrow").textContent = E.eyebrow || E.name;
  $("lede").textContent = E.lede || "";
  $("dates").innerHTML = (E.keyDates || []).map(d => `<span><b>${esc(d.label)}</b>${esc(d.text)}</span>`).join("");
  const sel = $("election-select");
  if (S.index.elections.length > 1) {
    sel.hidden = false;
    sel.innerHTML = S.index.elections.map(e => `<option value="${e.id}"${e.id === E.id ? " selected" : ""}>${esc(e.name)}</option>`).join("");
    sel.onchange = () => { location.search = `?election=${sel.value}`; };
  }
  const tabs = [...E.jurisdictions.map(j => [j.id, j.tab]), ["linked", "Linked measures"], ["money", "Follow the money"], ["glossary", "Key terms"], ["about", "Method & sources"]];
  $("tabbar").innerHTML = tabs.map(([k, t]) => `<button data-view="${k}">${esc(t)}</button>`).join("");
  $("footer").innerHTML = `A nonpartisan study guide. Verify against the <a href="https://voterguide.sos.ca.gov/" target="_blank" rel="noopener">Official Voter Information Guide</a> and your county sample ballot before you vote. Content checked ${esc(E.lastChecked)}.`;
}

function go(token, push = true) {
  const E = S.election;
  token = token || E.jurisdictions[0].id;
  let tab = token;
  const m = token.match(/^m-(.+)$/), g = token.match(/^g-(.+)$/);
  if (m) { detail(decodeURIComponent(m[1])); tab = S.byId[decodeURIComponent(m[1])]?._j || E.jurisdictions[0].id; }
  else if (g) { linkedView(g[1]); tab = "linked"; }
  else if (jur(token)) jurisdictionView(jur(token));
  else ({ linked: () => linkedView(), money: moneyView, glossary: glossaryView, about: aboutView }[token]
        || (() => { tab = E.jurisdictions[0].id; jurisdictionView(E.jurisdictions[0]); }))();
  document.querySelectorAll("#tabbar button").forEach(b => b.setAttribute("aria-current", b.dataset.view === tab));
  if (push) { history.pushState(null, "", `${location.search}#${token}`); window.scrollTo({ top: 0 }); }
}

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("button"); hidePop(e);
  if (!t) return;
  if (t.dataset.term) { e.stopPropagation(); showPop(t); return; }
  if (t.dataset.view) return go(t.dataset.view);
  if (t.dataset.open) return go("m-" + encodeURIComponent(t.dataset.open));
  if (t.dataset.group) return go("g-" + t.dataset.group);
  if (t.dataset.filter) { S.filter = t.dataset.filter; return go(location.hash.slice(1) || S.election.jurisdictions[0].id, false); }
  if (t.dataset.lean) {
    const id = $view.dataset.id; S.mine[id] = S.mine[id] || {};
    S.mine[id].lean = t.dataset.lean === "Undecided" ? "" : t.dataset.lean; store.set(S.mine);
    t.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === t));
  }
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
