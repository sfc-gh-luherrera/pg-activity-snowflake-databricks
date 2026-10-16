"""Shared config loading and attribution helpers."""
import datetime as dt
import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
OUT = ROOT / "out"
INDIVIDUAL = "Individual contributor"


def load(name):
    return yaml.safe_load((CONFIG / name).read_text()) or {}


def _norm(name):
    return re.sub(r"\s+", " ", name or "").strip().lower()


class Attributor:
    """Resolve (name, email, date) -> (company, legacy, via)."""

    def __init__(self):
        self.companies = load("companies.yml")["featured"]
        self.domains = {k.lower(): v for k, v in load("domains.yml").items()}
        self.people = {}
        # Precedence: curated people.yml, then manual lookups (people_resolved.yml,
        # LinkedIn/Sumble research), then the Percona-derived seed.
        for f in ("people.yml", "people_resolved.yml", "people_seed.yml"):
            p_path = CONFIG / f
            if not p_path.exists():
                continue
            for p in load(f).get("people") or []:
                for n in [p["name"], *p.get("aliases", [])]:
                    self.people.setdefault(_norm(n), []).append(p)
        # acquired-company domain -> (parent, acquisition)
        self.acq_domains = {}
        self.acq_by_name = {}
        for parent, c in self.companies.items():
            for a in c.get("acquisitions", []):
                self.acq_by_name[a["name"]] = (parent, a)
                for d in a["domains"]:
                    self.acq_domains[d] = (parent, a)

    @staticmethod
    def _d(v):
        if v is None or isinstance(v, dt.date):
            return v
        return dt.date.fromisoformat(str(v))

    def resolve(self, name, email, date):
        """Return dict(company, legacy, via); unknown people are INDIVIDUAL."""
        for p in self.people.get(_norm(name), []):
            f, t = self._d(p.get("from")), self._d(p.get("to"))
            if (f and date < f) or (t and date > t):
                continue
            via = p.get("via")
            legacy = False
            if via and via in self.acq_by_name:
                legacy = date < self._d(self.acq_by_name[via][1]["acquired_on"])
            return {"company": p["company"], "legacy": legacy, "via": via}
        domain = (email or "").rsplit("@", 1)[-1].lower()
        if domain in self.acq_domains:
            parent, a = self.acq_domains[domain]
            return {"company": parent, "via": a["name"],
                    "legacy": date < self._d(a["acquired_on"])}
        # match subdomains too, e.g. oss.nttdata.com
        for d, company in self.domains.items():
            if domain == d or domain.endswith("." + d):
                return {"company": company, "legacy": False, "via": None}
        return {"company": INDIVIDUAL, "legacy": False, "via": None}

    @property
    def featured(self):
        return list(self.companies)
