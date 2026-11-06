"use strict";
/* 공모주 기록장 - GitHub Pages 버전 (외부 라이브러리 없음)
 * - 공모주 일정: data/schedule.json (GitHub Actions가 6시간마다 38.co.kr에서 갱신)
 * - 내 기록: GitHub 저장소의 records.json (GitHub API로 읽기/쓰기). 미연결 시 이 기기(localStorage)에 저장.
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => (n == null || n === "" || isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
const signWon = (n) => (n == null ? "-" : (n > 0 ? "+" : "") + won(n));
const pct = (n, d = 2) => (n == null || !isFinite(n) ? "-" : (n > 0 ? "+" : "") + (n * 100).toFixed(d) + "%");
const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const md = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : "-");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const todayISO = () => iso(new Date());
const dday = (s) => {
  const diff = Math.round((parseISO(s) - parseISO(todayISO())) / 86400000);
  return diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
function busy(on) {
  let b = $(".busy");
  if (on && !b) { b = document.createElement("div"); b.className = "busy"; document.body.appendChild(b); }
  if (!on && b) b.remove();
}

/* ============================================================ 저장소 */
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const EMPTY = () => ({ version: 1, records: [] });

// 내 기록은 비공개 저장소에 저장 (이 앱 화면은 공개 저장소의 GitHub Pages)
const DEFAULT_DATA = { repo: "cokemania90-sys/claud1", branch: "", path: "ipo-tracker/records.json" };
function ghConfig() {
  const c = ls.get("gh", null);
  return c && c.token && c.repo ? { ...DEFAULT_DATA, ...c } : null;
}

const LocalStore = {
  kind: "local",
  async load() { return ls.get("records", EMPTY()); },
  async mutate(fn) { const d = ls.get("records", EMPTY()); const r = fn(d); ls.set("records", d); return { data: d, result: r }; },
};

function GitHubStore(cfg) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  async function get() {
    const ref = cfg.branch ? `ref=${encodeURIComponent(cfg.branch)}&` : "";
    const res = await fetch(`${url}?${ref}t=${Date.now()}`, { headers, cache: "no-store" });
    if (res.status === 404) return { data: EMPTY(), sha: null };
    if (!res.ok) throw new Error(ghError(res.status, await res.text()));
    const j = await res.json();
    return { data: JSON.parse(b64decode(j.content) || "{}"), sha: j.sha };
  }
  async function put(data, sha, message) {
    const res = await fetch(url, {
      method: "PUT", headers,
      body: JSON.stringify({ message, branch: cfg.branch || undefined, sha: sha || undefined, content: b64encode(JSON.stringify(data, null, 1) + "\n") }),
    });
    if (res.status === 409 || res.status === 422) return false; // 다른 기기에서 먼저 저장 → 다시 시도
    if (!res.ok) throw new Error(ghError(res.status, await res.text()));
    return true;
  }
  return {
    kind: "github", cfg,
    async load() { const { data } = await get(); data.records ||= []; return data; },
    async mutate(fn, message = "ipo: 기록 수정") {
      for (let i = 0; i < 3; i++) {
        const { data, sha } = await get();
        data.records ||= [];
        const result = fn(data);
        if (await put(data, sha, message)) return { data, result };
      }
      throw new Error("저장 충돌이 계속돼요. 새로고침 후 다시 시도하세요.");
    },
  };
}
function ghError(status, body) {
  if (status === 401) return "토큰이 올바르지 않거나 만료됐어요.";
  if (status === 403) return "토큰 권한이 부족해요 (Contents: Read and write 필요).";
  if (status === 404) return "저장소나 브랜치를 찾을 수 없어요.";
  try { return `GitHub 오류 ${status}: ${JSON.parse(body).message}`; } catch { return `GitHub 오류 ${status}`; }
}

let store = ghConfig() ? GitHubStore(ghConfig()) : LocalStore;

/* ============================================================ 메시지 파서 */
function toDate(s) {
  const m = String(s || "").match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}
