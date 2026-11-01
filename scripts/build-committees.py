#!/usr/bin/env python3
"""Build data/<election>/committees.json from official sources only.

Sources:
  - FPPC Top 10 Contributors page: which committees are formed for each measure.
  - Secretary of State CAL-ACCESS raw export: what each committee received and gave.

Usage:
  python3 scripts/build-committees.py --cache <dir> [--out data/2026-11-03/committees.json]

Streams only the tables it needs out of the 1.6 GB zip using HTTP range requests.
Refuses to publish a committee whose itemized donors do not reconcile to its own
filed summary totals. See README, "Committee detail", for the rules applied here.
"""
import argparse, collections, csv, datetime as dt, hashlib, html, json, os, re, struct, subprocess, sys, zlib

EXPORT = "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip"
FPPC = "https://www.fppc.ca.gov/search-filings/top-10-contributors-list/november-2026-general-election/"
SINCE = dt.date(2025, 1, 1)      # Count money from this date on.
FOLLOW_MIN = 1_000_000           # Also profile committees that gave a measure committee this much.
TOP_DONORS = 10
TOP_RECIPIENTS = 10
RECONCILE_TOLERANCE = 0.005      # Largest allowed gap, as a share of filed totals.
COMMITTEE_ENTITIES = {"COM", "SCC", "RCP", "PTY", "CAO", "BMC"}
csv.field_size_limit(10 ** 8)


def curl(*args):
    return subprocess.run(["curl", "-sS", "-L", "--max-time", "300", *args], capture_output=True, check=True).stdout


def rng(a, b):
    return curl("-r", f"{a}-{b}", EXPORT)


def zip_directory():
    """Read the zip's central directory (zip64 aware) without downloading the file."""
    head = curl("-I", EXPORT).decode("latin-1")
    size = int(re.findall(r"content-length:\s*(\d+)", head, re.I)[-1])
    modified = (re.findall(r"last-modified:\s*(.+?)\r?\n", head, re.I) or [""])[-1]
    tail = rng(size - 70000, size - 1)
    end = tail.rfind(b"PK\x05\x06")
    cs, co = struct.unpack("<II", tail[end + 12:end + 20])
    loc = tail.rfind(b"PK\x06\x07")
    if loc >= 0:
        off = struct.unpack("<Q", tail[loc + 8:loc + 16])[0]
        _, cs, co = struct.unpack("<QQQ", rng(off, off + 56)[32:56])
    d, p, out = rng(co, co + cs - 1), 0, {}
    while d[p:p + 4] == b"PK\x01\x02":
        c, u = struct.unpack("<II", d[p + 20:p + 28])
        n, x, k = struct.unpack("<HHH", d[p + 28:p + 34])
        lo = struct.unpack("<I", d[p + 42:p + 46])[0]
        ex, q = d[p + 46 + n:p + 46 + n + x], 0
        while q < len(ex):
            i, l = struct.unpack("<HH", ex[q:q + 4])
            if i == 1:
                v, j = ex[q + 4:q + 4 + l], 0
                if u == 0xffffffff: j += 8
                if c == 0xffffffff: c = struct.unpack("<Q", v[j:j + 8])[0]; j += 8
                if lo == 0xffffffff: lo = struct.unpack("<Q", v[j:j + 8])[0]
            q += 4 + l
        out[d[p + 46:p + 46 + n].decode()] = (c, lo)
        p += 46 + n + x + k
    return out, modified


def stream_rows(directory, table):
    """Yield one table's rows as dicts, inflating as it downloads."""
    c, lo = directory[f"CalAccess/DATA/{table}.TSV"]
    n, x = struct.unpack("<HH", rng(lo, lo + 29)[26:30])
    st = lo + 30 + n + x
    proc = subprocess.Popen(["curl", "-sS", "-L", "--max-time", "900", "-r", f"{st}-{st + c - 1}", EXPORT], stdout=subprocess.PIPE)
    z, buf, hdr = zlib.decompressobj(-15), b"", None
    while True:
        b = proc.stdout.read(1 << 20)
        final = not b
        buf += z.flush() if final else z.decompress(b)
        lines = buf.split(b"\n")
        buf = b"" if final else lines.pop()
        for line in lines:
            if not line: continue
            cols = line.decode("latin-1").rstrip("\r").split("\t")
            if hdr is None: hdr = cols; continue
            yield dict(zip(hdr, cols))
        if final: break
    if proc.wait() != 0:
        sys.exit(f"Download failed while reading {table}")


