// Checks every election's data files for required fields, broken references,
// and unknown glossary terms. Run: node scripts/validate.mjs
import { readFileSync, existsSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const REQUIRED = ["id", "label", "passPct", "title", "official", "origin", "type", "topics", "threshold",
  "short", "what", "yes", "no", "fiscal", "short_term", "long_term", "supporters", "opponents", "deep", "groups"];
const OUTCOMES = ["passed", "failed", "leading", "trailing"];

const glossary = read("data/glossary.json");
const topics = read("data/topics.json");
for (const [k, t] of Object.entries(topics)) if (!t.label || !t.rule) err(`data/topics.json [${k}]`, "needs label and rule");
const index = read("data/elections.json");

const termRefs = (text, where) => {
  for (const [, key] of String(text ?? "").matchAll(/\[\[([\w-]+)\|[^\]]+\]\]/g))
    if (!glossary[key]) err(where, `unknown glossary term "${key}"`);
};

if (!index.elections.some((e) => e.id === index.default)) err("elections.json", `default "${index.default}" is not listed`);

for (const e of index.elections) {
  const dir = `data/${e.id}`;
  if (!existsSync(`${dir}/election.json`)) { err(dir, "missing election.json"); continue; }
  const election = read(`${dir}/election.json`);
  const groups = existsSync(`${dir}/groups.json`) ? read(`${dir}/groups.json`) : {};
  const ids = new Set();
  // Summaries are meant to fit on one line on a phone.
  const oneLine = (t, where) => { if (t && t.length > 50) err(where, `summary is ${t.length} characters; keep it to one line on a phone (50 max)`); };
  oneLine(election.ledeShort, `${dir}/election.json ledeShort`); oneLine(election.money?.summary, `${dir}/election.json money.summary`);
  for (const j of election.jurisdictions) oneLine(j.summary, `${dir}/election.json [${j.id}].summary`);
  if (election.pollsClose && !/^\d{2}:\d{2}$/.test(election.pollsClose)) err(`${dir}/election.json`, "pollsClose must be HH:MM (California time)");
  (election.keyDates || []).forEach((d, i) => {
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) err(`${dir}/election.json keyDates[${i}]`, "date must be YYYY-MM-DD");
  });

  for (const j of election.jurisdictions) {
    const file = `${dir}/${j.file}`;
    if (!existsSync(file)) { err(file, "missing"); continue; }
    for (const m of read(file)) {
      const where = `${file} [${m.id}]`;
      for (const k of REQUIRED) if (m[k] === undefined) err(where, `missing "${k}"`);
      if (ids.has(m.id)) err(where, "duplicate measure id in this election");
      ids.add(m.id);
      for (const t of m.topics || []) if (!topics[t]) err(where, `unknown topic "${t}"`);
      for (const g of m.groups || []) if (!groups[g]) err(where, `unknown group "${g}"`);
      for (const k of ["what", "fiscal", "short_term", "long_term"]) termRefs(m[k], `${where}.${k}`);
      (m.deep || []).forEach((d, i) => termRefs(d, `${where}.deep[${i}]`));
      (m.faq || []).forEach((f, i) => {
        if (!f.q || !f.a) err(`${where}.faq[${i}]`, "needs q and a");
        termRefs(f.a, `${where}.faq[${i}]`);
      });
      (m.reading || []).forEach((r, i) => {
        if (!r.source || !r.title) err(`${where}.reading[${i}]`, "needs source and title");
        if (!/^https:\/\//.test(r.url || "")) err(`${where}.reading[${i}]`, "url must start with https://");
      });
      if (typeof m.passPct !== "number" || m.passPct < 50 || m.passPct > 100) err(where, "passPct must be a number from 50 to 100");
      if (m.money && (typeof m.money.yes !== "number" || typeof m.money.no !== "number")) err(where, "money.yes and money.no must be numbers (millions)");
    }
    for (const s of j.sections || []) for (const id of s.measures) if (!ids.has(id)) err(`${dir}/election.json`, `section lists unknown measure "${id}"`);
  }
  for (const [k, g] of Object.entries(groups)) {
    for (const id of g.measures) if (!ids.has(id)) err(`${dir}/groups.json [${k}]`, `unknown measure "${id}"`);
    termRefs(g.summary, `${dir}/groups.json [${k}].summary`); termRefs(g.body, `${dir}/groups.json [${k}].body`);
  }
  if (existsSync(`${dir}/committees.json`)) {
    const where = `${dir}/committees.json`, C = read(`${dir}/committees.json`);
    const num = v => typeof v === "number" && Number.isFinite(v);
    for (const f of ["exportDate", "latestLate", "since"]) if (!/^\d{4}-\d{2}-\d{2}$/.test(C[f] || "")) err(where, `${f} must be YYYY-MM-DD`);
    for (const [cid, c] of Object.entries(C.committees || {})) {
      const w = `${where} [${cid}]`;
      if (!/^\d+$/.test(cid)) err(w, "committee id must be digits");
      if (!c.name) err(w, "missing name");
      if (c.url !== `https://cal-access.sos.ca.gov/Campaign/Committees/Detail.aspx?id=${cid}`) err(w, "url must be its Cal-Access page");
      for (const m of c.measures || []) {
        if (!ids.has(m.id)) err(w, `unknown measure "${m.id}"`);
        if (!["yes", "no"].includes(m.side)) err(w, `bad side "${m.side}"`);
      }
      for (const p of [...(c.donors || []), ...(c.recipients || [])]) {
        if (!p.name || !num(p.total) || p.total <= 0) err(w, `bad entry "${p.name}"`);
        if (!["person", "committee", "organization"].includes(p.kind)) err(w, `bad kind for "${p.name}"`);
        for (const banned of ["city", "zip", "address", "employer", "occupation"]) if (banned in p) err(w, `"${banned}" must not be published`);
      }
    }
  }

  if (existsSync(`${dir}/results.json`)) {
    const r = read(`${dir}/results.json`);
    for (const [id, x] of Object.entries(r.measures || {})) {
      if (!ids.has(id)) err(`${dir}/results.json`, `unknown measure "${id}"`);
      if (!OUTCOMES.includes(x.outcome)) err(`${dir}/results.json [${id}]`, `outcome must be one of ${OUTCOMES.join(", ")}`);
      for (const f of ["yes", "no"]) if (x[f] != null && !(Number.isInteger(x[f]) && x[f] >= 0)) err(`${dir}/results.json [${id}]`, `${f} must be a whole number of votes`);
      if (x.yesPct != null && (typeof x.yesPct !== "number" || x.yesPct < 0 || x.yesPct > 100)) err(`${dir}/results.json [${id}]`, "yesPct must be 0 to 100");
      if (x.sourceUrl && !/^https:\/\//.test(x.sourceUrl)) err(`${dir}/results.json [${id}]`, "sourceUrl must be https");
    }
  }
  console.log(`${e.id}: ${ids.size} measures, ${Object.keys(groups).length} groups`);
}

if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ` + errors.join("\n- ")); process.exit(1); }
console.log("All data files look good.");
