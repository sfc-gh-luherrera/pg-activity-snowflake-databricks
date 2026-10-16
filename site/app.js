"use strict";
// All rendering uses textContent / createElement: commit text is untrusted input.

const S = { period: "ytd", sel: new Set(), legacy: true, self: false, rankBy: "a", person: null, shown: 30, tab: "code" };
let DATA, RANK, COMM, BLOG, ORDER = [];
const MAX_GROUPS = 4; // above this, the selection is shown as one combined series

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
const safeColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#888";

// --- data expansion -------------------------------------------------------
function expand(d) {
  const ppl = (lst) => lst.map(([name, ci, f, via]) => ({ name, company: d.co[ci], legacy: !!(f & 1), self: !!(f & 2), via }));
  d.commits = d.commits.map((r) => ({ sha: r.h, date: r.d, subject: r.s, branches: r.b, type: r.y, areas: r.a,
    authors: ppl(r.A), reviewers: ppl(r.R), reporters: ppl(r.P), discussion: r.D || [] }));
  return d;
}

// --- selection ------------------------------------------------------------
function readSel() {
  const q = new URLSearchParams(location.search).get("c");
  S.sel = new Set(q === null ? DATA.featured : q.split(",").filter(Boolean));
}
function writeSel() {
  const def = [...S.sel].sort().join(",") === [...DATA.featured].sort().join(",");
  const q = def ? "" : `?c=${encodeURIComponent([...S.sel].join(","))}`;
  history.replaceState(null, "", `${location.pathname}${q}${location.hash}`);
}
function toggle(co) {
  if (S.sel.has(co)) S.sel.delete(co); else S.sel.add(co);
  S.shown = 30; writeSel(); render();
}
function colorOf(co) {
  if (DATA.companies[co]) return safeColor(DATA.companies[co].color);
  const others = ORDER.filter((c) => !DATA.companies[c]);
  const pal = DATA.palette.length ? DATA.palette : ["#7254A3"];
  return safeColor(pal[Math.max(0, others.indexOf(co)) % pal.length]);
}
// Groups drive KPIs, chart series and credit lines: one per company when few are
// selected, else one combined group. Empty selection = all companies.
function groups() {
  if (!S.sel.size) return [{ label: "All companies", cos: null, color: "#5B5B5B" }];
  if (S.sel.size <= MAX_GROUPS) return [...S.sel].map((co) => ({ label: co, cos: new Set([co]), color: colorOf(co) }));
  return [{ label: `${S.sel.size} companies`, cos: S.sel, color: "#5B5B5B" }];
}
const inGroup = (co, g) => !g.cos || g.cos.has(co);
const credit = (c, role, g) => c[role].filter((p) => inGroup(p.company, g) && (S.legacy || !p.legacy)
  && (S.self || !p.self) && (!S.person || p.name === S.person));
const has = (c, role, g) => credit(c, role, g).length > 0;
const SELG = () => ({ cos: S.sel.size ? S.sel : null });

// --- periods & ranking ----------------------------------------------------
function periodStart() {
  const today = new Date(DATA.head_date || Date.now());
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const d = { ytd: new Date(Date.UTC(y, 0, 1)), "6m": new Date(Date.UTC(y, m - 5, 1)),
              "3m": new Date(Date.UTC(y, m - 2, 1)), month: new Date(Date.UTC(y, m, 1)) }[S.period];
  return d.toISOString().slice(0, 10);
}
function monthsInPeriod() {
  const start = periodStart().slice(0, 7);
  return Object.keys(RANK.months).filter((m) => m >= start).sort();
}
// [authored, reviewed] for a ranking cell, honoring the committer toggle
const cell = (v) => [S.self ? v[2] : v[0], v[1]];
function companyTotals(idx, months = monthsInPeriod()) {
  const out = {};
  for (const m of months) for (const [co, v] of Object.entries(RANK.months[m])) out[co] = (out[co] || 0) + cell(v)[idx];
  delete out[RANK.individual];
  return out;
}
const sorted = (o) => Object.entries(o).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);

