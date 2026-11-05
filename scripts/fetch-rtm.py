#!/usr/bin/env python3
"""Combine Measure RTM results from the five counties' official results.

  python3 scripts/fetch-rtm.py
      Fetch Alameda, San Francisco and San Mateo from their official results pages.
  python3 scripts/fetch-rtm.py --county "Santa Clara=812345,690123" --as-of "Nov 5, 2026 5:00 PM" \
      --source-url https://vote.santaclaracounty.gov/...
      Enter a county by hand from its official results page.

Contra Costa and Santa Clara block automated requests, so they are entered by hand. Each
county's latest figures are kept in data/2026-11-03/rtm-counties.json. RTM passes on the
combined vote of all five counties, so results.json gets an RTM entry only once all five
are present, and that entry lists each county with its own update time.

Refuses (leaving both files unchanged) if a page can't be parsed or a county's total vote
falls. Exit 0 = updated, 3 = nothing new, 1 = refused.
"""
import argparse, csv, datetime as dt, html, io, json, re, subprocess, sys

DIR = "data/2026-11-03"
COUNTIES = ["Alameda", "Contra Costa", "San Francisco", "San Mateo", "Santa Clara"]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
PAGES = {
    "Alameda": "https://www.alamedacountyca.gov/rovresults/260/",
    "San Francisco": "https://www.sfelections.org/results/20261103/",
    # Linked as "Results on CSV" from https://smcacre.gov/elections/november-3-2026-election-results.
    "San Mateo": "https://smcacre.gov/media/9143/download?attachment",
}
RESULTS_PAGE = {
    "Alameda": PAGES["Alameda"],
    "San Francisco": PAGES["San Francisco"],
    "San Mateo": "https://smcacre.gov/elections/november-3-2026-election-results",
    "Contra Costa": "https://www.contracosta.ca.gov/7761/Election-Results",
    "Santa Clara": "https://vote.santaclaracounty.gov/elections",
}


class Refused(Exception):
    pass


def get(url):
    r = subprocess.run(["curl", "-sS", "-L", "--fail", "--max-time", "90", "-A", UA, url], capture_output=True)
    if r.returncode:
        raise Refused(f"could not fetch {url}: {r.stderr.decode()[:200].strip()}")
    return r.stdout.decode("utf8", "replace")


def text(page):
    page = re.sub(r"<(script|style).*?</\1>", " ", page, flags=re.S | re.I)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))


def num(s):
    return int(s.replace(",", ""))


def when(s, fmt):
    try:
        return dt.datetime.strptime(re.sub(r"\s+", " ", s.strip()), fmt)
    except ValueError:
        raise Refused(f"unrecognised update time {s!r}")


def alameda():
    t = text(get(PAGES["Alameda"]))
    m = re.search(r"Measure RTM\b.{0,400}?Yes ([\d,]+) [\d.]+ ?% No ([\d,]+) [\d.]+ ?%", t)
    u = re.search(r"Last Updated:\s*\w+,\s*(\w+ \d{1,2}, \d{4});\s*(\d{1,2}:\d\d [AP]M)", t)
    if not m or not u:
        raise Refused("Alameda: RTM totals or update time not found on the results page")
    return num(m[1]), num(m[2]), when(f"{u[1]} {u[2]}", "%B %d, %Y %I:%M %p")


def san_francisco():
    t = text(get(PAGES["San Francisco"]))
    i = t.find("MEASURE RTM - REGIONAL")
    m = re.search(r"YES ([\d,]+) [\d.]+% NO ([\d,]+) [\d.]+% Total", t[i:i + 3000]) if i >= 0 else None
    u = re.search(r"(\w+ \d{1,2}, \d{4} \d{1,2}:\d\d [AP]M)\s+XML\s+Next Update", t)
    if not m or not u:
        raise Refused("San Francisco: RTM totals or update time not found on the results page")
    return num(m[1]), num(m[2]), when(u[1], "%B %d, %Y %I:%M %p")


def san_mateo():
    rows = list(csv.reader(io.StringIO(get(PAGES["San Mateo"]))))
    h = rows[0]
    try:
        title, name, votes = h.index("Contest_title"), h.index("candidate_name"), h.index("total_votes")
    except ValueError:
        raise Refused("San Mateo: CSV columns changed")
    yes = no = n = 0
    for r in rows[1:]:
        if len(r) > votes and r[title].startswith("Regional Transit Measure"):
            n += 1
            if r[name].upper() == "YES": yes += int(r[votes] or 0)
            elif r[name].upper() == "NO": no += int(r[votes] or 0)
    if not n:
        raise Refused("San Mateo: no Regional Transit Measure rows in the CSV")
    # The CSV has no timestamp of its own; its results portal shows the matching update time.
    portal = text(get("https://www.livevoterturnout.com/ENR/sanmateocaenr/20/en/Y3Mvf_Index_20.html"))
    u = re.search(r"Updated:\s*(\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d\d:\d\d [AP]M)", portal)
    p = re.search(r"Regional Transit Measure \(Majority Approval Required\) \(VOTE FOR 1\).{0,200}?YES YES ([\d,]+) [\d.]+% NO NO ([\d,]+)", portal)
    if not u or not p:
        raise Refused("San Mateo: update time or RTM totals not found on the county's results portal")
    if (num(p[1]), num(p[2])) != (yes, no):
        raise Refused(f"San Mateo: CSV ({yes:,}/{no:,}) and results portal ({p[1]}/{p[2]}) disagree; try again later")
    return yes, no, when(u[1], "%m/%d/%Y %I:%M:%S %p")