function toRange(s) {
  const m = String(s || "").match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s*~\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})/);
  if (!m) return [null, null];
  const y = +m[1], mo = +m[2], d = +m[3], mo2 = +m[5], d2 = +m[6];
  const y2 = m[4] ? +m[4] : mo2 < mo ? y + 1 : y;
  const f = (a, b, c) => `${a}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
  return [f(y, mo, d), f(y2, mo2, d2)];
}
function toNum(s) {
  if (s == null) return null;
  const t = String(s).replace(/[^\d.\-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
}
function parseMessage(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/^\s*■\s*/m).slice(1);
  return blocks.map((b) => {
    const lines = b.trim().split("\n");
    const head = lines[0].trim();
    const m = head.match(/^(.+?)\s*[(（](.+?)[)）]\s*$/);
    const body = lines.slice(1).join("\n");
    const f = (label) => { const x = body.match(new RegExp("\\*?\\s*" + label + "[^:：\\n]*[:：]\\s*(.+)")); return x ? x[1].trim() : null; };
    const [sub_start, sub_end] = toRange(f("청약기간"));
    const comp = f("기관경쟁률");
    return {
      name: (m ? m[1] : head).trim(), broker: m ? m[2].trim() : null, sub_start, sub_end,
      refund_date: toDate(f("환불일")), listing_date: toDate(f("상장일")),
      offer_price: toNum(f("공모가")), inst_competition: comp && /\d/.test(comp) ? comp : null,
      offer_amount: toNum(f("공모금액")), lockup_pct: toNum(f("의무보유확약")),
      entry_score: toNum(f("진입가능척도")), raw_message: "■ " + b.trim(),
    };
  });
}

/* ============================================================ 상태 */
const S = {
  schedule: [],
  records: [],
  lastRefresh: null,
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  recFilter: "all",
  statYear: "all",
  statPeriod: "month",
};
const SCHED_FIELDS = ["sub_start", "sub_end", "refund_date", "listing_date", "offer_price", "inst_competition", "offer_amount", "lockup_pct"];
const mineKey = (name) => String(name || "").replace(/\(.*?\)/g, "").replace(/\s+/g, "").toLowerCase();
const findSchedule = (name) => S.schedule.find((s) => mineKey(s.name) === mineKey(name));

/** 기록에 비어 있는 값을 일정 데이터로 채움 (화면 표시용 복사본) */
function hydrate(r) {
  const s = (r.schedule_no && S.schedule.find((x) => x.no === r.schedule_no)) || findSchedule(r.name);
  const out = { ...r, sales: r.sales || [] };
  if (s) {
    out.schedule_no = s.no;
    for (const k of SCHED_FIELDS) if (out[k] == null || out[k] === "") out[k] = s[k];
  }
  return out;
}

/* ============================================================ 기록 변경 */
function upsertInto(data, rec) {
  const s = (rec.schedule_no && S.schedule.find((x) => x.no === rec.schedule_no)) || findSchedule(rec.name);
  if (s) rec.schedule_no = s.no;
  const ex = data.records.find((r) => r.name === rec.name && (r.broker || "") === (rec.broker || ""));
  if (ex) {
    for (const [k, v] of Object.entries(rec)) if (v != null && v !== "") ex[k] = v;
    return { id: ex.id, name: ex.name, created: false };
  }
  const n = { id: uid(), created_at: new Date().toISOString(), sales: [] };
  for (const [k, v] of Object.entries(rec)) if (v != null && v !== "") n[k] = v;
  data.records.push(n);
  return { id: n.id, name: n.name, created: true };
}

async function mutate(fn, message) {
  busy(true);
  try {
    const { data, result } = await store.mutate(fn, message);
    setRecords(data);
    return result;
  } finally { busy(false); }
}

const Actions = {
  addFromMessage: (text) => {
    const parsed = parseMessage(text);
    if (!parsed.length) throw new Error("'■ 종목명 (증권사)' 형식의 줄을 찾지 못했어요.");
    return mutate((d) => parsed.map((p) => upsertInto(d, p)), `ipo: 청약 기록 ${parsed.map((p) => p.name).join(", ")}`);
  },
  addFromSchedule: (s) =>
    mutate((d) => upsertInto(d, { name: s.name, broker: (s.brokers || "").split(",")[0].trim() || null, schedule_no: s.no,
      ...Object.fromEntries(SCHED_FIELDS.map((k) => [k, s[k]])) }), `ipo: 청약 기록 ${s.name}`),
  update: (id, fields) =>
    mutate((d) => { const r = d.records.find((x) => x.id === id); if (r) Object.assign(r, fields); }, `ipo: ${fields.name || "기록"} 수정`),
  remove: (id) => mutate((d) => { d.records = d.records.filter((x) => x.id !== id); }, "ipo: 기록 삭제"),
  addSale: (id, fields, sale) =>
    mutate((d) => {
      const r = d.records.find((x) => x.id === id);
      if (!r) throw new Error("기록을 찾을 수 없어요.");
      Object.assign(r, fields);
      (r.sales ||= []).push({ id: uid(), ...sale });
      r.sales.sort((a, b) => String(a.sell_date).localeCompare(String(b.sell_date)));
    }, `ipo: ${fields.name || ""} 매도 기록`),
  removeSale: (id, saleId) =>
    mutate((d) => { const r = d.records.find((x) => x.id === id); if (r) r.sales = (r.sales || []).filter((s) => s.id !== saleId); }, "ipo: 매도 기록 삭제"),
};

/* ============================================================ 계산 */
function calc(r) {
  const sales = r.sales || [];
  const sold = sales.reduce((a, s) => a + (+s.qty || 0), 0);
  const proceeds = sales.reduce((a, s) => a + (+s.qty || 0) * (+s.price || 0), 0);
  const fees = sales.reduce((a, s) => a + (+s.fee || 0), 0) + (+r.sub_fee || 0);
  const cost = sold * (+r.offer_price || 0);
  const profit = sold ? proceeds - cost - fees : (r.sub_fee ? -r.sub_fee : 0);
  const firstSell = sales.map((s) => s.sell_date).filter(Boolean).sort()[0] || null;
  return { sold, proceeds, fees, cost, profit, ret: cost ? profit / cost : null, firstSell, avgSell: sold ? proceeds / sold : null };
}

function status(r) {
  const t = todayISO();
  const c = calc(r);
  if (r.sub_start && t < r.sub_start) return ["청약예정", "s-plan", "active"];
  if (r.sub_end && t <= r.sub_end) return ["청약중", "s-sub", "active"];
  if (r.allocated_qty == null || r.allocated_qty === "") {
    if (r.listing_date && t >= r.listing_date) return ["배정 입력 필요", "s-need", "active"];
    return ["배정 대기", "s-wait", "active"];
  }
  if (+r.allocated_qty === 0) return ["미배정", "s-none", "done"];
  if (c.sold >= +r.allocated_qty) return ["매도완료", "s-done", "done"];
  if (r.listing_date && t < r.listing_date && !c.sold) return ["상장 대기", "s-wait", "active"];
  if (r.listing_date && t === r.listing_date && c.sold === 0) return ["오늘 상장", "s-listing", "holding"];
  if (c.sold < +r.allocated_qty) return [c.sold ? "일부 매도" : "보유중", "s-hold", "holding"];
  return ["매도완료", "s-done", "done"];
}

function myRecordFor(sch) {
  return S.records.find((r) => r.schedule_no === sch.no) || S.records.find((r) => mineKey(r.name) === mineKey(sch.name));
}

/* ============================================================ 로드 */
let rawRecords = EMPTY();
function setRecords(data) {
  rawRecords = data;
  S.records = (data.records || []).map(hydrate).sort((a, b) => String(b.sub_start || "").localeCompare(String(a.sub_start || "")));
  $("#brokerList").innerHTML = [...new Set(S.records.map((r) => r.broker).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join("");
  renderAll();
}

async function loadSchedule() {
  try {
    const res = await fetch(`data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
    const j = await res.json();
    S.schedule = j.items || [];
    S.lastRefresh = j.last_refresh;
  } catch (e) {
    toast("일정 데이터를 불러오지 못했어요");
  }
}
async function loadAll() {
  busy(true);
  try {
    await loadSchedule();
    try {
      setRecords(await store.load());
    } catch (e) {
      setRecords(rawRecords);
      toast("기록 불러오기 실패: " + e.message);
    }
  } finally { busy(false); }
}

