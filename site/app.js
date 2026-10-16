"use strict";
// All rendering uses textContent / createElement: commit text is untrusted input.

const S = { period: "ytd", company: "Both", legacy: true, self: false, rankBy: "a", person: null, shown: 30, tab: "code" };
let DATA, RANK, COMM, BLOG;
const COS = ["Snowflake", "Databricks"];
const CLS = { Snowflake: "sf", Databricks: "db" };

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const $ = (id) => document.getElementById(id);
const clear = (n) => { n.replaceChildren(); return n; };
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : "#";
const link = (href, text) => el("a", { href: safeUrl(href), text, rel: "noopener" });

function periodStart() {
  const today = new Date(DATA.head_date || Date.now());
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const d = { ytd: new Date(Date.UTC(y, 0, 1)), "6m": new Date(Date.UTC(y, m - 5, 1)),
              "3m": new Date(Date.UTC(y, m - 2, 1)), month: new Date(Date.UTC(y, m, 1)) }[S.period];
  return d.toISOString().slice(0, 10);
}
const activeCos = () => S.company === "Both" ? COS : [S.company];
const credit = (c, role, co) => c[role].filter((p) => p.company === co && (S.legacy || !p.legacy)
  && (S.self || !p.self) && (!S.person || p.name === S.person));
// [authored, reviewed] for a ranking cell, honoring the committer toggle
const cell = (v) => [S.self ? v[2] : v[0], v[1]];
function companyTotals(idx) {
  const out = {};
  for (const m of monthsInPeriod()) for (const [co, v] of Object.entries(RANK.months[m])) out[co] = (out[co] || 0) + cell(v)[idx];
  return out;
}
const has = (c, role, co) => credit(c, role, co).length > 0;

function inPeriod() {
  const start = periodStart();
  return DATA.commits.filter((c) => c.date >= start &&
    activeCos().some((co) => has(c, "authors", co) || has(c, "reviewers", co) || has(c, "reporters", co)));
}
function monthsInPeriod() {
  const start = periodStart().slice(0, 7);
  return Object.keys(RANK.months).filter((m) => m >= start).sort();
}

function renderMeta() {
  const p = $("meta");
  clear(p).append(`Updated ${DATA.generated_at} · PostgreSQL source as of `,
    link(`https://github.com/postgres/postgres/commit/${DATA.head}`, (DATA.head || "").slice(0, 11)),
    ` (${DATA.head_date})`);
}

function seg(id, opts, key) {
  const box = clear($(id));
  for (const [v, label] of opts) {
    box.append(el("button", { text: label, class: S[key] === v ? "on" : "",
      onclick: () => { S[key] = v; S.shown = 30; render(); } }));
  }
}

function renderKpis(rows) {
  const months = monthsInPeriod();
  const total = months.reduce((s, m) => s + (RANK.totals[m] || 0), 0);
  const byCo = companyTotals(0);
  delete byCo[RANK.individual];
  const order = Object.entries(byCo).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const master = DATA.master_version;
  const card = (title, fn, note) => el("div", { class: "kpi" }, el("h3", { text: title }),
    el("div", { class: "vals" }, ...activeCos().map((co) => el("div", { class: `v ${CLS[co]}` },
      fn(co), el("small", { text: co.toUpperCase() })))), note ? el("p", { text: note }) : null);
  const n = (f) => (co) => String(rows.filter((c) => f(c, co)).length);
  const authored = (c, co) => has(c, "authors", co);
  const touched = (c, co) => authored(c, co) || has(c, "reviewers", co);
  clear($("kpis")).append(
    card("Changes authored", (co) => {
      const v = rows.filter((c) => authored(c, co)).length;
      return `${v}`;
    }, `${total.toLocaleString()} PostgreSQL changes in period`),
    card("Share of all changes", (co) => {
      const v = rows.filter((c) => authored(c, co)).length;
      return total ? `${(100 * v / total).toFixed(1)}%` : "-";
    }),
    card("Changes reviewed", n((c, co) => has(c, "reviewers", co)), "Patches reviewed before commit"),
    card("Company rank", (co) => order.includes(co) ? `#${order.indexOf(co) + 1}` : "-",
      `By changes authored, of ${order.length} companies (includes legacy)`),
    card(`Not yet released (PostgreSQL ${DATA.latest_stable || ""}–${master || "next"})`,
      n((c, co) => touched(c, co) && c.branches.length === 1 && c.branches[0] === "master"),
      "Authored or reviewed, master only"),
    card("Fixes for released versions", n((c, co) => touched(c, co) && c.branches.some((b) => b !== "master")),
      "Authored or reviewed, backpatched"),
  );
}

