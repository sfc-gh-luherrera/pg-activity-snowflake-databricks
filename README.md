# Snowflake & Databricks in PostgreSQL

A static dashboard of what Snowflake and Databricks contribute to PostgreSQL: code and
reviews in core, talks at PostgreSQL events, and blog posts. Rebuilt daily by GitHub
Actions from public sources and published with GitHub Pages.

Layout and counting rules follow the
[Percona PostgreSQL activity dashboard](https://percona-lab.github.io/percona-pg-activity/)
([Percona-Lab/percona-pg-activity](https://github.com/Percona-Lab/percona-pg-activity)).
Person-to-company labels are seeded from Percona's public `ranking.json`. Thank you, Percona.
No code is copied from that project.

## How it is counted

- **Authored**: the person is in an `Author:` or `Co-authored-by:` trailer. A page toggle
  also counts a committer's own commits that have no `Author:` trailer.
- **Reviewed**: `Reviewed-by:` trailer.
- Backpatches to several release branches count once (grouped by subject + Discussion link).
- **Attribution**, in order: `config/people.yml` (curated) → `config/people_resolved.yml`
  (manual lookups) → `config/people_seed.yml` (Percona labels) → email domain
  (`config/domains.yml`). Anyone else is **Individual contributor**.
- **Legacy**: Crunchy Data (now Snowflake) and Neon (now Databricks) work dated before the
  acquisition (`config/companies.yml`) is flagged legacy and can be hidden.

## Resolving unknown people

Each run writes `out/unresolved.yml` (also uploaded as the `unresolved` artifact): people
counted as Individual contributor, most active first. Look them up (public LinkedIn
profile, Sumble, conference bios, mailing-list signatures) and add an entry with its
evidence to `config/people_resolved.yml`. Use `company: Individual contributor` when no
employer can be confirmed, so the name is not queued again.

## Run locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
git clone --filter=blob:none --no-checkout https://github.com/postgres/postgres.git pg
cd build
../.venv/bin/python import_seed.py
../.venv/bin/python code.py          # --since YYYY-MM-DD (default: two years back)
../.venv/bin/python community.py
../.venv/bin/python blog.py
../.venv/bin/python build.py
cd ../dist && python3 -m http.server
```

## Before making the repo public

Review every `verified: false` entry in `config/people.yml` and `config/people_resolved.yml`,
and confirm the acquisition dates in `config/companies.yml`.
