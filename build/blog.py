"""Collect PostgreSQL blog posts by tracked-company people / blogs.

Planet PostgreSQL posts are kept when the author maps to a tracked company.
Company blog feeds are kept when the post looks Postgres-related.
Writes out/blog.json.
"""
import datetime as dt
import json
import re
import time

import feedparser

from common import OUT, Attributor, load

PG = re.compile(r"postgres|pg_|pgvector|\bpg\b|psql|vacuum|\bwal\b", re.I)
SINCE = dt.date(dt.date.today().year - 2, 1, 1)


def entry_date(e):
    t = e.get("published_parsed") or e.get("updated_parsed")
    return dt.date(*t[:3]) if t else dt.date.today()


def main():
    cfg = load("blogs.yml")
    att = Attributor()
    posts, errors, seen = [], [], set()
    for f in cfg.get("feeds") or []:
        feed = feedparser.parse(f["url"], agent="pg-activity-tracker")
        if feed.bozo and not feed.entries:
            errors.append({"source": f["url"], "error": str(feed.bozo_exception)[:200]})
            continue
        for e in feed.entries:
            link = e.get("link", "")
            if link in seen:
                continue
            d = entry_date(e)
            if d < SINCE:
                continue
            title = e.get("title", "")
            author = e.get("author", "")
            # Planet titles are "Author: Title"
            if f.get("planet") and ":" in title:
                author, title = [s.strip() for s in title.split(":", 1)]
            if f.get("company"):
                if not PG.search(title):
                    continue
                company, legacy = f["company"], d < dt.date.fromisoformat(
                    str(f["legacy_before"])) if f.get("legacy_before") else False
            else:
                r = att.resolve(author, "", d)
                if r["company"] not in att.tracked:
                    continue
                company, legacy = r["company"], r["legacy"]
            seen.add(link)
            posts.append({"date": str(d), "title": title, "url": link,
                          "author": author, "company": company, "legacy": legacy,
                          "source": f["name"]})
        time.sleep(1)
    posts.sort(key=lambda p: p["date"], reverse=True)
    OUT.mkdir(exist_ok=True)
    (OUT / "blog.json").write_text(json.dumps({"posts": posts, "errors": errors}))
    print(f"{len(posts)} posts, {len(errors)} feed errors")


if __name__ == "__main__":
    main()