function renderAll() {
  renderConn();
  renderCalendar();
  renderSide();
  renderRecords();
  renderStats();
  renderAlerts();
}

function renderConn() {
  const bar = $("#connBar");
  if (store.kind === "github") {
    bar.classList.add("hidden");
    return;
  }
  const n = (ls.get("records", EMPTY()).records || []).length;
  bar.innerHTML = `⚠ GitHub 미연결 — 기록이 <b>이 기기에만</b> 저장돼요${n ? ` (${n}건)` : ""}. 핸드폰·PC에서 같이 보려면 연결하세요. <button class="primary" id="btnConnBar">GitHub 연결</button>`;
  bar.classList.remove("hidden");
  $("#btnConnBar").onclick = openSettings;
}

/* ============================================================ 캘린더 */
function calendarEvents() {
  const ev = [];
  const seen = new Set();
  const fMine = $("#fMine").checked;
  const add = (date, kind, name, ref, mine) => { if (date) ev.push({ date, kind, name, ref, mine }); };
  const addSub = (s, e, name, ref, mine) => {
    if (!s || !e) return;
    for (let d = parseISO(s); iso(d) <= e; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) add(iso(d), "sub", name, ref, mine);
  };
  for (const s of S.schedule) {
    const rec = myRecordFor(s);
    if (rec) seen.add(rec.id);
    if (fMine && !rec) continue;
    const ref = rec ? { rec: rec.id } : { sch: s.no };
    addSub(rec?.sub_start || s.sub_start, rec?.sub_end || s.sub_end, s.name, ref, !!rec);
    add(rec ? rec.listing_date : s.listing_date, "list", s.name, ref, !!rec);
    if (rec) add(rec.refund_date, "refund", s.name, ref, true);
  }
  for (const r of S.records) {
    if (seen.has(r.id)) continue;
    const ref = { rec: r.id };
    addSub(r.sub_start, r.sub_end, r.name, ref, true);
    add(r.listing_date, "list", r.name, ref, true);
    add(r.refund_date, "refund", r.name, ref, true);
  }
  const on = { sub: $("#fSub").checked, list: $("#fList").checked, refund: $("#fRefund").checked };
  const order = { list: 0, sub: 1, refund: 2 };
  return ev.filter((e) => on[e.kind]).sort((a, b) => (b.mine - a.mine) || (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name));
}

const LABEL = { sub: "청약", list: "상장", refund: "환불" };
const evBtn = (e) => `<button class="ev ${e.kind}${e.mine ? " mine" : ""}" data-ref='${esc(JSON.stringify(e.ref))}' title="${LABEL[e.kind]} · ${esc(e.name)}">${e.mine ? "★ " : ""}${LABEL[e.kind]} ${esc(e.name)}</button>`;