function renderChart(rows) {
  const months = monthsInPeriod();
  const series = [];
  for (const co of activeCos()) {
    series.push({ co, kind: "Authored", fn: (c) => has(c, "authors", co) });
    series.push({ co, kind: "Reviewed", fn: (c) => has(c, "reviewers", co) });
  }
  const vals = months.map((m) => series.map((s) => rows.filter((c) => c.date.startsWith(m) && s.fn(c)).length));
  const max = Math.max(1, ...vals.flat());
  const W = 1040, H = 220, pad = 28, gw = (W - pad) / Math.max(1, months.length), bw = Math.min(18, (gw - 8) / series.length);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H + 24}`); svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Monthly authored and reviewed changes");
  const add = (tag, a, text) => { const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (text != null) n.textContent = text; svg.append(n); return n; };
  months.forEach((m, i) => {
    series.forEach((s, j) => {
      const h = (vals[i][j] / max) * (H - 10);
      const r = add("rect", { x: pad + i * gw + 4 + j * bw, y: H - h, width: bw - 2, height: h,
        fill: DATA.companies[s.co].color, opacity: s.kind === "Authored" ? 1 : 0.45 });
      const t = document.createElementNS(ns, "title"); t.textContent = `${s.co} ${s.kind} ${m}: ${vals[i][j]}`; r.append(t);
    });
    add("text", { x: pad + i * gw + gw / 2, y: H + 16, "text-anchor": "middle" },
      new Date(m + "-01T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" }));
  });
  add("text", { x: 0, y: 12 }, String(max));
  clear($("chart")).append(svg,
    el("p", { class: "sub", text: "Solid = authored, light = reviewed" }));
  const tbl = el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Month" }),
    ...series.map((s) => el("th", { class: "n", text: `${s.co} ${s.kind}` })))),
    el("tbody", {}, ...months.map((m, i) => el("tr", {}, el("td", { text: m }),
      ...vals[i].map((v) => el("td", { class: "n", text: String(v) }))))));
  clear($("chartTable")).append(tbl);
}

function renderRank() {
  const byCo = companyTotals(S.rankBy === "a" ? 0 : 1);
  const ind = byCo[RANK.individual] || 0;
  delete byCo[RANK.individual];
  const all = Object.entries(byCo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const rows = all.slice(0, 16);
  // Tracked companies are always shown, at their real rank
  for (const co of activeCos()) {
    const i = all.findIndex(([c]) => c === co);
    if (i >= 16) rows.push(all[i]);
  }
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const bar = (label, v, cls) => el("li", { class: cls },
    el("span", { class: "rl", text: label }),
    el("span", { class: "rb" }, el("span", { style: `width:${(100 * v / max).toFixed(1)}%` })),
    el("span", { class: "rv", text: String(v) }));
  clear($("rank")).append(...rows.map(([co, v]) => bar(`${all.findIndex(([c]) => c === co) + 1}. ${co}`, v,
    COS.includes(co) ? `hl ${CLS[co]}` : "")),
    ind ? bar(RANK.individual, ind, "ind") : null);
  seg("rankBy", [["a", "Authored"], ["r", "Reviewed"]], "rankBy");
}

function renderAreas(rows) {
  const cnt = {};
  for (const c of rows) for (const a of c.areas) cnt[a] = (cnt[a] || 0) + 1;
  clear($("areas")).append(...Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([a, v]) => el("span", { text: `${a} ${v}` })));
}

function releaseTags(c) {
  const out = [];
  const old = c.branches.filter((b) => b !== "master").map(Number).sort((a, b) => a - b);
  if (old.length) out.push(`Fix for PostgreSQL ${old[0]}${old.length > 1 ? "–" + old[old.length - 1] : ""}`);
  if (c.branches.includes("master")) out.push(`PostgreSQL ${DATA.master_version || "next"} (in development)`);
  return out;
}

function creditLine(c) {
  const parts = [];
  for (const co of activeCos()) {
    for (const [role, label] of [["authors", "Author"], ["reviewers", "Reviewer"], ["reporters", "Reporter"]]) {
      for (const p of credit(c, role, co)) parts.push([p, label, co]);
    }
  }
  const line = el("div", { class: "credit" });
  parts.forEach(([p, label, co], i) => {
    if (i) line.append(" · ");
    line.append(el("b", { class: CLS[co], text: p.name }), ` ${label}${p.legacy ? ` (legacy, ${p.via})` : ""}`);
  });
  const others = c.authors.concat(c.reviewers).filter((p) => !COS.includes(p.company)).map((p) => p.name);
  if (others.length) line.append(` — with ${[...new Set(others)].join(", ")}`);
  return line;
}

function renderChanges(rows) {
  $("count").textContent = `${rows.length} changes`;
  const pf = clear($("personFilter"));
  if (S.person) pf.append(`Filtered to ${S.person} `, el("button", { class: "linkish", text: "clear",
    onclick: () => { S.person = null; render(); } }));
  const box = clear($("changes"));
  for (const c of rows.slice(0, S.shown)) {
    const legacy = activeCos().some((co) => ["authors", "reviewers"].some((r) => credit(c, r, co).some((p) => p.legacy)));
    box.append(el("article", { class: "change" },
      el("div", { class: "date", text: c.date }),
      el("h3", {}, link(`https://github.com/postgres/postgres/commit/${c.sha}`, c.subject)),
      el("div", { class: "tags" }, el("span", { class: "tag", text: c.type }),
        ...c.areas.map((a) => el("span", { class: "tag", text: a })),
        ...releaseTags(c).map((t) => el("span", { class: "tag", text: t })),
        legacy ? el("span", { class: "tag legacy", text: "Legacy" }) : null),
      c.summary ? el("p", { text: c.summary }) : null,
      creditLine(c),
      el("div", { class: "credit" },
        link(`https://git.postgresql.org/gitweb/?p=postgresql.git;a=commitdiff;h=${c.sha}`, "Commit on git.postgresql.org"),
        ...c.discussion.slice(0, 2).flatMap((d, i) => [" · ", link(d, i ? "Related discussion" : "Mailing-list discussion")]))));
  }
  $("more").hidden = rows.length <= S.shown;
  $("more").textContent = `Show more (${Math.max(0, rows.length - S.shown)} left)`;
}