function inPeriod() {
  const start = periodStart(), g = SELG();
  // No selection: list every change, including committers' own work
  if (!S.sel.size && !S.person) return DATA.commits.filter((c) => c.date >= start);
  return DATA.commits.filter((c) => c.date >= start &&
    (has(c, "authors", g) || has(c, "reviewers", g) || has(c, "reporters", g)));
}

// --- rendering ------------------------------------------------------------
function renderMeta() {
  clear($("meta")).append(`Updated ${DATA.generated_at} · PostgreSQL source as of `,
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

function renderSelection() {
  const box = clear($("selection"));
  box.append(el("span", { class: "sub", text: S.sel.size ? "Showing:" : "Showing all companies" }));
  for (const co of S.sel) {
    box.append(el("button", { class: "chip", style: `border-color:${colorOf(co)}`, title: "Remove",
      onclick: () => toggle(co) }, el("i", { style: `background:${colorOf(co)}` }), co, " ×"));
  }
  box.append(el("button", { class: "linkish", text: `Reset to ${DATA.featured.join(" + ")}`,
    onclick: () => { S.sel = new Set(DATA.featured); writeSel(); render(); } }));
  if (S.sel.size) box.append(el("button", { class: "linkish", text: "Clear (all companies)",
    onclick: () => { S.sel = new Set(); writeSel(); render(); } }));
}

function renderKpis(rows) {
  const total = monthsInPeriod().reduce((s, m) => s + (RANK.totals[m] || 0), 0);
  const order = sorted(companyTotals(0));
  const gs = groups();
  const card = (title, fn, note) => el("div", { class: "kpi" }, el("h3", { text: title }),
    el("div", { class: "vals" }, ...gs.map((g) => el("div", { class: "v", style: `color:${g.color}` },
      fn(g), el("small", { text: g.label.toUpperCase() })))), note ? el("p", { text: note }) : null);
  const n = (f) => (g) => String(rows.filter((c) => f(c, g)).length);
  const authored = (c, g) => has(c, "authors", g);
  const touched = (c, g) => authored(c, g) || has(c, "reviewers", g);
  clear($("kpis")).append(
    card("Changes authored", n(authored), `${total.toLocaleString()} PostgreSQL changes in period`),
    card("Share of all changes", (g) => {
      const v = rows.filter((c) => authored(c, g)).length;
      return total ? `${(100 * v / total).toFixed(1)}%` : "-";
    }),
    card("Changes reviewed", n((c, g) => has(c, "reviewers", g)), "Patches reviewed before commit"),
    card("Company rank", (g) => {
      const co = g.cos && g.cos.size === 1 ? [...g.cos][0] : null;
      return co && order.includes(co) ? `#${order.indexOf(co) + 1}` : "-";
    }, `By changes authored, of ${order.length} companies`),
    card(`Not yet released (PostgreSQL ${DATA.latest_stable || ""}–${DATA.master_version || "next"})`,
      n((c, g) => touched(c, g) && c.branches.length === 1 && c.branches[0] === "master"),
      "Authored or reviewed, master only"),
    card("Fixes for released versions", n((c, g) => touched(c, g) && c.branches.some((b) => b !== "master")),
      "Authored or reviewed, backpatched"),
  );
}

function renderChart(rows) {
  const months = monthsInPeriod();
  const series = [];
  for (const g of groups()) {
    series.push({ g, kind: "Authored", fn: (c) => has(c, "authors", g) });
    series.push({ g, kind: "Reviewed", fn: (c) => has(c, "reviewers", g) });
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
      const r = add("rect", { x: pad + i * gw + 4 + j * bw, y: H - h, width: Math.max(1, bw - 2), height: h,
        fill: s.g.color, opacity: s.kind === "Authored" ? 1 : 0.45 });
      const t = document.createElementNS(ns, "title"); t.textContent = `${s.g.label} ${s.kind} ${m}: ${vals[i][j]}`; r.append(t);
    });
    add("text", { x: pad + i * gw + gw / 2, y: H + 16, "text-anchor": "middle" },
      new Date(m + "-01T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" }));
  });
  add("text", { x: 0, y: 12 }, String(max));
  clear($("chart")).append(svg,
    el("p", { class: "sub", text: "Solid = authored, light = reviewed" }));
  const tbl = el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Month" }),
    ...series.map((s) => el("th", { class: "n", text: `${s.g.label} ${s.kind}` })))),
    el("tbody", {}, ...months.map((m, i) => el("tr", {}, el("td", { text: m }),
      ...vals[i].map((v) => el("td", { class: "n", text: String(v) }))))));
  clear($("chartTable")).append(tbl);
}