FETCHERS = {"Alameda": alameda, "San Francisco": san_francisco, "San Mateo": san_mateo}


def label(t):
    return t.strftime("%b %-d, %-I:%M %p").replace("AM", "a.m.").replace("PM", "p.m.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", action="append", default=[], metavar="NAME=YES,NO")
    ap.add_argument("--as-of", help='update time shown on the county page, e.g. "Nov 5, 2026 5:00 PM"')
    ap.add_argument("--source-url", help="the county results page the figures came from")
    a = ap.parse_args()

    path = f"{DIR}/rtm-counties.json"
    try:
        store = json.load(open(path, encoding="utf8"))
    except FileNotFoundError:
        store = {}
    before = json.dumps(store, sort_keys=True)
    notes, fresh = [], {}

    try:
        if a.county:
            if not (a.as_of and a.source_url and a.source_url.startswith("https://")):
                raise Refused("--county needs --as-of and an https --source-url")
            t = None
            for f in ("%b %d, %Y %I:%M %p", "%B %d, %Y %I:%M %p"):
                try: t = dt.datetime.strptime(a.as_of, f); break
                except ValueError: pass
            if not t:
                raise Refused(f'--as-of must look like "Nov 5, 2026 5:00 PM", not {a.as_of!r}')
            for item in a.county:
                m = re.fullmatch(r"\s*([A-Za-z ]+?)\s*=\s*([\d,]+)\s*,\s*([\d,]+)\s*", item)
                if not m or m[1] not in COUNTIES:
                    raise Refused(f"{item!r} must be COUNTY=YES,NO with COUNTY one of {', '.join(COUNTIES)}")
                fresh[m[1]] = (num(m[2]), num(m[3]), t, a.source_url, "entered by hand")
        else:
            for county, fetch in FETCHERS.items():
                try:
                    yes, no, t = fetch()
                    fresh[county] = (yes, no, t, RESULTS_PAGE[county], "fetched")
                except Refused as e:
                    notes.append(f"{e} (kept previous figures)")

        for county, (yes, no, t, url, how) in fresh.items():
            old = store.get(county)
            if old and yes + no < (old["yes"] + old["no"]) * 0.99:
                raise Refused(f"{county}: total votes fell from {old['yes'] + old['no']:,} to {yes + no:,}")
            if old and old["asOf"] > t.isoformat():
                raise Refused(f"{county}: update time {t} is older than the stored {old['asOf']}")
            store[county] = {"yes": yes, "no": no, "asOf": t.isoformat(), "sourceUrl": url, "how": how}
    except Refused as e:
        print(f"REFUSED: {e}. Files left unchanged.")
        sys.exit(1)

    for n in notes: print("NOTE:", n)
    for county in COUNTIES:
        c = store.get(county)
        print(f"{county}: " + (f"{c['yes']:,} yes, {c['no']:,} no, as of {c['asOf']} ({c['how']})" if c else "missing"))

    missing = [c for c in COUNTIES if c not in store]
    results = json.load(open(f"{DIR}/results.json", encoding="utf8"))
    if not missing:
        yes = sum(store[c]["yes"] for c in COUNTIES)
        no = sum(store[c]["no"] for c in COUNTIES)
        oldest = min(store[c]["asOf"] for c in COUNTIES)
        results["measures"]["RTM"] = {
            "yes": yes, "no": no, "yesPct": round(100 * yes / (yes + no), 1), "noPct": round(100 * no / (yes + no), 1),
            "outcome": "leading" if yes > no else "trailing", "final": False,
            "source": "Sum of the five counties' official results", "sourceUrl": "",
            "updated": f"{label(dt.datetime.fromisoformat(oldest))} to {label(dt.datetime.fromisoformat(max(store[c]['asOf'] for c in COUNTIES)))} PT, varying by county",
            "counties": [{"name": c, "yes": store[c]["yes"], "no": store[c]["no"], "asOf": label(dt.datetime.fromisoformat(store[c]["asOf"])),
                          "sourceUrl": store[c]["sourceUrl"]} for c in COUNTIES],
        }
        print(f"RTM combined: {yes:,} yes, {no:,} no ({results['measures']['RTM']['yesPct']}% yes), {results['measures']['RTM']['outcome']}")
    else:
        print(f"RTM not published: waiting for {', '.join(missing)} (enter with --county)")

    if json.dumps(store, sort_keys=True) == before:
        print("No change.")
        sys.exit(3)
    json.dump(store, open(path, "w", encoding="utf8"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")
    with open(f"{DIR}/results.json", "w", encoding="utf8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Updated.")


if __name__ == "__main__":
    main()
