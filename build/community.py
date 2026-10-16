"""Collect talks from conference session pages, attributing each speaker.

All talks are kept; the site filters by the selected companies.
Writes out/community.json. Sources that fail are recorded in `errors` and
do not stop the build.
"""
import datetime as dt
import html
import json
import re
from urllib.parse import urljoin

import requests

from common import OUT, Attributor, load

SESSION = re.compile(r'<li><a href="(session/[^"]+)">((?:(?!</li>).)*?)</a>\s*\(([^)]*)\)</li>', re.S)
UA = {"User-Agent": "pg-activity-tracker (+github actions)"}


def pgeu_talks(src):
    r = requests.get(src["sessions"], headers=UA, timeout=30)
    r.raise_for_status()
    for href, title, speakers in SESSION.findall(r.text):
        names = [html.unescape(s).strip() for s in speakers.split(",") if s.strip()]
        yield {"title": html.unescape(re.sub("<[^>]+>", "", title)).strip(),
               "url": urljoin(src["sessions"], href), "speakers": names}


def main():
    cfg = load("community.yml")
    att = Attributor()
    items, errors = [], []
    for src in cfg.get("pgeu") or []:
        date = dt.date.fromisoformat(str(src["start"]))
        try:
            for t in pgeu_talks(src):
                hits = [{"name": n, **att.resolve(n, "", date)} for n in t["speakers"]]
                if hits:
                    items.append({"kind": "talk", "event": src["name"],
                                  "date": str(date), "title": t["title"],
                                  "url": t["url"], "people": hits})
        except Exception as e:  # noqa: BLE001 - one bad source must not fail the build
            errors.append({"source": src["sessions"], "error": str(e)[:200]})
    for m in cfg.get("manual") or []:
        date = dt.date.fromisoformat(str(m["date"]))
        items.append({"kind": m["kind"], "event": m["event"], "date": str(date),
                      "title": m.get("title", ""), "url": m.get("url", ""),
                      "people": [{"name": m["person"], **att.resolve(m["person"], "", date)}]})
    items.sort(key=lambda x: x["date"], reverse=True)
    OUT.mkdir(exist_ok=True)
    (OUT / "community.json").write_text(json.dumps({"items": items, "errors": errors}))
    print(f"{len(items)} community items, {len(errors)} source errors")


if __name__ == "__main__":
    main()
