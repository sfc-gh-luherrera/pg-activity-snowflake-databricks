"""Extract PostgreSQL commits with author/reviewer credit from postgres/postgres.

Usage: python build/code.py [--since YYYY-MM-DD] [--repo pg] [--suggest]
Writes out/commits.json (one record per distinct change, backpatches merged).
"""
import argparse
import datetime as dt
import json
import re
import subprocess
from collections import Counter

import yaml

from common import OUT, ROOT, Attributor, load

SEP = "\x1e"
FIELD = "\x1f"
TRAILER = re.compile(
    r"^(Author|Co-authored-by|Reviewed-by|Reported-by|Discussion|Backpatch-through)"
    r":\s*(.+)$", re.I | re.M)
PERSON = re.compile(r"^\s*(.*?)\s*(?:<([^>]+)>)?\s*$")
TYPES = [
    ("Bug fix", r"\b(fix|fixes|fixed|crash|bug|correct|avoid|prevent|leak)\b"),
    ("Documentation", r"\b(doc|docs|documentation|typo|comment)s?\b"),
    ("Testing", r"\b(test|tests|tap|regress)\b"),
    ("Refactoring", r"\b(refactor|clean ?up|remove unused|simplify|rename)\b"),
]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout


def branches(repo):
    refs = git(repo, "for-each-ref", "--format=%(refname:short)",
               "refs/remotes/origin/").split()
    keep = [r for r in refs if r == "origin/master"
            or re.fullmatch(r"origin/REL_\d+_STABLE", r)]
    keep.sort(key=lambda r: r != "origin/master")  # master first: its date/sha win
    return keep


def branch_label(ref):
    m = re.search(r"REL_(\d+)_STABLE", ref)
    return int(m.group(1)) if m else "master"


def people(values):
    out = []
    for v in values:
        for part in re.split(r",(?![^<]*>)", v):
            m = PERSON.match(part)
            if m and m.group(1):
                out.append((m.group(1).strip(), (m.group(2) or "").strip()))
    return out


def areas_for(paths, rules):
    hits = Counter()
    for p in paths:
        for prefix, label in rules:
            if p.startswith(prefix):
                hits[label] += 1
                break
    return [a for a, _ in hits.most_common(3) if a != "Other"] or ["Other"]


def classify(subject):
    s = subject.lower()
    for label, pat in TYPES:
        if re.search(pat, s):
            return label
    return "Improvement"


def read_commits(repo, ref, since):
    fmt = FIELD.join(["%H", "%aI", "%an", "%ae", "%s", "%b"]) + SEP
    # Stable branches share history with master up to their fork point; only
    # walk commits unique to the branch (backpatches).
    rev = ref if ref == "origin/master" else f"origin/master..{ref}"
    raw = git(repo, "log", rev, f"--since={since}", "--no-merges",
              f"--format={fmt}", "--name-only")
    for chunk in raw.split(SEP):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        # name-only output of the *previous* commit leaks into the head of the
        # next chunk; split on the first field separator to recover it.
        head, _, rest = chunk.partition(FIELD)
        lines = head.split("\n")
        if not rest:  # trailing file list of the last commit
            yield None, "", lines
            continue
        sha = lines[-1]
        yield sha, rest, lines[:-1]


def parse(repo, since):
    rules = load("areas.yml")
    records = {}
    pending_paths = None
    last_key = None
    for ref in branches(repo):
        label = branch_label(ref)
        for sha, rest, prev_paths in read_commits(repo, ref, since):
            if last_key and prev_paths:
                records[last_key]["_paths"].update(p for p in prev_paths if p)
            if sha is None:
                continue
            date_s, an, ae, subject, body = (rest.split(FIELD) + [""] * 5)[:5]
            trailers = {}
            for k, v in TRAILER.findall(body):
                trailers.setdefault(k.lower(), []).append(v.strip())
            discussion = trailers.get("discussion", [])
            key = (subject.strip(), discussion[0] if discussion
                   else "|".join(trailers.get("author", [an])))
            rec = records.get(key)
            if rec is None:
                authors = people(trailers.get("author", []) +
                                 trailers.get("co-authored-by", []))
                self_credit = not authors
                if self_credit:
                    authors = [(an, ae)]
                rec = records[key] = {
                    "sha": sha, "date": date_s[:10], "subject": subject.strip(),
                    "summary": body.split("\n\n")[0].strip()[:600],
                    "committer": an,
                    "authors": authors,
                    "reviewers": people(trailers.get("reviewed-by", [])),
                    "reporters": people(trailers.get("reported-by", [])),
                    "discussion": discussion, "self_credit": self_credit,
                    "branches": [], "_paths": set(),
                }
            if label == "master":
                rec["sha"], rec["date"] = sha, date_s[:10]
            if label not in rec["branches"]:
                rec["branches"].append(label)
            last_key = key
        last_key = None
    for rec in records.values():
        rec["areas"] = areas_for(rec.pop("_paths"), rules)
        rec["type"] = classify(rec["subject"])
    return list(records.values())


