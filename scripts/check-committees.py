#!/usr/bin/env python3
"""Decide whether a freshly built committees.json is safe to publish without a person.

Usage: check-committees.py <current committees.json> <new committees.json> <build report>
Lists new committees, then exits 0 and prints PASS only if every check holds. Otherwise lists each failure and exits 1.
This replaces the hand review of the build report for unattended runs, so it stops on
anything it cannot explain rather than trying to judge it.
"""
import datetime as dt, json, re, sys

MAX_DROP = 0.10         # Largest allowed fall in a committee's total. Totals mostly only grow.
MAX_LOWER = 0.01        # Below FPPC by more than this needs an explanation in KNOWN_LOWER.

# Lower than FPPC for a reason already traced by hand, as (committee id, start of FPPC donor name).
KNOWN_LOWER = {
    ("1493991", "The Tribal Council"),          # FPPC typo: "$2,000,0000" for $2M.
    ("1353866", "Building Industry Assocation"),  # FPPC combines two San Diego BIA committees.
    ("1492264", "Members' Voice"),              # FPPC combines with State Building Trades.
    ("1485847", "Michelson Center"),            # Filings put $8.2M under Gary K. Michelson's id.
    ("1481256", "Homeownership for Families"),  # FPPC combines with Realtors Issues PAC.
    ("1489007", "ACLU of Nothern California"),  # FPPC combines ACLU committees.
    ("1481256", "United Brotherhood"),          # FPPC combines with a Carpenters affiliate.
    ("1483562", "PACE of California School"),   # FPPC combines with its parent union: $1.6M + $1M.
}


def received(c):
    r = c["received"]
    return r["itemized"] + r["unitemized"] + r["noncash"] + max(r["loans"], 0) + r["late"]


def check(old, new, report):
    fail = []
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if not new["exportDate"] > old["exportDate"]:
        fail.append(f"export {new['exportDate']} is not newer than {old['exportDate']}")
    if new["exportDate"] > today or (new.get("latestLate") or "") > today:
        fail.append(f"future date: export {new['exportDate']}, late {new.get('latestLate')}")
    if (new.get("latestLate") or "") < (old.get("latestLate") or ""):
        fail.append(f"latest late report went backward: {new.get('latestLate')}")

    a, b = old["committees"], new["committees"]
    for cid, c in a.items():
        if cid not in b:
            fail.append(f"{cid} {c['name'][:50]}: committee disappeared")
            continue
        n = b[cid]
        if n["name"] != c["name"]:
            fail.append(f"{cid}: name changed from {c['name'][:50]!r} to {n['name'][:50]!r}")
        if n["measures"] != c["measures"]:
            fail.append(f"{cid} {c['name'][:50]}: measures changed {c['measures']} to {n['measures']}")
        was, now = received(c), received(n)
        if was and now < was * (1 - MAX_DROP):
            fail.append(f"{cid} {c['name'][:50]}: received fell from {was:,.0f} to {now:,.0f}")
    # A committee the build left out only stops publishing if it was already published ("disappeared"
    # above) or is a measure's own committee. A donor committee can stay as a link to Cal-Access.
    problems = report.split("\nPROBLEMS\n")[-1].split("\nNOTES\n")[0].strip() if "\nPROBLEMS\n" in report else None
    if problems is None:
        fail.append("PROBLEMS section missing from report")
    for line in (problems or "").splitlines():
        if "FPPC calls this" in line:
            fail.append(f"build problem: {line[:300]}")

    lines = re.findall(r"^\s*([+-][\d.]+)%\s+(\d+)\s+['\"](.*?)['\"]\s+FPPC=", report, re.M)
    if "FPPC comparison:" not in report:
        fail.append("FPPC comparison missing from report")
    for share, cid, donor in lines:
        if float(share) / 100 < -MAX_LOWER and not any(cid == k and donor.startswith(p) for k, p in KNOWN_LOWER):
            fail.append(f"{cid} {donor[:50]!r} is {share}% against FPPC with no known reason")
    return fail


def main():
    old, new = (json.load(open(p)) for p in sys.argv[1:3])
    fail = check(old, new, open(sys.argv[3]).read())
    added = new["committees"].keys() - old["committees"].keys()
    for cid in sorted(added):
        print(f"New committee: {cid} {new['committees'][cid]['name'][:70]}")
    if fail:
        print(f"STOP: {len(fail)} check(s) failed; do not publish.")
        for f in fail:
            print(" -", f)
        sys.exit(1)
    print(f"PASS: {len(new['committees'])} committees, export {new['exportDate']}, late reports through {new['latestLate']}")


if __name__ == "__main__":
    main()