def cached(cache, name, build):
    path = os.path.join(cache, name + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    data = build()
    json.dump(data, open(path, "w"))
    return data


def date(s):
    m = re.match(r"(\d+)/(\d+)/(\d+)", s or "")
    return dt.date(int(m[3]), int(m[1]), int(m[2])) if m else None


def money(s):
    try: return float(s or 0)
    except ValueError: return 0.0


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).replace("\xa0", " ").strip()


def person(r, p):
    return re.sub(r"\s+", " ", " ".join(x for x in (r.get(p + "_NAMT"), r.get(p + "_NAMF"), r.get(p + "_NAML"), r.get(p + "_NAMS")) if x)).strip()


def key(name):
    return re.sub(r"[^A-Z0-9]", "", re.sub(r"\(.*?(\)|$)", "", name.upper()))


def name_words(name):
    common = {"SPONSORED", "COMMITTEE", "CALIFORNIA", "CALIFORNIANS", "ISSUES", "WITH", "FROM", "THAT", "COALITION"}
    return {w for w in re.findall(r"[A-Z0-9]+", name.upper()) if len(w) > 3 and w not in common}


def parse_fppc(text):
    """Return ({committee_id: {name, measures:[{id, side}]}}, [{committee, donorId, donor, amount}], last_modified).

    The page's markup varies by committee: link inside bold, bold inside link, names split
    across links, and headings with no link. So each table's committee comes from the text
    between it and the previous table. Exits if a table cannot be tied to a committee.
    """
    modified = re.search(r"Last Modified:\s*([A-Za-z]+ \d+, \d{4})", text).group(1)
    committees, listed = {}, []
    # A few headings have no link of their own but the same name is linked elsewhere on the page.
    anchors = {key(re.sub(r",?\s*#?\s*\d{7}\s*$", "", clean(n))): i for i, n in re.findall(r'Detail\.aspx\?id=(\d+)"[^>]*>(.*?)</a>', text, re.S)}
    for panel in re.split(r'<div class="panel-heading"', text):
        t = re.search(r'<button[^>]*>\s*Prop[a-z]*\.?(?:\s|&nbsp;)+(\d+)\b[^<]*</button>', panel)
        if not t: continue
        measure, side, last = t.group(1), None, 0
        for table in re.finditer(r"<table.*?</table>", panel, re.S):
            head = panel[last:table.start()]
            last = table.end()
            sides = re.findall(r">\s*(Supporting|Opposing)\s*<", head)
            if sides: side = "yes" if sides[-1] == "Supporting" else "no"
            ids = re.findall(r"Detail\.aspx\?id=(\d+)", head)
            label = clean(head[head.rfind("Supporting") + 10 if "Supporting" in head else 0:])
            label = re.sub(r"^.*?(Opposing)\s*", "", label) if "Opposing" in label else label
            label = re.sub(r"^[^A-Za-z]+", "", label)
            found = re.search(r"#?\b(\d{7})\s*$", label)
            cid = ids[-1] if ids else found.group(1) if found else anchors.get(key(label))
            if not cid or not side:
                sys.exit(f"Prop {measure}: cannot identify committee for table after: {label[:120]!r}")
            linked = " ".join(clean(n) for i, n in re.findall(r'Detail\.aspx\?id=(\d+)"[^>]*>(.*?)</a>', head, re.S) if i == cid)
            name = re.sub(r",?\s*#?\s*\d{7}\s*$", "", linked or label).strip()
            c = committees.setdefault(cid, {"name": name, "measures": []})
            entry = {"id": measure, "side": side}
            if entry not in c["measures"]: c["measures"].append(entry)
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table.group(0), re.S):
                cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
                if len(cells) >= 4 and re.match(r"\s*\d+\s*$", clean(cells[0])):
                    link = re.search(r"Detail\.aspx\?id=(\d+)", cells[1])
                    amt = re.sub(r"[^0-9.]", "", clean(cells[3]))
                    donor = re.sub(r"\s*Top Donors? to Contributor.*$", "", clean(cells[1]))
                    listed.append({"committee": cid, "donorId": link.group(1) if link else None, "donor": donor, "amount": float(amt) if amt else 0.0})
    return committees, listed, modified