function renderCalendar() {
  const m = S.month;
  $("#calTitle").textContent = `${m.getFullYear()}년 ${m.getMonth() + 1}월`;
  const byDate = {};
  for (const e of calendarEvents()) (byDate[e.date] ||= []).push(e);
  const start = new Date(m.getFullYear(), m.getMonth(), 1 - m.getDay());
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const weeks = Math.ceil((m.getDay() + last.getDate()) / 7);
  const t = todayISO();
  const MAX = window.innerWidth < 700 ? 3 : 5;
  let h = DOW.map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = iso(d);
    const evs = byDate[ds] || [];
    const c = ["cal-day", d.getMonth() !== m.getMonth() && "other", ds === t && "today", d.getDay() === 0 && "sun weekend", d.getDay() === 6 && "sat weekend"].filter(Boolean).join(" ");
    const shown = evs.length > MAX + 1 ? evs.slice(0, MAX) : evs;
    h += `<div class="${c}" data-date="${ds}"><span class="dnum">${d.getDate()}</span>` + shown.map(evBtn).join("") +
      (evs.length > shown.length ? `<button class="more" data-date="${ds}">+${evs.length - shown.length}개</button>` : "") + `</div>`;
  }
  $("#calGrid").innerHTML = h;
  $("#lastRefresh").textContent = S.lastRefresh ? `일정 갱신 ${S.lastRefresh.replace("T", " ").slice(0, 16)} · 6시간마다 자동` : "";
}

