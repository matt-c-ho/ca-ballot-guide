#!/usr/bin/env python3
"""Update data/<election>/results.json from official sources.

  python3 scripts/fetch-results.py                 # statewide props from the Secretary of State feed
  python3 scripts/fetch-results.py --local O=41250,19870 --source "Santa Clara County Registrar of Voters" \
      --source-url https://... --as-of "Nov 4, 5:00 p.m."   # enter a local measure by hand

State results: https://api.sos.ca.gov/returns/ballot-measures. Before Election Day that feed
serves test data, so this refuses any report stamped before polls close. It also refuses a
report that is incomplete, inconsistent, older than the one published, or where a measure
lost votes, and leaves the file unchanged. Exit code 0 = updated, 3 = nothing new, 1 = refused.

Outcomes are only "leading" or "trailing". Switch to "passed"/"failed" by hand after
certification (counties by Dec 3, 2026; Secretary of State by Dec 11, 2026).
Local entries are kept as they are when the state results are refreshed.
"""
import argparse, datetime as dt, json, re, subprocess, sys

FEED = "https://api.sos.ca.gov/returns/ballot-measures"
OFFICIAL = "https://electionresults.sos.ca.gov/returns/ballot-measures"
DIR = "data/2026-11-03"


def load(name):
    return json.load(open(f"{DIR}/{name}", encoding="utf8"))


def polls_close(election):
    h, m = (election.get("pollsClose") or "20:00").split(":")
    return dt.datetime.fromisoformat(election["date"]).replace(hour=int(h), minute=int(m))


def parse_time(s):
    """'November 3, 2026, 8:33 p.m.' (Pacific time) -> naive datetime."""
    m = re.match(r"([A-Za-z]+ \d+, \d{4}),\s*(\d+):(\d+)\s*([ap])\.?m\.?", s.strip(), re.I)
    if not m:
        raise ValueError(f"unrecognised report time {s!r}")
    d = dt.datetime.strptime(m[1], "%B %d, %Y")
    hour = int(m[2]) % 12 + (12 if m[4].lower() == "p" else 0)
    return d.replace(hour=hour, minute=int(m[3]))


def outcome(yes, no, need):
    total = yes + no
    if not total:
        return None
    share = 100 * yes / total
    wins = yes > no if need <= 50 else share >= need
    return "leading" if wins else "trailing"


def entry(yes, no, need):
    total = yes + no
    return {"yes": yes, "no": no, "yesPct": round(100 * yes / total, 1), "noPct": round(100 * no / total, 1),
            "outcome": outcome(yes, no, need), "final": False}


def refuse(msg):
    print(f"REFUSED: {msg}. results.json left unchanged.")
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="append", default=[], metavar="ID=YES,NO", help="enter a local measure by hand")
    ap.add_argument("--source", help="who published the --local figures")
    ap.add_argument("--source-url", help="where the --local figures were published")
    ap.add_argument("--as-of", help="when the --local figures were published, as shown on the source")
    a = ap.parse_args()

    election = load("election.json")
    measures = {}
    for j in election["jurisdictions"]:
        for m in load(j["file"]):
            measures[m["id"]] = (j["id"], m.get("passPct") or 50)
    state_ids = {k for k, (j, _) in measures.items() if j == "ca"}
    results = load("results.json")
    old = dict(results.get("measures") or {})

    if a.local:
        if not (a.source and a.source_url and a.as_of):
            refuse("--local needs --source, --source-url and --as-of so the page can say where the figures came from")
        for item in a.local:
            m = re.fullmatch(r"([A-Za-z0-9]+)=(\d+),(\d+)", item.replace(" ", ""))
            if not m or m[1] not in measures or m[1] in state_ids:
                refuse(f"{item!r} is not ID=YES,NO for a local measure ({', '.join(sorted(set(measures) - state_ids))})")
            e = entry(int(m[2]), int(m[3]), measures[m[1]][1])
            e.update(source=a.source, sourceUrl=a.source_url, updated=a.as_of)
            results["measures"][m[1]] = e
            print(f"{m[1]}: {e['yesPct']}% yes ({e['yes']:,} / {e['no']:,}), {e['outcome']}")
    else:
        raw = subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", "-A", "Mozilla/5.0", FEED], capture_output=True)
        if raw.returncode:
            refuse(f"could not fetch {FEED}: {raw.stderr.decode()[:200]}")
        feed = json.loads(raw.stdout)
        when = parse_time(feed.get("ReportingTime", ""))
        if when < polls_close(election):
            refuse(f"report time {feed['ReportingTime']} is before polls close, so it may be test data")
        if old and results.get("reportTime") and when < dt.datetime.fromisoformat(results["reportTime"]):
            refuse(f"report time {feed['ReportingTime']} is older than the published {results['reportTime']}")
        if results.get("reportTime") == when.isoformat():
            print(f"No change: still the report of {feed['ReportingTime']}.")
            sys.exit(3)
        rows = {str(int(r["Number"])): r for r in feed.get("ballot-measures", [])}
        if set(rows) != state_ids:
            refuse(f"feed lists propositions {sorted(rows, key=int)}, expected {sorted(state_ids, key=int)}")
        new = {}
        for pid, r in rows.items():
            yes, no = int(r["yesVotes"]), int(r["noVotes"])
            e = entry(yes, no, measures[pid][1])
            if abs(e["yesPct"] - float(r["yesPercent"])) > 0.15:
                refuse(f"Prop {pid}: feed says {r['yesPercent']}% yes but its counts give {e['yesPct']}%")
            was = old.get(pid)
            if was and was.get("yes") is not None and yes + no < (was["yes"] + was["no"]) * 0.99:
                refuse(f"Prop {pid}: total votes fell from {was['yes'] + was['no']:,} to {yes + no:,}")
            new[pid] = e
        for pid, e in new.items():
            was = old.get(pid)
            flip = f" (was {was['outcome']})" if was and was.get("outcome") != e["outcome"] else ""
            print(f"Prop {pid}: {e['yesPct']}% yes, {e['outcome']}{flip}")
            results["measures"][pid] = e
        results.update(status="partial", reportTime=when.isoformat(),
                       updated=f"{feed['ReportingTime']} PT · {feed.get('Reporting', '').strip()}",
                       source="California Secretary of State, semi-official results", sourceUrl=OFFICIAL)

    with open(f"{DIR}/results.json", "w", encoding="utf8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Updated results.json")


if __name__ == "__main__":
    main()