def attribute(records):
    att = Attributor()
    for r in records:
        d = dt.date.fromisoformat(r["date"])
        for role in ("authors", "reviewers", "reporters"):
            r[role] = [{"name": n, **att.resolve(n, e, d)} for n, e in r[role]]
        if r["self_credit"]:
            for p in r["authors"]:
                p["self"] = True
    return records


def write_unresolved(records):
    """Queue of names that fell back to Individual contributor, most active first.

    Resolve them by hand (LinkedIn, Sumble, mailing-list signatures) into
    config/people_resolved.yml. Unresolved people stay Individual contributor.
    """
    from common import INDIVIDUAL, _norm
    known = Attributor().people  # anyone already researched is not re-queued
    cnt = Counter()
    for r in records:
        for role in ("authors", "reviewers"):
            for p in r[role]:
                if p["company"] == INDIVIDUAL and _norm(p["name"]) not in known:
                    cnt[p["name"]] += 1
    (OUT / "unresolved.yml").write_text(yaml.safe_dump(
        [{"name": n, "changes": c} for n, c in cnt.most_common()], allow_unicode=True))
    return cnt


def suggest(records, repo_records):
    """List names whose email domain hints at a tracked company but are unmapped."""
    att = Attributor()
    tracked = {d for c in att.companies.values()
               for d in c["domains"] + [x for a in c.get("acquisitions", [])
                                        for x in a["domains"]]}
    seen = Counter()
    for r in repo_records:
        for role in ("authors", "reviewers"):
            for n, e in r[role]:
                if e.rsplit("@", 1)[-1].lower() in tracked:
                    seen[(n, e)] += 1
    print(yaml.safe_dump([{"name": n, "email": e, "changes": c}
                          for (n, e), c in seen.most_common()]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=f"{dt.date.today().year - 2}-01-01")
    ap.add_argument("--repo", default=str(ROOT / "pg"))
    ap.add_argument("--suggest", action="store_true")
    a = ap.parse_args()
    recs = parse(a.repo, a.since)
    if a.suggest:
        suggest(None, recs)
        return
    recs = attribute(recs)
    for r in recs:
        r["branches"].sort(key=lambda b: (b == "master", b if b != "master" else 0))
    recs.sort(key=lambda r: r["date"], reverse=True)
    OUT.mkdir(exist_ok=True)
    unresolved = write_unresolved(recs)
    head = git(a.repo, "rev-parse", "origin/master").strip()
    head_date = git(a.repo, "log", "-1", "--format=%cs", "origin/master").strip()
    stable = sorted(branch_label(b) for b in branches(a.repo) if b != "origin/master")
    latest = stable[-1] if stable else None
    fork = git(a.repo, "log", "-1", "--format=%cs", git(
        a.repo, "merge-base", "origin/master", f"origin/REL_{latest}_STABLE").strip()).strip() \
        if latest else "9999-12-31"
    for r in recs:
        if "master" in r["branches"]:
            r["release"] = latest if r["date"] <= fork else (latest or 0) + 1
    master_ver = (latest or 0) + 1
    tags = git(a.repo, "tag", "-l", "REL_*_0").split()
    released = max((int(m.group(1)) for t in tags if (m := re.fullmatch(r"REL_(\d+)_0", t))), default=0)
    (OUT / "commits.json").write_text(json.dumps({
        "head": head, "head_date": head_date, "since": a.since,
        "master_version": master_ver, "latest_stable": latest, "fork_date": fork,
        "released_max": released, "commits": recs}))
    print(f"{len(recs)} changes since {a.since}; {len(unresolved)} people unresolved "
          f"(see out/unresolved.yml)")


if __name__ == "__main__":
    main()