function renderRank() {
  const byCo = companyTotals(S.rankBy === "a" ? 0 : 1);
  const ind = Object.entries(RANK.months).filter(([m]) => monthsInPeriod().includes(m))
    .reduce((s, [, v]) => s + (v[RANK.individual] ? cell(v[RANK.individual])[S.rankBy === "a" ? 0 : 1] : 0), 0);
  const all = sorted(byCo);
  const shown = all.slice(0, 20);
  for (const co of S.sel) if (!shown.includes(co) && all.includes(co)) shown.push(co); // selected always visible
  const max = Math.max(1, ...shown.map((c) => byCo[c]));
  const bar = (co, label, v, extra = "") => {
    const on = S.sel.has(co);
    return el("li", { class: `${on ? "hl" : ""} ${extra}`, role: "button", tabindex: "0",
      title: on ? "Click to remove from selection" : "Click to add to selection",
      onclick: () => toggle(co), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(co); } } },
      el("span", { class: "rl" }, el("input", { type: "checkbox", tabindex: "-1", ...(on ? { checked: "" } : {}) }), label),
      el("span", { class: "rb" }, el("span", { style: `width:${(100 * v / max).toFixed(1)}%;${on ? `background:${colorOf(co)}` : ""}` })),
      el("span", { class: "rv", text: String(v) }));
  };
  clear($("rank")).append(...shown.map((co) => bar(co, `${all.indexOf(co) + 1}. ${co}`, byCo[co])),
    ind ? bar(RANK.individual, RANK.individual, ind, "ind") : null);
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
  const g = SELG(), line = el("div", { class: "credit" });
  const parts = [];
  for (const [role, label] of [["authors", "Author"], ["reviewers", "Reviewer"], ["reporters", "Reporter"]]) {
    for (const p of credit(c, role, g)) parts.push([p, label]);
  }
  parts.forEach(([p, label], i) => {
    if (i) line.append(" · ");
    line.append(el("b", { style: `color:${colorOf(p.company)}`, text: p.name }),
      ` ${label} (${p.company}${p.legacy ? `, legacy ${p.via || ""}` : ""})`);
  });
  const others = c.authors.concat(c.reviewers).filter((p) => !inGroup(p.company, g)).map((p) => p.name);
  if (others.length) line.append(` — with ${[...new Set(others)].join(", ")}`);
  return line;
}

function renderChanges(rows) {
  $("changesSub").textContent = S.sel.size
    ? `Every PostgreSQL change credited to ${[...S.sel].join(", ")}, newest first.`
    : "Every PostgreSQL change, newest first.";
  $("count").textContent = `${rows.length} changes`;
  const pf = clear($("personFilter"));
  if (S.person) pf.append(`Filtered to ${S.person} `, el("button", { class: "linkish", text: "clear",
    onclick: () => { S.person = null; render(); } }));
  const box = clear($("changes")), g = SELG();
  for (const c of rows.slice(0, S.shown)) {
    const legacy = ["authors", "reviewers"].some((r) => credit(c, r, g).some((p) => p.legacy));
    box.append(el("article", { class: "change" },
      el("div", { class: "date", text: c.date }),
      el("h3", {}, link(`https://github.com/postgres/postgres/commit/${c.sha}`, c.subject)),
      el("div", { class: "tags" }, el("span", { class: "tag", text: c.type }),
        ...c.areas.map((a) => el("span", { class: "tag", text: a })),
        ...releaseTags(c).map((t) => el("span", { class: "tag", text: t })),
        legacy ? el("span", { class: "tag legacy", text: "Legacy" }) : null),
      creditLine(c),
      el("div", { class: "credit" },
        link(`https://git.postgresql.org/gitweb/?p=postgresql.git;a=commitdiff;h=${c.sha}`, "Commit on git.postgresql.org"),
        ...c.discussion.slice(0, 1).flatMap((d) => [" · ", link(d, "Mailing-list discussion")]))));
  }
  $("more").hidden = rows.length <= S.shown;
  $("more").textContent = `Show more (${Math.max(0, rows.length - S.shown)} left)`;
}

