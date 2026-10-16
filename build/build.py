"""Aggregate out/*.json into the deployable dist/ folder.

dist/data.json      every change in compact form + metadata (filtering is client side)
dist/ranking.json   per-month distinct authored/reviewed changes for every company
dist/community.json, dist/blog.json
dist/stats.md, dist/<company>.csv
"""
import csv
import datetime as dt
import json
import shutil
from collections import defaultdict

from common import INDIVIDUAL, OUT, ROOT, load

DIST = ROOT / "dist"


def readj(name, default):
    p = OUT / name
    return json.loads(p.read_text()) if p.exists() else default


def slim(commits):
    """Compact commits: people become [name, company index, flags, via?].

    flags: 1 = legacy, 2 = committer's own commit (no Author: trailer).
    """
    names, idx = [], {}

    def ci(co):
        if co not in idx:
            idx[co] = len(names)
            names.append(co)
        return idx[co]

    def ppl(lst):
        out = []
        for p in lst:
            row = [p["name"], ci(p["company"]), (1 if p.get("legacy") else 0) | (2 if p.get("self") else 0)]
            if p.get("legacy") and p.get("via"):
                row.append(p["via"])
            out.append(row)
        return out

    rows = [{"h": c["sha"][:12], "d": c["date"], "s": c["subject"], "b": c["branches"],
             "y": c["type"], "a": c["areas"], "A": ppl(c["authors"]), "R": ppl(c["reviewers"]),
             "P": ppl(c["reporters"]), "D": c["discussion"][:1]} for c in commits]
    return names, rows


def main():
    code = readj("commits.json", {"commits": []})
    cfg = load("companies.yml")
    companies = cfg["featured"]
    tracked = set(companies)
    commits = code["commits"]

    # month -> company -> [authored, reviewed, authored incl. committers' own commits]
    ranking = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    totals = defaultdict(int)
    mine = []
    for c in commits:
        month = c["date"][:7]
        totals[month] += 1
        strict = {p["company"] for p in c["authors"] if not p.get("self")}
        loose = {p["company"] for p in c["authors"]}
        for co in strict:
            ranking[month][co][0] += 1
        for co in loose:
            ranking[month][co][2] += 1
        for co in {p["company"] for p in c["reviewers"]}:
            ranking[month][co][1] += 1
        involved = {p["company"] for r in ("authors", "reviewers", "reporters") for p in c[r]}
        if involved & tracked:
            mine.append(c)

    DIST.mkdir(exist_ok=True)
    for f in (ROOT / "site").iterdir():
        shutil.copy(f, DIST / f.name)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    meta = {"generated_at": now, "head": code.get("head"), "head_date": code.get("head_date"),
            "since": code.get("since"), "master_version": code.get("master_version"),
            "latest_stable": code.get("latest_stable"), "released_max": code.get("released_max"),
            "featured": list(companies), "palette": cfg.get("palette", []),
            "companies": {k: {"color": v["color"],
                              "acquisitions": [{"name": a["name"], "acquired_on": str(a["acquired_on"])}
                                               for a in v.get("acquisitions", [])]}
                          for k, v in companies.items()}}
    co_names, rows = slim(commits)
    (DIST / "data.json").write_text(json.dumps({**meta, "co": co_names, "commits": rows},
                                               separators=(",", ":")))
    (DIST / "ranking.json").write_text(json.dumps(
        {"generated_at": now, "totals": totals, "individual": INDIVIDUAL,
         "credit": "Company labels seeded from Percona-Lab/percona-pg-activity ranking.json",
         "months": {m: dict(v) for m, v in sorted(ranking.items())}}))
    for name in ("community.json", "blog.json"):
        (DIST / name).write_text(json.dumps(readj(name, {})))

    # CSV + Markdown summaries (all data since `since`)
    lines = [f"# Who contributes to PostgreSQL", f"Generated {now}, since {meta['since']}", ""]
    for co in companies:
        rows = [c for c in mine if any(p["company"] == co for r in ("authors", "reviewers") for p in c[r])]
        with open(DIST / f"{co.lower()}.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["date", "subject", "type", "roles", "people", "legacy", "branches", "commit"])
            for c in rows:
                roles = sorted({r[:-1] for r in ("authors", "reviewers") for p in c[r] if p["company"] == co})
                ppl = sorted({p["name"] for r in ("authors", "reviewers") for p in c[r] if p["company"] == co})
                leg = any(p["legacy"] for r in ("authors", "reviewers") for p in c[r] if p["company"] == co)
                w.writerow([c["date"], c["subject"], c["type"], "/".join(roles), "; ".join(ppl), leg,
                            " ".join(map(str, c["branches"])),
                            f"https://github.com/postgres/postgres/commit/{c['sha']}"])
        auth = sum(1 for c in rows if any(p["company"] == co for p in c["authors"]))
        rev = sum(1 for c in rows if any(p["company"] == co for p in c["reviewers"]))
        lines += [f"## {co}", f"- Changes authored: {auth}", f"- Changes reviewed: {rev}", ""]
    rank = defaultdict(int)
    for m in ranking.values():
        for co, (a, _, _) in m.items():
            if co != INDIVIDUAL:
                rank[co] += a
    lines += ["## Companies by changes authored", "", "| # | Company | Authored |", "|---|---|---|"]
    lines += [f"| {i} | {co} | {n} |" for i, (co, n) in
              enumerate(sorted(rank.items(), key=lambda x: -x[1])[:25], 1)]
    (DIST / "stats.md").write_text("\n".join(lines) + "\n")
    print(f"dist/ written: {len(commits)} changes ({len(mine)} featured), "
          f"data.json {(DIST / 'data.json').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