function renderSide() {
  const t = todayISO();
  const items = [];
  for (const r of S.records) {
    const push = (date, kind, label) => { if (date && date >= t) items.push({ date, kind, label, r }); };
    push(r.sub_end, "sub", "청약 마감");
    push(r.refund_date, "refund", "환불");
    push(r.listing_date, "list", "상장");
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  $("#upcoming").innerHTML = items.slice(0, 8).map((i) =>
    `<li data-rec="${esc(i.r.id)}"><span class="dd ${i.kind}">${dday(i.date)}</span><span class="t"><b>${esc(i.r.name)}</b><span>${i.label} · ${md(i.date)} · ${esc(i.r.broker || "")}</span></span></li>`
  ).join("") || `<li class="none">예정된 내 일정이 없어요.</li>`;

  const end = new Date(); end.setDate(end.getDate() + 7);
  const e = iso(end);
  const week = S.schedule.filter((s) => s.sub_end >= t && s.sub_start <= e).sort((a, b) => a.sub_start.localeCompare(b.sub_start));
  $("#weekSubs").innerHTML = week.map((s) => {
    const mine = myRecordFor(s);
    return `<li data-sch="${s.no}"><span class="dd sub">${md(s.sub_start)}</span><span class="t"><b>${mine ? "★ " : ""}${esc(s.name)}</b><span>${esc(s.brokers || "")} · ${s.offer_price ? won(s.offer_price) + "원" : esc(s.price_band || "")}</span></span></li>`;
  }).join("") || `<li class="none">이번 주 청약 일정이 없어요.</li>`;
}

function openEvent(ref) {
  if (ref.rec) return openRecord(ref.rec);
  const s = S.schedule.find((x) => x.no === ref.sch);
  if (!s) return;
  const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${v}</dd>`);
  $("#eventBody").innerHTML = `
    <div class="rec-title"><h2>${esc(s.name)}</h2>${s.market ? `<span class="badge">${esc(s.market)}</span>` : ""}</div>
    <dl class="ev-info">
      ${row("주간사", esc(s.brokers))}
      ${row("수요예측", s.forecast_start ? `${s.forecast_start} ~ ${md(s.forecast_end)}` : "")}
      ${row("청약기간", `${s.sub_start} ~ ${md(s.sub_end)}`)}
      ${row("환불일", s.refund_date)}
      ${row("상장일", s.listing_date)}
      ${row("확정공모가", s.offer_price ? won(s.offer_price) + "원" : "")}
      ${row("희망공모가", esc(s.price_band))}
      ${row("기관경쟁률", esc(s.inst_competition))}
      ${row("의무보유확약", s.lockup_pct != null ? s.lockup_pct + "%" : "")}
      ${row("청약경쟁률", esc(s.competition))}
      ${row("공모금액", s.offer_amount ? won(s.offer_amount) + " 백만원" : "")}
      ${row("청약한도", s.sub_limit ? esc(s.sub_limit) + "주" : "")}
    </dl>
    <div class="dlg-actions">
      <a class="muted small" href="https://www.38.co.kr/html/fund/?o=v&no=${s.no}" target="_blank" rel="noopener">38 상세 ↗</a>
      <span class="grow"></span>
      <button class="ghost" data-close>닫기</button>
      <button class="primary" id="btnSchAdd">청약할래요</button>
    </div>`;
  $("#btnSchAdd").onclick = async () => {
    try {
      const r = await Actions.addFromSchedule(s);
      $("#dlgEvent").close();
      toast(`${s.name} 청약 기록을 추가했어요`);
      openRecord(r.id);
    } catch (e) { toast(e.message); }
  };
  $("#dlgEvent").showModal();
}

function openDay(date) {
  const evs = calendarEvents().filter((e) => e.date === date);
  $("#eventBody").innerHTML = `<h2>${md(date)} (${DOW[parseISO(date).getDay()]})</h2>
    <div class="upcoming">${evs.map(evBtn).join("")}</div>
    <div class="dlg-actions"><button class="ghost" data-close>닫기</button></div>`;
  $("#dlgEvent").showModal();
}

/* ============================================================ 기록 목록 */
function renderRecords() {
  const q = $("#recSearch").value.trim().toLowerCase();
  const rows = S.records.filter((r) => {
    if (S.recFilter !== "all" && status(r)[2] !== S.recFilter) return false;
    if (q && !`${r.name} ${r.broker || ""} ${r.account || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $("#recEmpty").classList.toggle("hidden", S.records.length > 0);
  $("#recBody").innerHTML = rows.map((r) => {
    const [label, c] = status(r);
    const k = calc(r);
    return `<tr data-rec="${esc(r.id)}">
      <td><span class="badge ${c}">${label}</span></td>
      <td class="name"><b>${esc(r.name)}</b>${r.account ? `<small>${esc(r.account)}</small>` : ""}</td>
      <td>${esc(r.broker || "-")}</td>
      <td>${r.sub_start ? `${md(r.sub_start)}~${md(r.sub_end)}` : "-"}</td>
      <td>${r.listing_date || "-"}</td>
      <td class="r">${won(r.offer_price)}</td>
      <td class="r">${r.allocated_qty == null || r.allocated_qty === "" ? "-" : won(r.allocated_qty)}</td>
      <td class="r">${k.sold ? `${won(k.sold)}주 @${won(k.avgSell)}` : "-"}</td>
      <td class="r ${cls(k.profit)}"><b>${k.sold || r.sub_fee ? signWon(k.profit) : "-"}</b></td>
      <td class="r ${cls(k.ret)}">${k.sold ? pct(k.ret) : "-"}</td>
    </tr>`;
  }).join("");
}

/* ============================================================ 기록 상세/편집 */
let curId = null;
const curRec = () => S.records.find((x) => x.id === curId);

function openRecord(id) {
  const r = S.records.find((x) => x.id === id);
  if (!r) return;
  curId = id;
  const f = $("#formRec");
  for (const el of f.elements) if (el.name) el.value = r[el.name] ?? "";
  $("#recTitle").textContent = r.name;
  const [label, c] = status(r);
  $("#recStatus").className = "badge " + c;
  $("#recStatus").textContent = label;
  renderSales();
  const sf = $("#formSale");
  sf.reset();
  const k = calc(r);
  sf.sell_date.value = r.listing_date && r.listing_date <= todayISO() && !k.sold ? r.listing_date : todayISO();
  const rem = (+r.allocated_qty || 0) - k.sold;
  if (rem > 0) sf.qty.value = rem;
  if (!$("#dlgRec").open) $("#dlgRec").showModal();
}

function renderSales() {
  const r = curRec();
  if (!r) return;
  const k = calc(r);
  $("#salesTable").innerHTML = r.sales.length
    ? `<thead><tr><th>매도일</th><th class="r">수량</th><th class="r">매도가</th><th class="r">공모가 대비</th><th class="r">수수료·세금</th><th class="r">손익</th><th></th></tr></thead><tbody>` +
      r.sales.map((s) => {
        const p = s.qty * (s.price - (r.offer_price || 0)) - (s.fee || 0);
        const d = r.offer_price ? (s.price - r.offer_price) / r.offer_price : null;
        return `<tr><td>${s.sell_date || "-"}</td><td class="r">${won(s.qty)}</td><td class="r">${won(s.price)}</td>
          <td class="r ${cls(d)}">${pct(d)}</td><td class="r">${won(s.fee)}</td><td class="r ${cls(p)}"><b>${signWon(p)}</b></td>
          <td class="r"><button class="x-del" data-sale="${esc(s.id)}" aria-label="삭제">✕</button></td></tr>`;
      }).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">아직 매도 기록이 없어요.</td></tr></tbody>`;
  const hasAlloc = !(r.allocated_qty == null || r.allocated_qty === "");
  $("#recSummary").innerHTML = `
    <div><div class="l">배정 / 남은 수량</div><div class="v">${hasAlloc ? won(r.allocated_qty) + "주" : "-"} / ${hasAlloc ? won(+r.allocated_qty - k.sold) + "주" : "-"}</div></div>
    <div><div class="l">평균 매도가</div><div class="v">${k.avgSell ? won(k.avgSell) + "원" : "-"}</div></div>
    <div><div class="l">실현손익</div><div class="v ${cls(k.profit)}">${signWon(k.profit)}원</div></div>
    <div><div class="l">수익률</div><div class="v ${cls(k.ret)}">${pct(k.ret)}</div></div>`;
}

function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    let v = el.value.trim();
    if (el.hasAttribute("data-num")) v = v === "" ? null : Number(v.replace(/,/g, ""));
    else if (v === "") v = null;
    out[el.name] = v;
  }
  return out;
}