function renderPeople() {
  const start = periodStart(), stats = {}, g = SELG();
  for (const c of DATA.commits) {
    if (c.date < start) continue;
    for (const [role, i] of [["authors", 0], ["reviewers", 1], ["reporters", 2]]) {
      for (const p of c[role]) {
        if (!inGroup(p.company, g) || (!S.legacy && p.legacy) || (!S.self && p.self)) continue;
        const s = stats[p.name] ||= { co: p.company, n: [new Set(), new Set(), new Set()] };
        s.n[i].add(c.sha);
      }
    }
  }
  clear($("people")).append(...Object.entries(stats)
    .sort((a, b) => b[1].n[0].size - a[1].n[0].size || b[1].n[1].size - a[1].n[1].size).slice(0, 500)
    .map(([name, s]) => el("tr", {},
      el("td", {}, el("button", { class: "linkish", text: name,
        onclick: () => { S.person = name; location.hash = "#code"; } })),
      el("td", { style: `color:${colorOf(s.co)}`, text: s.co }),
      ...s.n.map((x) => el("td", { class: "n", text: String(x.size) })))));
}

function renderItems(id, items, fmt) {
  const box = clear($(id));
  if (!items.length) box.append(el("p", { class: "sub", text: "Nothing yet for this selection." }));
  for (const it of items.slice(0, 300)) box.append(fmt(it));
}
const pick = (p) => inGroup(p.company, SELG()) && (S.legacy || !p.legacy);

function renderCommunity() {
  const start = periodStart();
  const items = (COMM.items || []).filter((i) => i.date >= start && i.people.some(pick));
  renderItems("community", items, (i) => el("div", { class: "item" },
    el("div", { class: "date", text: `${i.date} · ${i.event} · ${i.kind}` }),
    i.url ? link(i.url, i.title || i.kind) : el("span", { text: i.title }),
    el("div", { class: "credit", text: i.people.map((p) => `${p.name} (${p.company}${p.legacy ? ", legacy" : ""})`).join(", ") })));
}

function renderBlog() {
  const start = periodStart();
  const posts = (BLOG.posts || []).filter((p) => p.date >= start && pick(p));
  renderItems("blog", posts, (p) => el("div", { class: "item" },
    el("div", { class: "date", text: `${p.date} · ${p.source}${p.legacy ? " · legacy" : ""}` }),
    link(p.url, p.title),
    el("div", { class: "credit", style: `color:${colorOf(p.company)}`, text: `${p.author ? p.author + " · " : ""}${p.company}` })));
}

function exportRows(rows) {
  const g = SELG();
  return rows.map((c) => ({ date: c.date, subject: c.subject, type: c.type,
    people: ["authors", "reviewers"].flatMap((r) => credit(c, r, g).map((p) => `${p.name} (${p.company}, ${r.slice(0, -1)})`)).join("; "),
    url: `https://github.com/postgres/postgres/commit/${c.sha}` }));
}

function render() {
  S.tab = (location.hash || "#code").slice(1) || "code";
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== S.tab; });
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === S.tab));
  seg("period", [["ytd", `${new Date(DATA.head_date).getUTCFullYear()} so far`], ["6m", "Last 6 months"], ["3m", "Last 3 months"], ["month", "This month"]], "period");
  const rows = inPeriod();
  renderSelection(); renderKpis(rows); renderChart(rows); renderRank(); renderAreas(rows); renderChanges(rows);
  renderPeople(); renderCommunity(); renderBlog();
}

async function main() {
  const get = (f) => fetch(f).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
  [DATA, RANK, COMM, BLOG] = await Promise.all(["data.json", "ranking.json", "community.json", "blog.json"].map(get));
  expand(DATA);
  ORDER = sorted(companyTotals(0, Object.keys(RANK.months))); // stable palette order
  readSel();
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
    el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "pg-changes.csv" }).click();
  });
  window.addEventListener("hashchange", render);
  render();
}
main();