def pick_filings(cover, filer):
    """Latest amendment of each F460 since SINCE; drop any period overlapped by a newer filing."""
    latest = {}
    for r in cover:
        if r["FILER_ID"] != filer or r["FORM_TYPE"] != "F460": continue
        frm, thru = date(r["FROM_DATE"]), date(r["THRU_DATE"])
        if not frm or not thru or frm < SINCE: continue
        if r["FILING_ID"] not in latest or int(r["AMEND_ID"]) > int(latest[r["FILING_ID"]]["AMEND_ID"]):
            latest[r["FILING_ID"]] = r
    kept, dropped = [], []
    for r in sorted(latest.values(), key=lambda r: (date(r["RPT_DATE"]) or SINCE, int(r["FILING_ID"])), reverse=True):
        a, b = date(r["FROM_DATE"]), date(r["THRU_DATE"])
        if any(a <= date(k["THRU_DATE"]) and date(k["FROM_DATE"]) <= b for k in kept):
            dropped.append(r["FILING_ID"])
        else:
            kept.append(r)
    return kept, dropped


class Tally:
    """Totals per party. Rows with a committee id group by id; a same-named row without one joins it."""
    FIELDS = ("cash", "noncash", "loan", "late", "stock")

    def __init__(self):
        self.rows = {}
        self.named = {}

    def add(self, name, cid, entity, field, amount, stock=False, measure=None):
        k = f"id:{cid}" if cid else f"n:{key(name)}"
        r = self.rows.setdefault(k, {"cash": 0.0, "noncash": 0.0, "loan": 0.0, "late": 0.0, "stock": 0.0, "name": "", "names": set(), "id": None, "entity": "", "measure": None})
        r[field] += amount
        if stock: r["stock"] += amount
        if name:
            r["names"].add(key(name))
            r["name"] = name     # Filings are read oldest to newest where order matters; shown as filed.
        if cid: r["id"] = cid
        if entity: r["entity"] = entity
        if measure: r["measure"] = measure

    def ranked(self):
        for k, r in list(self.rows.items()):
            if r["id"]:
                for n in r["names"]: self.named[n] = k
        for k, r in list(self.rows.items()):
            target = self.named.get(k[2:]) if k.startswith("n:") else None
            if target:
                for f in self.FIELDS: self.rows[target][f] += r[f]
                del self.rows[k]
        for r in self.rows.values():
            r["loan"] = max(r["loan"], 0.0)     # A repayment does not reduce what a donor contributed.
        # Positive only: a negative row is a refund of money from before the window.
        out = [r for r in self.rows.values() if round(r["cash"] + r["noncash"] + r["loan"] + r["late"], 2) > 0]
        return sorted(out, key=lambda r: -(r["cash"] + r["noncash"] + r["loan"] + r["late"]))