/* ============================================================ 통계 */
function periodKey(d, p) {
  const y = d.slice(0, 4), m = +d.slice(5, 7);
  return p === "year" ? y : p === "quarter" ? `${y} Q${Math.ceil(m / 3)}` : `${y}.${String(m).padStart(2, "0")}`;
}

function renderStats() {
  const all = S.records.map((r) => ({ r, k: calc(r) })).map((x) => ({ ...x, date: x.k.firstSell || x.r.listing_date || x.r.sub_end }));
  const years = [...new Set(all.map((x) => x.date && x.date.slice(0, 4)).filter(Boolean))].sort().reverse();
  if (S.statYear !== "all" && !years.includes(S.statYear)) S.statYear = "all";
  $("#statYear").innerHTML = [`<button data-y="all" class="${S.statYear === "all" ? "on" : ""}">전체</button>`]
    .concat(years.map((y) => `<button data-y="${y}" class="${S.statYear === y ? "on" : ""}">${y}</button>`)).join("");

  const inYear = all.filter((x) => S.statYear === "all" || (x.date || "").startsWith(S.statYear));
  const sold = inYear.filter((x) => x.k.sold > 0);
  const totalProfit = inYear.reduce((a, x) => a + x.k.profit, 0);
  const totalCost = sold.reduce((a, x) => a + x.k.cost, 0);
  const allocated = inYear.filter((x) => !(x.r.allocated_qty == null || x.r.allocated_qty === ""));
  const gotShares = allocated.filter((x) => +x.r.allocated_qty > 0);
  const wins = sold.filter((x) => x.k.profit > 0).length;
  const best = sold.slice().sort((a, b) => b.k.profit - a.k.profit)[0];

  $("#kpis").innerHTML = [
    ["실현손익", `<span class="${cls(totalProfit)}">${signWon(totalProfit)}원</span>`, `매도 ${sold.length}종목`],
    ["평균 수익률", `<span class="${cls(totalProfit)}">${pct(totalCost ? totalProfit / totalCost : null)}</span>`, `매도 원가 ${won(totalCost)}원 기준`],
    ["참여 종목", `${inYear.length}건`, `배정 성공 ${gotShares.length} / ${allocated.length}`],
    ["승률", sold.length ? `${Math.round((wins / sold.length) * 100)}%` : "-", `수익 ${wins} · 손실 ${sold.length - wins}`],
    ["최고 수익", best ? `<span class="${cls(best.k.profit)}">${signWon(best.k.profit)}</span>` : "-", best ? esc(best.r.name) : ""],
  ].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  const per = {};
  for (const x of inYear) {
    if (!x.date || (!x.k.sold && !x.r.sub_fee)) continue;
    const key = periodKey(x.date, S.statPeriod);
    (per[key] ||= { profit: 0, n: 0 }).profit += x.k.profit;
    per[key].n++;
  }
  const keys = Object.keys(per).sort();
  const maxAbs = Math.max(1, ...keys.map((k) => Math.abs(per[k].profit)));
  const anyNeg = keys.some((k) => per[k].profit < 0);
  $("#periodChart").innerHTML = keys.length
    ? keys.map((k) => {
        const v = per[k].profit, h = (Math.abs(v) / maxAbs) * 100;
        const short = Math.abs(v) >= 10000 ? (v / 10000).toFixed(Math.abs(v) >= 1e6 ? 0 : 1) + "만" : won(v);
        return `<div class="bar-col" title="${k}: ${signWon(v)}원 (${per[k].n}종목)">
          <div class="val ${cls(v)}">${short}</div>
          <div class="bar-area"><div class="pos">${v > 0 ? `<div class="bar up" style="height:${h}%"></div>` : ""}</div>
          ${anyNeg ? `<div class="neg">${v < 0 ? `<div class="bar down" style="height:${h}%"></div>` : ""}</div>` : ""}</div>
          <div class="lab">${k}</div></div>`;
      }).join("")
    : `<p class="empty">매도 기록이 생기면 여기에 기간별 손익이 표시돼요.</p>`;

  const br = {};
  for (const x of inYear) {
    const b = x.r.broker || "(미지정)";
    const o = (br[b] ||= { n: 0, alloc: 0, allocN: 0, cost: 0, profit: 0 });
    o.n++;
    if (+x.r.allocated_qty > 0) { o.allocN++; o.alloc += +x.r.allocated_qty; }
    o.cost += x.k.cost;
    o.profit += x.k.profit;
  }
  const bl = Object.entries(br).sort((a, b) => b[1].profit - a[1].profit);
  const bMax = Math.max(0.0001, ...bl.map(([, o]) => Math.abs(o.cost ? o.profit / o.cost : 0)));
  $("#brokerTable").innerHTML = bl.length
    ? `<thead><tr><th>증권사</th><th class="r">참여/배정</th><th class="r">배정주</th><th class="r">손익</th><th class="r">수익률</th><th></th></tr></thead><tbody>` +
      bl.map(([b, o]) => {
        const ret = o.cost ? o.profit / o.cost : null;
        const w = ret == null ? 0 : (Math.abs(ret) / bMax) * 100;
        return `<tr><td><b>${esc(b)}</b></td><td class="r">${o.n} / ${o.allocN}</td><td class="r">${won(o.alloc)}</td>
          <td class="r ${cls(o.profit)}">${signWon(o.profit)}</td><td class="r ${cls(ret)}"><b>${pct(ret)}</b></td>
          <td><div class="hbar"><i style="left:0;width:${w}%;background:var(--${ret < 0 ? "down" : "up"})"></i></div></td></tr>`;
      }).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">기록이 없어요.</td></tr></tbody>`;

  const rank = sold.slice().sort((a, b) => b.k.profit - a.k.profit);
  $("#rankTable").innerHTML = rank.length
    ? `<thead><tr><th>#</th><th>종목</th><th>증권사</th><th class="r">매도</th><th class="r">손익</th><th class="r">수익률</th></tr></thead><tbody>` +
      rank.map((x, i) => `<tr data-rec="${esc(x.r.id)}" style="cursor:pointer"><td class="muted">${i + 1}</td><td><b>${esc(x.r.name)}</b></td><td>${esc(x.r.broker || "-")}</td>
        <td class="r">${won(x.k.sold)}주</td><td class="r ${cls(x.k.profit)}">${signWon(x.k.profit)}</td><td class="r ${cls(x.k.ret)}"><b>${pct(x.k.ret)}</b></td></tr>`).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">매도 기록이 없어요.</td></tr></tbody>`;
}