function renderPeople() {
  const start = periodStart(), stats = {};
  for (const c of DATA.commits) {
    if (c.date < start) continue;
    for (const [role, i] of [["authors", 0], ["reviewers", 1], ["reporters", 2]]) {
      for (const co of activeCos()) for (const p of c[role]) {
        if (p.company !== co || (!S.legacy && p.legacy) || (!S.self && p.self)) continue;
        const s = stats[p.name] ||= { co, n: [new Set(), new Set(), new Set()] };
        s.n[i].add(c.sha);
      }
    }
  }
  clear($("people")).append(...Object.entries(stats).sort((a, b) => b[1].n[0].size - a[1].n[0].size)
    .map(([name, s]) => el("tr", {},
      el("td", {}, el("button", { class: "linkish", text: name,
        onclick: () => { S.person = name; S.tab = "code"; location.hash = "#code"; render(); } })),
      el("td", { class: CLS[s.co], text: s.co }),
      ...s.n.map((x) => el("td", { class: "n", text: String(x.size) })))));
}

function renderItems(id, items, fmt) {
  const box = clear($(id));
  if (!items.length) box.append(el("p", { class: "sub", text: "Nothing yet for this selection." }));
  for (const it of items) box.append(fmt(it));
}

function renderCommunity() {
  const start = periodStart();
  const items = (COMM.items || []).filter((i) => i.date >= start &&
    i.people.some((p) => activeCos().includes(p.company) && (S.legacy || !p.legacy)));
  renderItems("community", items, (i) => el("div", { class: "item" },
    el("div", { class: "date", text: `${i.date} · ${i.event} · ${i.kind}` }),
    i.url ? link(i.url, i.title || i.kind) : el("span", { text: i.title }),
    el("div", { class: "credit", text: i.people.filter((p) => COS.includes(p.company))
      .map((p) => `${p.name} (${p.company}${p.legacy ? ", legacy" : ""})`).join(", ") })));
}