def party(r, known_ids):
    """Public fields only: name, amounts, and kind. Never addresses, employers, or occupations."""
    entity = r["entity"]
    kind = "person" if entity == "IND" else "committee" if entity in COMMITTEE_ENTITIES else "organization"
    out = {"name": r["name"], "total": round(r["cash"] + r["noncash"] + r["loan"] + r["late"], 2), "kind": kind}
    if r["id"] in known_ids: out["id"] = r["id"]     # Filers can mistype ids; only keep ones Cal-Access knows.
    if r["noncash"]: out["noncash"] = round(r["noncash"], 2)
    if r["stock"]: out["stock"] = round(r["stock"], 2)
    if r["loan"]: out["loan"] = round(r["loan"], 2)
    if r["late"]: out["late"] = round(r["late"], 2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="Directory for downloaded table extracts")
    ap.add_argument("--out", default="data/2026-11-03/committees.json")
    ap.add_argument("--report", help="Write the reconciliation and FPPC comparison here")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)

    fppc_html = curl(FPPC).decode("utf8", "replace")
    measure_committees, fppc_rows, fppc_date = parse_fppc(fppc_html)
    print(f"FPPC ({fppc_date}): {len(measure_committees)} measure committees, {len(fppc_rows)} listed donors")

    directory, modified = zip_directory()
    print("Export last modified:", modified)
    export_date = dt.datetime.strptime(modified.strip(), "%a, %d %b %Y %H:%M:%S %Z").date()

    xref = cached(a.cache, "xref-" + hashlib.sha256(modified.encode()).hexdigest()[:16], lambda: {r["FILER_ID"]: r["XREF_ID"] for r in stream_rows(directory, "FILER_XREF_CD") if r.get("XREF_ID")})
    public = {}                                   # legacy id -> public id
    for pub, leg in xref.items():
        if leg != pub: public[leg] = pub
    to_public = lambda i: public.get(i, i) if i else None
    known_ids = set(xref)

    # First hop: every measure committee; second hop: committees FPPC lists as $1M+ donors to them.
    profiled = set(measure_committees)
    for r in fppc_rows:
        if r["donorId"] and r["amount"] >= FOLLOW_MIN: profiled.add(r["donorId"])
    filer_ids = {xref.get(i, i) for i in profiled} | profiled
    print(f"Profiling {len(profiled)} committees")

    # Cached extracts hold only these committees from this export. Anything else must not reuse them:
    # a stale cache once dropped the main Prop 3 committee without any error.
    stamp = hashlib.sha256((modified + ",".join(sorted(filer_ids))).encode()).hexdigest()[:16]
    a.cache = os.path.join(a.cache, stamp)
    os.makedirs(a.cache, exist_ok=True)

    def cover_rows():
        return [r for r in stream_rows(directory, "CVR_CAMPAIGN_DISCLOSURE_CD") if r["FILER_ID"] in filer_ids and (date(r["THRU_DATE"]) or date(r["RPT_DATE"]) or SINCE) >= SINCE]
    cover = cached(a.cache, "cover", cover_rows)
    filings = {r["FILING_ID"] for r in cover}

    tables = {}
    for t in ("RCPT_CD", "EXPN_CD", "S497_CD", "SMRY_CD", "LOAN_CD"):
        tables[t] = cached(a.cache, t, lambda: [r for r in stream_rows(directory, t) if r["FILING_ID"] in filings])
        print(t, len(tables[t]))

    by_filing = {t: collections.defaultdict(list) for t in tables}
    for t, rows in tables.items():
        for r in rows: by_filing[t][(r["FILING_ID"], r["AMEND_ID"])].append(r)

    latest_any = {}
    for r in cover:
        if r["FILING_ID"] not in latest_any or int(r["AMEND_ID"]) > int(latest_any[r["FILING_ID"]]["AMEND_ID"]):
            latest_any[r["FILING_ID"]] = r

    result, problems, notes, report = {}, [], [], []
    newest = None
    for pub in sorted(profiled, key=int):
        filer = xref.get(pub, pub)
        filer_rows = filer if any(r["FILER_ID"] == filer for r in cover) else pub
        kept, dropped = pick_filings(cover, filer_rows)
        if not kept:
            notes.append(f"{pub}: no Form 460 since {SINCE} (often a major donor); linked to Cal-Access only")
            continue
        donors, gave = Tally(), Tally()
        itemized = noncash_itemized = sched_a = unitemized = sched_c = loans = loan_rows = 0.0
        name = kept[0]["FILER_NAML"]
        for f in kept:
            k = (f["FILING_ID"], f["AMEND_ID"])
            for r in by_filing["RCPT_CD"][k]:
                if r["FORM_TYPE"] not in ("A", "C") or r["MEMO_CODE"]: continue   # Memo rows are not counted in totals.
                amt, who, cid = money(r["AMOUNT"]), person(r, "CTRIB"), to_public(r["CMTE_ID"])
                if r["FORM_TYPE"] == "A":
                    itemized += amt
                    donors.add(who, cid, r["ENTITY_CD"], "cash", amt)
                else:
                    noncash_itemized += amt
                    donors.add(who, cid, r["ENTITY_CD"], "noncash", amt, stock=bool(re.search(r"\b(STOCK|SHARES?|SECURIT)", r["CTRIB_DSCR"], re.I)))
            for r in by_filing["LOAN_CD"][k]:
                if r["FORM_TYPE"] != "B1" or r["MEMO_CODE"]: continue
                # Net change in what is owed (closing minus opening balance), so repaid loans drop out.
                amt = money(r["LOAN_AMT2"]) - money(r["LOAN_AMT4"])
                loan_rows += amt
                donors.add(person(r, "LNDR"), to_public(r["CMTE_ID"]), r["ENTITY_CD"], "loan", amt)
            sched_e = {}
            for r in by_filing["EXPN_CD"][k]:
                if r["FORM_TYPE"] == "E" and r["CMTE_ID"]:
                    sched_e[r["TRAN_ID"]] = r
            for r in by_filing["EXPN_CD"][k]:
                if r["FORM_TYPE"] != "D" or r["EXPN_CODE"] not in ("MON", "IKD") or r["MEMO_CODE"]: continue
                amt = money(r["AMOUNT"])
                who, cid = person(r, "PAYEE"), to_public(r["CMTE_ID"])
                measure = r["BAL_NAME"].strip() or None
                if not who and not cid:     # Schedule D can leave this blank; the same TRAN_ID on Schedule E names it.
                    match = sched_e.get(r["TRAN_ID"])
                    if match: who, cid = person(match, "PAYEE"), to_public(match["CMTE_ID"])
                if not who and not cid:
                    verb = "opposing" if r["SUP_OPP_CD"] == "O" else "supporting"
                    what = "In-kind spending" if r["EXPN_CODE"] == "IKD" else "Contribution"
                    who = f"{what} {verb}: {measure}" if measure else "Recipient not named in this schedule"
                gave.add(who, cid, r["ENTITY_CD"], "noncash" if r["EXPN_CODE"] == "IKD" else "cash", amt, measure=measure)
            for r in by_filing["SMRY_CD"][k]:
                if r["FORM_TYPE"] == "A" and r["LINE_ITEM"] == "1": sched_a += money(r["AMOUNT_A"])
                if r["FORM_TYPE"] == "A" and r["LINE_ITEM"] == "2": unitemized += money(r["AMOUNT_A"])
                if r["FORM_TYPE"] == "C" and r["LINE_ITEM"] == "3": sched_c += money(r["AMOUNT_A"])
                if r["FORM_TYPE"] == "F460" and r["LINE_ITEM"] == "2": loans += money(r["AMOUNT_A"])

        thru = max(date(f["THRU_DATE"]) for f in kept)
        late_in = late_out = 0.0
        seen = set()
        for f in latest_any.values():
            if f["FILER_ID"] != filer_rows or f["FORM_TYPE"] != "F497": continue
            for r in by_filing["S497_CD"][(f["FILING_ID"], f["AMEND_ID"])]:
                d = date(r["CTRIB_DATE"])
                if not d or d <= thru or r["MEMO_CODE"]: continue
                if d > export_date:
                    notes.append(f"{pub}: late report dated in the future ignored: {r['ENTY_NAML']} {d} {r['AMOUNT']}")
                    continue
                who, amt, cid = person(r, "ENTY"), money(r["AMOUNT"]), to_public(r["CMTE_ID"])
                mark = (r["FORM_TYPE"], key(who), d, amt)
                if mark in seen:      # The same gift listed in a second late report.
                    report.append(f"{pub}: duplicate late report ignored: {who} {d} {amt}")
                    continue
                seen.add(mark)
                newest = max(newest or d, d)
                if r["FORM_TYPE"] == "F497P1":
                    late_in += amt
                    donors.add(who, cid, r["ENTITY_CD"], "late", amt)
                elif r["FORM_TYPE"] == "F497P2":
                    late_out += amt
                    gave.add(who, cid, r["ENTITY_CD"], "late", amt)

        # Itemized rows must match the committee's own schedule totals. Gifts under $100
        # are reported only as a lump sum, so they are shown separately, never as a gap.
        filed = sched_a + sched_c
        gap = (sched_a - itemized) + (sched_c - noncash_itemized)
        total_filed = filed + unitemized + loans
        ok = abs(sched_a - itemized) + abs(sched_c - noncash_itemized) + abs(loans - loan_rows) <= max(RECONCILE_TOLERANCE * total_filed, 1000)
        report.append(f"{pub} {name[:50]!r}: filings={len(kept)} dropped={dropped} thru={thru} schedA={sched_a:,.2f}/{itemized:,.2f} schedC={sched_c:,.2f}/{noncash_itemized:,.2f} loans={loans:,.2f}/{loan_rows:,.2f} unitemized={unitemized:,.2f} gap={gap:,.2f} {'OK' if ok else 'FAIL'}")
        if not ok:
            problems.append(f"{pub} {name}: itemized rows do not match filed schedule totals ; left out")
            continue

        # FPPC's links can point at the wrong committee, so its name must resemble the filer's.
        info = measure_committees.get(pub)
        if info and not (name_words(info["name"]) & name_words(name)):
            problems.append(f"{pub}: FPPC calls this {info['name']!r} but it files as {name!r}; left out")
            continue

        ranked = donors.ranked()
        recips = gave.ranked()
        top = [party(r, known_ids) for r in ranked[:TOP_DONORS]]
        top_rec = [party(r, known_ids) for r in recips[:TOP_RECIPIENTS]]
        for p, src in zip(top_rec, recips):
            if src["measure"]: p["measure"] = src["measure"]
        out_cash = sum(r["cash"] for r in recips)
        out_noncash = sum(r["noncash"] for r in recips)
        result[pub] = {
            "name": info["name"] if info else name,
            "url": f"https://cal-access.sos.ca.gov/Campaign/Committees/Detail.aspx?id={pub}",
            "measures": info["measures"] if info else [],
            "from": min(date(f["FROM_DATE"]) for f in kept).isoformat(),
            "thru": thru.isoformat(),
            "received": {"itemized": round(itemized, 2), "unitemized": round(unitemized, 2), "noncash": round(noncash_itemized, 2), "loans": round(loans, 2), "late": round(late_in, 2)},
            "gave": {"cash": round(out_cash, 2), "noncash": round(out_noncash, 2), "late": round(late_out, 2)},
            "donors": top, "donorCount": len(ranked),
            "recipients": top_rec, "recipientCount": len(recips),
        }

    # Names come from the filing. FPPC's links are occasionally wrong (it has pointed one donor's
    # name at another committee's id), so its spelling is used only when the name is the same.
    for r in fppc_rows:
        c = result.get(r["donorId"])
        if c and r["donorId"] not in measure_committees and key(r["donor"]) == key(c["name"]): c["name"] = r["donor"]
    by_name = {key(c["name"]): pub for pub, c in result.items()}
    for c in result.values():
        for p in c["donors"] + c["recipients"]:
            if "id" not in p and key(p["name"]) in by_name: p["id"] = by_name[key(p["name"])]
            if p.get("id") in result: p["name"] = result[p["id"]]["name"]

    # Compare with FPPC. Ours should match or exceed FPPC because the export can be newer.
    compare, seen_pairs = [], set()
    for r in fppc_rows:
        c = result.get(r["committee"])
        pair = (r["committee"], r["donorId"] or key(r["donor"]))
        if not c or not r["amount"] or pair in seen_pairs: continue
        seen_pairs.add(pair)
        hit = next((d for d in c["donors"] if r["donorId"] and d.get("id") == r["donorId"]), None) \
            or next((d for d in c["donors"] if key(d["name"]) == key(r["donor"])), None)
        if hit:
            compare.append(((hit["total"] - r["amount"]) / r["amount"], r["committee"], r["donor"][:50], r["amount"], hit["total"], hit.get("late", 0)))
        else:
            report.append(f"not in our top 10: {r['committee']} {r['donor'][:60]!r} FPPC={r['amount']:,.2f}")
    below = [x for x in compare if x[0] < -0.0005]
    report.append(f"\nFPPC comparison: {len(compare)} donors matched; {sum(1 for x in compare if abs(x[0]) < 0.0005)} within 0.05%; {len(below)} lower than FPPC")
    for share, cid, donor, fppc, ours, late in sorted(compare, key=lambda x: x[0]):
        if abs(share) >= 0.0005:
            report.append(f"  {share:+8.2%} {cid} {donor!r} FPPC={fppc:,.2f} ours={ours:,.2f} late={late:,.2f}")

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    data = {
        "exportDate": export_date.isoformat(),
        "latestLate": newest.isoformat() if newest else None,
        "since": SINCE.isoformat(),
        "committees": result,
    }
    with open(a.out, "w") as f:
        json.dump(data, f, indent=1)
        f.write("\n")
    if a.report:
        open(a.report, "w").write("\n".join(report + ["\nPROBLEMS"] + problems + ["\nNOTES"] + notes) + "\n")
    print(f"Wrote {a.out}: {len(result)} committees; {len(problems)} left out")
    for p in problems: print("  ", p)
    print(f"{len(notes)} donors have no Form 460 and link to Cal-Access only")


if __name__ == "__main__":
    main()