/* ============================================================ 화면 상단 알림 */
function renderAlerts() {
  const t = todayISO();
  const tm = iso(new Date(Date.now() + 86400000));
  const msgs = [];
  for (const r of S.records) {
    if (r.allocated_qty !== null && r.allocated_qty !== undefined && r.allocated_qty !== "" && +r.allocated_qty === 0) continue;
    if (r.listing_date === t) msgs.push({ r, html: `📈 오늘 <b>${esc(r.name)}</b> 상장일${r.allocated_qty ? ` (${won(r.allocated_qty)}주 · 공모가 ${won(r.offer_price)}원)` : ""}` });
    else if (r.listing_date === tm) msgs.push({ r, html: `내일 <b>${esc(r.name)}</b> 상장` });
    if (r.sub_end === t) msgs.push({ r, html: `오늘 <b>${esc(r.name)}</b> 청약 마감` });
    if (r.refund_date === t) msgs.push({ r, html: `오늘 <b>${esc(r.name)}</b> 환불일 — 배정 수량 입력` });
  }
  const bar = $("#alertBar");
  bar.innerHTML = msgs.map((m) => `<button class="chip-btn" data-rec="${esc(m.r.id)}">${m.html}</button>`).join("");
  bar.classList.toggle("hidden", !msgs.length);
}

/* ============================================================ 설정 */
function openSettings() {
  const c = ls.get("gh", {}) || {};
  const f = $("#formSettings");
  f.repo.value = c.repo || DEFAULT_DATA.repo;
  f.branch.value = c.branch || "";
  f.path.value = c.path || DEFAULT_DATA.path;
  f.token.value = c.token || "";
  $("#settingsMsg").innerHTML = "";
  $("#btnDisconnect").classList.toggle("hidden", !c.token);
  $("#dlgSettings").showModal();
}

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target;
  const cfg = { repo: f.repo.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), branch: f.branch.value.trim(), path: f.path.value.trim() || DEFAULT_DATA.path, token: f.token.value.trim() };
  const msg = $("#settingsMsg");
  if (!cfg.token) { msg.innerHTML = `<div class="pv"><span class="warn">토큰을 입력하세요.</span></div>`; return; }
  msg.innerHTML = `<div class="pv">연결 확인 중…</div>`;
  try {
    const gh = GitHubStore(cfg);
    const remote = await gh.load();
    ls.set("gh", cfg);
    store = gh;
    // 이 기기에만 있던 기록이 있으면 합치기
    const local = ls.get("records", EMPTY()).records || [];
    if (local.length && confirm(`이 기기에만 저장된 기록 ${local.length}건을 GitHub에 합칠까요?`)) {
      await mutate((d) => { for (const r of local) if (!d.records.some((x) => x.id === r.id)) d.records.push(r); }, "ipo: 기기 기록 합치기");
      ls.del("records");
    } else {
      setRecords(remote);
    }
    $("#dlgSettings").close();
    toast(`GitHub 연결 완료 · 기록 ${S.records.length}건`);
  } catch (err) {
    msg.innerHTML = `<div class="pv"><span class="warn">${esc(err.message)}</span></div>`;
  }
}