function renderBlog() {
  const start = periodStart();
  const posts = (BLOG.posts || []).filter((p) => p.date >= start && activeCos().includes(p.company) && (S.legacy || !p.legacy));
  renderItems("blog", posts, (p) => el("div", { class: "item" },
    el("div", { class: "date", text: `${p.date} · ${p.source}${p.legacy ? " · legacy" : ""}` }),
    link(p.url, p.title),
    el("div", { class: `credit ${CLS[p.company]}`, text: `${p.author ? p.author + " · " : ""}${p.company}` })));
}

function exportRows(rows) {
  return rows.map((c) => ({ date: c.date, subject: c.subject, type: c.type,
    people: activeCos().flatMap((co) => ["authors", "reviewers"].flatMap((r) => credit(c, r, co).map((p) => `${p.name} (${r.slice(0, -1)})`))).join("; "),
    url: `https://github.com/postgres/postgres/commit/${c.sha}` }));
}

function render() {
  S.tab = (location.hash || "#code").slice(1);
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== S.tab; });
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === S.tab));
  seg("period", [["ytd", `${new Date(DATA.head_date).getUTCFullYear()} so far`], ["6m", "Last 6 months"], ["3m", "Last 3 months"], ["month", "This month"]], "period");
  seg("company", [["Both", "Both"], ["Snowflake", "Snowflake"], ["Databricks", "Databricks"]], "company");
  const rows = inPeriod();
  renderKpis(rows); renderChart(rows); renderRank(); renderAreas(rows); renderChanges(rows);
  renderPeople(); renderCommunity(); renderBlog();
}

async function main() {
  const get = (f) => fetch(f).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
  [DATA, RANK, COMM, BLOG] = await Promise.all(["data.json", "ranking.json", "community.json", "blog.json"].map(get));
  renderMeta();
  $("legacy").addEventListener("change", (e) => { S.legacy = e.target.checked; render(); });
  $("self").addEventListener("change", (e) => { S.self = e.target.checked; render(); });
  $("more").addEventListener("click", () => { S.shown += 50; render(); });
  $("copyMd").addEventListener("click", () => {
    const md = exportRows(inPeriod()).map((r) => `- ${r.date} [${r.subject}](${r.url}) — ${r.people}`).join("\n");
    navigator.clipboard.writeText(md).then(() => { $("copyMd").textContent = "Copied"; });
  });
  $("dlCsv").addEventListener("click", () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = exportRows(inPeriod());
    const csv = ["date,subject,type,people,url", ...rows.map((r) => [r.date, r.subject, r.type, r.people, r.url].map(q).join(","))].join("\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "pg-changes.csv" });
    a.click();
  });
  window.addEventListener("hashchange", render);
  render();
}
main();