/* ============================================================ 이벤트 */
function bind() {
  $$(".tabs button").forEach((b) => (b.onclick = () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $$(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab));
    ls.set("tab", b.dataset.tab);
  }));
  $(`.tabs button[data-tab="${ls.get("tab", "calendar")}"]`)?.click();

  const shift = (n) => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); renderCalendar(); };
  $("#calPrev").onclick = () => shift(-1);
  $("#calNext").onclick = () => shift(1);
  $("#calToday").onclick = () => { const d = new Date(); S.month = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); };
  // 핸드폰: 캘린더 좌우 스와이프로 달 이동
  let sx = null;
  $("#calGrid").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("#calGrid").addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
    sx = null;
  });
  for (const id of ["fSub", "fList", "fRefund", "fMine"]) {
    const el = $("#" + id);
    el.checked = ls.get("cal:" + id, el.checked);
    el.onchange = () => { ls.set("cal:" + id, el.checked); renderCalendar(); };
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-ref],[data-rec],[data-sch],.more,[data-close],[data-sale]");
    if (!t) return;
    if (t.matches("[data-close]")) return t.closest("dialog").close();
    if (t.matches("[data-sale]")) return delSale(t.dataset.sale);
    if (t.matches(".more")) return openDay(t.dataset.date);
    if ($("#dlgEvent").open) $("#dlgEvent").close();
    if (t.dataset.ref) return openEvent(JSON.parse(t.dataset.ref));
    if (t.dataset.rec) return openRecord(t.dataset.rec);
    if (t.dataset.sch) return openEvent({ sch: +t.dataset.sch });
  });

  // 메시지로 기록 추가
  $("#btnAdd").onclick = () => { $("#addText").value = ""; $("#addPreview").innerHTML = ""; $("#dlgAdd").showModal(); $("#addText").focus(); };
  $("#addText").oninput = () => {
    const p = parseMessage($("#addText").value);
    $("#addPreview").innerHTML = p.map((x) => `<div class="pv"><b>${esc(x.name)}</b>${esc(x.broker || "")} · 청약 ${md(x.sub_start)}~${md(x.sub_end)} · 상장 ${x.listing_date || "?"} · 공모가 ${won(x.offer_price)}</div>`).join("")
      || ($("#addText").value.trim() ? `<div class="pv"><span class="warn">'■ 종목명 (증권사)' 줄을 찾지 못했어요.</span></div>` : "");
  };
  $("#formAdd").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#btnAddSave");
    btn.disabled = true;
    try {
      const saved = await Actions.addFromMessage($("#addText").value);
      $("#dlgAdd").close();
      toast(saved.map((x) => `${x.name} ${x.created ? "추가" : "갱신"}`).join(", "));
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  };

  $$("#recFilter button").forEach((b) => (b.onclick = () => {
    S.recFilter = b.dataset.f;
    $$("#recFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderRecords();
  }));
  $("#recSearch").oninput = renderRecords;

  $("#btnSaveRec").onclick = async () => {
    try { await Actions.update(curId, formValues($("#formRec"))); openRecord(curId); toast("저장했어요"); }
    catch (e) { toast(e.message); }
  };
  $("#btnDelRec").onclick = async () => {
    const r = curRec();
    if (!r || !confirm(`${r.name} 기록을 삭제할까요? 매도 기록도 함께 삭제돼요.`)) return;
    try { await Actions.remove(curId); $("#dlgRec").close(); toast("삭제했어요"); } catch (e) { toast(e.message); }
  };
  $("#feeRate").value = ls.get("feeRate", 0.22);
  $("#feeRate").onchange = () => ls.set("feeRate", +$("#feeRate").value || 0);
  $("#formSale").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const qty = +f.qty.value.replace(/,/g, ""), price = +f.price.value.replace(/,/g, "");
    if (!qty || !price) return toast("수량과 매도가를 입력하세요");
    const feeIn = f.fee.value.trim();
    const fee = feeIn === "" ? Math.round((qty * price * (+$("#feeRate").value || 0)) / 100) : +feeIn.replace(/,/g, "");
    try {
      // 입력 중이던 배정수량 등도 함께 저장
      await Actions.addSale(curId, formValues($("#formRec")), { sell_date: f.sell_date.value, qty, price, fee });
      openRecord(curId);
      toast("매도 기록을 추가했어요");
    } catch (err) { toast(err.message); }
  };

  $("#statYear").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.statYear = b.dataset.y; renderStats(); } };
  $$("#statPeriod button").forEach((b) => (b.onclick = () => {
    S.statPeriod = b.dataset.p;
    $$("#statPeriod button").forEach((x) => x.classList.toggle("on", x === b));
    renderStats();
  }));

  $("#btnSettings").onclick = openSettings;
  $("#formSettings").onsubmit = saveSettings;
  $("#btnDisconnect").onclick = () => {
    if (!confirm("이 기기에서 GitHub 연결을 해제할까요? (GitHub의 기록은 그대로 남아요)")) return;
    ls.del("gh");
    store = LocalStore;
    $("#dlgSettings").close();
    loadAll();
  };
}

async function delSale(saleId) {
  if (!confirm("이 매도 기록을 삭제할까요?")) return;
  try { await Actions.removeSale(curId, saleId); openRecord(curId); } catch (e) { toast(e.message); }
}

bind();
loadAll();
// 다른 기기에서 바꾼 내용 반영: 앱으로 돌아올 때 다시 불러오기
document.addEventListener("visibilitychange", () => { if (!document.hidden && !document.querySelector("dialog[open]")) loadAll(); });
