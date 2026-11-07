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
  create: (fields) => mutate((d) => upsertInto(d, { ...fields }), `ipo: 청약 기록 ${fields.name}`),
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
  setTransferred: (id, saleId, val) =>
    mutate((d) => {
      const r = d.records.find((x) => x.id === id);
      const s = r && (r.sales || []).find((x) => x.id === saleId);
      if (s) s.transferred = val;
    }, `ipo: 매도대금 이체 ${val ? "완료" : "취소"}`),
};

/* ============================================================ 출금 가능일 (매도일 D+2 영업일) */
let HOLIDAYS = new Set();
const isBizDay = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !HOLIDAYS.has(iso(d));
function addBizDays(s, n) {
  const d = parseISO(s);
  for (let k = 0; k < n; ) { d.setDate(d.getDate() + 1); if (isBizDay(d)) k++; }
  return iso(d);
}
const withdrawDate = (s) => (s.sell_date ? addBizDays(s.sell_date, 2) : null);
const saleCash = (s) => (+s.qty || 0) * (+s.price || 0) - (+s.fee || 0);
// 이 기능 이전 매도분은 이미 이체했다고 보고 알림 제외 (기록에서 체크를 풀면 다시 알림)
const TRANSFER_TRACK_FROM = "2026-11-07";
function isTransferred(s) {
  if (s.transferred != null) return !!s.transferred;
  const w = withdrawDate(s);
  return !!w && w < TRANSFER_TRACK_FROM;
}
/** 이체 안 한 매도대금: [{r, s, date, amt}] */
function pendingCash() {
  const out = [];
  for (const r of S.records) for (const s of r.sales || []) {
    const date = withdrawDate(s);
    if (date && !isTransferred(s)) out.push({ r, s, date, amt: saleCash(s) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ============================================================ 계산 */
/* ---------- 마이너스통장 이자 ---------- */
const appSettings = () => (typeof rawRecords !== "undefined" && rawRecords && rawRecords.settings) || {};
const daysBetween = (a, b) => (a && b ? Math.max(0, Math.round((parseISO(b) - parseISO(a)) / 86400000)) : 0);
const loanDays = (subEnd, refund) => daysBetween(subEnd, refund);
const interestOf = (amount, ratePct, days) => (amount && ratePct && days ? Math.round((amount * ratePct / 100 * days) / 365) : 0);
/** 기록의 마통 이자 (기록에 저장된 금리 우선, 없으면 설정 금리) */
function loanInterest(r) {
  // 예전 시트에서 가져온 기록처럼 실제 이자 금액이 저장돼 있으면 그 값을 그대로 사용
  if (r.loan_interest != null && r.loan_interest !== "") return +r.loan_interest || 0;
  const rate = r.loan_rate != null && r.loan_rate !== "" ? +r.loan_rate : +appSettings().loanRate || 0;
  return interestOf(+r.loan_amount || 0, rate, loanDays(r.sub_end || r.sub_start, r.refund_date));
}

function calc(r) {
  const sales = r.sales || [];
  const sold = sales.reduce((a, s) => a + (+s.qty || 0), 0);
  const proceeds = sales.reduce((a, s) => a + (+s.qty || 0) * (+s.price || 0), 0);
  const interest = appSettings().deductLoan ? loanInterest(r) : 0;
  const fees = sales.reduce((a, s) => a + (+s.fee || 0), 0) + (+r.sub_fee || 0) + interest;
  const cost = sold * (+r.offer_price || 0);
  // 매도한 기록만 손익 계산 (상장대기·배정대기·보유중은 null)
  const profit = sold ? proceeds - cost - fees : null;
  const firstSell = sales.map((s) => s.sell_date).filter(Boolean).sort()[0] || null;
  return { sold, proceeds, fees, interest, cost, profit, ret: cost ? profit / cost : null, firstSell, avgSell: sold ? proceeds / sold : null };
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
    const hj = await (await fetch(`data/holidays.json?t=${Date.now()}`, { cache: "no-store" })).json();
    HOLIDAYS = new Set(hj.dates || []);
  } catch (e) { /* 휴장일 목록이 없으면 주말만 제외 */ }
  try {
    const res = await fetch(`data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
    const j = await res.json();
    S.schedule = j.items || [];
    S.lastRefresh = j.last_refresh;
    // 종목명 자동완성: 최근 일정부터
    $("#schedList").innerHTML = S.schedule.slice().sort((a, b) => b.sub_start.localeCompare(a.sub_start))
      .map((s) => `<option value="${esc(s.name)}">${md(s.sub_start)}~${md(s.sub_end)} · ${esc(s.brokers || "")}</option>`).join("");
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
  renderLoan();
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
  const add = (date, kind, name, ref, mine, done) => { if (date) ev.push({ date, kind, name, ref, mine, done }); };
  // 매도대금 출금 가능일
  for (const r of S.records) for (const s of r.sales || []) {
    add(withdrawDate(s), "cash", `${r.name} ${won(saleCash(s))}원`, { rec: r.id }, true, isTransferred(s));
  }
  // 청약은 기간(보통 이틀) 중 마지막 날(마감일)에만 한 번 표시
  const addSub = (s, e, name, ref, mine) => { if (e || s) add(e || s, "sub", name, ref, mine); };
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
  const on = { sub: $("#fSub").checked, list: $("#fList").checked, refund: $("#fRefund").checked, cash: $("#fCash").checked };
  const order = { cash: 0, list: 1, sub: 2, refund: 3 };
  return ev.filter((e) => on[e.kind]).sort((a, b) => (b.mine - a.mine) || (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name));
}

const LABEL = { sub: "청약", list: "상장", refund: "환불", cash: "💰출금" };
const evBtn = (e) => {
  const star = e.mine && e.kind !== "cash" ? "★ " : "";
  const tip = `${LABEL[e.kind]} · ${e.name}${e.kind === "cash" ? (e.done ? " (이체 완료)" : " (이체 전)") : ""}`;
  return `<button class="ev ${e.kind}${e.mine ? " mine" : ""}${e.done ? " done" : ""}" data-ref='${esc(JSON.stringify(e.ref))}' title="${esc(tip)}">${star}${LABEL[e.kind]} ${esc(e.name)}</button>`;
};

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
  // 이체 안 한 매도대금은 날짜가 지났어도 계속 표시
  for (const p of pendingCash()) items.push({ date: p.date, kind: "cash", label: `${p.date <= t ? "출금 가능" : "출금 예정"} ${won(p.amt)}원`, r: p.r });
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
  $("#btnSchAdd").onclick = () => {
    $("#dlgEvent").close();
    openNewRecord(fromSchedule(s));
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
  const on = !!appSettings().deductLoan;
  $("#loanDeductState").innerHTML = `<span class="state ${on ? "on" : ""}">${on ? "마통 이자 반영 중" : "마통 이자 미반영 · 마통 계산 탭에서 켤 수 있어요"}</span>`;
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
      <td class="r">${allocText(r)}</td>
      <td class="r">${k.sold ? `${won(k.sold)}주 @${won(k.avgSell)}` : "-"}</td>
      <td class="r ${cls(k.profit)}"><b>${k.sold ? signWon(k.profit) : "-"}</b></td>
      <td class="r ${cls(k.ret)}">${k.sold ? pct(k.ret) : "-"}</td>
    </tr>`;
  }).join("");
}

/* ============================================================ 기록 상세/편집 */
let curId = null;
const curRec = () => S.records.find((x) => x.id === curId);

/** 일정(38) 정보 -> 기록 입력값 */
function fromSchedule(s) {
  const out = { name: s.name, schedule_no: s.no, broker: (s.brokers || "").split(",")[0].trim() || null };
  for (const k of SCHED_FIELDS) out[k] = s[k];
  return out;
}

function setBrokerOptions(sch) {
  const mine = S.records.map((r) => r.broker);
  const fromSch = sch ? (sch.brokers || "").split(",").map((b) => b.trim()) : [];
  $("#brokerList").innerHTML = [...new Set([...fromSch, ...mine].filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join("");
}

/** 종목명이 일정에 있으면 비어 있는 칸을 채움 */
function autofillFromName() {
  const f = $("#formRec");
  const s = findSchedule(f.name.value.trim());
  const msg = $("#autofillMsg");
  setBrokerOptions(s);
  if (!s) { msg.classList.add("hidden"); return; }
  const v = fromSchedule(s);
  const filled = [];
  for (const [k, val] of Object.entries(v)) {
    const el = f.elements[k];
    if (el && val != null && el.value === "") { el.value = val; if (k !== "schedule_no") filled.push(k); }
  }
  f.schedule_no.value = s.no;
  const brokers = (s.brokers || "").split(",").map((b) => b.trim()).filter(Boolean);
  msg.textContent = `38 일정에서 불러왔어요${filled.length ? ` (${filled.length}개 항목)` : ""}${brokers.length > 1 ? ` · 주간사: ${brokers.join(", ")}` : ""}`;
  msg.classList.remove("hidden");
}

/* ---------- 증거금 자동 계산: 청약수량 × 공모가(미확정이면 희망가 상단) × 증거금률(기본 50%) ---------- */
function depositBasis() {
  const f = $("#formRec");
  const s = (f.schedule_no.value && S.schedule.find((x) => x.no === +f.schedule_no.value)) || findSchedule(f.name.value.trim());
  let price = toNum(f.offer_price.value), priceNote = "";
  if (!price && s && s.price_band) {
    price = toNum(String(s.price_band).split("~").pop());
    priceNote = "희망가 상단";
  }
  const rate = (s && s.deposit_rate) || 50;
  return { price, rate, priceNote };
}
function calcDeposit() {
  const f = $("#formRec");
  const qty = toNum(f.applied_qty.value);
  const { price, rate } = depositBasis();
  return qty && price ? Math.round((qty * price * rate) / 100) : null;
}
/** 증거금 칸이 비었거나 자동 계산값이면 다시 계산 */
function syncDeposit(initial) {
  const f = $("#formRec");
  const dep = f.deposit;
  const calc = calcDeposit();
  if (initial) dep.dataset.auto = dep.value === "" || (calc != null && toNum(dep.value) === calc) ? "1" : "0";
  if (dep.dataset.auto === "1") dep.value = calc ?? "";
  const { price, rate, priceNote } = depositBasis();
  $("#depHint").textContent = dep.dataset.auto === "1" && price ? `자동 · ${rate}%${priceNote ? " · " + priceNote : ""}` : "";
}

/* ---------- 증권사별 청약수수료 (온라인 · 일반 등급 · 배정 1주 이상일 때만 부과) ----------
 * 2026-11 조사. VERIFIED_FEES = 각 증권사 공식 홈페이지/약관/공고에서 확인한 금액.
 * 나머지는 2026년 비교 사이트(gongmonow.com, simpleinvest.co.kr) 기준 추정치 → 설정에서 수정 가능. */
const DEFAULT_FEES = {
  // 공식 확인
  "한국투자증권": 2000, // 패밀리 2,000 / 프라임·골드·VIP 무료
  "NH투자증권": 2000,   // 나무멤버스 가입 시 면제
  "KB증권": 1500,       // 패밀리 1,500 / 베스트 이상 무료
  "미래에셋증권": 2000, // Silver 이상 면제
  "삼성증권": 2000,     // Honors 이상 면제
  "신한투자증권": 2000, // 일반 2,000 / 클래식 1,000 / 베스트 이상 면제
  "대신증권": 2000,
  "하나증권": 2000,     // 패밀리·그린 2,000
  "키움증권": 2000,     // 일반·준우대 2,000 / 우대 면제
  "유안타증권": 3000,   // 일반 3,000 / 프라임실버 이상 면제
  "메리츠증권": 2000,
  "교보증권": 2000,     // 안내 페이지 2,000 (약관에는 1,000으로 남아 있음)
  // 비교 사이트 기준 (공식 미확인)
  "유진투자증권": 2000, "한화투자증권": 2000, "IBK투자증권": 2000, "현대차증권": 2000, "신영증권": 2000,
  "DB증권": 2000, "LS증권": 2000, "아이엠증권": 2000, "SK증권": 2000, "우리투자증권": 2000,
  "토스증권": 2000, "카카오페이증권": 2000, "케이프투자증권": 2000, "상상인증권": 2000,
  "BNK투자증권": 1000, "부국증권": 0, "한양증권": 0, "다올투자증권": 0,
};
const VERIFIED_FEES = new Set(["한국투자증권", "NH투자증권", "KB증권", "미래에셋증권", "삼성증권", "신한투자증권",
  "대신증권", "하나증권", "키움증권", "유안타증권", "메리츠증권", "교보증권"]);
// 줄임말 -> 정식 이름 (앞부분 일치, 긴 것부터)
const BROKER_ALIASES = [
  ["한국투자", "한국투자증권"], ["한투", "한국투자증권"], ["nh", "NH투자증권"], ["나무", "NH투자증권"], ["kb", "KB증권"],
  ["미래", "미래에셋증권"], ["삼성", "삼성증권"], ["신한", "신한투자증권"], ["대신", "대신증권"], ["크레온", "대신증권"],
  ["하나", "하나증권"], ["키움", "키움증권"], ["유진", "유진투자증권"], ["유안타", "유안타증권"], ["교보", "교보증권"],
  ["sk", "SK증권"], ["아이엠", "아이엠증권"], ["하이", "아이엠증권"], ["db", "DB증권"], ["ibk", "IBK투자증권"],
  ["현대차", "현대차증권"], ["신영", "신영증권"], ["상상인", "상상인증권"], ["한화", "한화투자증권"], ["메리츠", "메리츠증권"],
  ["ls", "LS증권"], ["이베스트", "LS증권"], ["bnk", "BNK투자증권"], ["우리", "우리투자증권"],
  ["토스", "토스증권"], ["카카오", "카카오페이증권"], ["케이프", "케이프투자증권"], ["부국", "부국증권"],
  ["한양", "한양증권"], ["다올", "다올투자증권"], ["im", "아이엠증권"],
].sort((a, b) => b[0].length - a[0].length);

const feeTable = () => ({ ...DEFAULT_FEES, ...((rawRecords && rawRecords.fees) || {}) });
function canonBroker(name) {
  const raw = String(name || "").split(",")[0].trim();
  if (!raw) return null;
  const t = feeTable();
  if (t[raw] != null) return raw;
  const s = raw.replace(/\s+/g, "").toLowerCase();
  for (const [alias, canon] of BROKER_ALIASES) if (s.startsWith(alias)) return canon;
  // 직접 추가한 증권사: '토스' ↔ '토스증권'처럼 '증권/투자증권'을 뺀 이름으로 비교
  const core = (x) => x.replace(/\s+/g, "").toLowerCase().replace(/(금융투자|투자증권|증권)$/, "");
  const sc = core(raw);
  for (const key of Object.keys(t)) {
    const kc = core(key);
    if (kc && sc.length >= 2 && (sc === kc || sc.startsWith(kc) || kc.startsWith(sc))) return key;
  }
  return raw;
}
function feeFor(broker) {
  const c = canonBroker(broker);
  const t = feeTable();
  return c && t[c] != null ? +t[c] : null;
}
/** 청약수수료 칸이 비었거나 자동값이면: 배정 1주 이상 → 증권사 수수료, 0주 → 0 */
function syncFee(initial) {
  const f = $("#formRec");
  const el = f.sub_fee;
  const allocRaw = f.allocated_qty.value.trim();
  const alloc = toNum(allocRaw);
  const fee = allocRaw === "" ? null : alloc > 0 ? feeFor(f.broker.value) : 0;
  if (initial) el.dataset.auto = el.value === "" || (fee != null && toNum(el.value) === fee) ? "1" : "0";
  if (el.dataset.auto === "1") el.value = fee ?? "";
  let hint = "";
  if (el.dataset.auto === "1") {
    if (allocRaw === "") hint = "배정 입력 시 자동";
    else if (alloc > 0 && fee == null) hint = "표에 없는 증권사";
    else hint = alloc > 0 ? `자동 · ${canonBroker(f.broker.value)}` : "미배정 · 0원";
  }
  $("#feeHint").textContent = hint;
}

/* ---------- 기록 폼: 마통 이자 표시 ---------- */
function syncLoan() {
  const f = $("#formRec");
  const amt = toNum(f.loan_amount.value);
  if (amt && f.loan_rate.value.trim() === "" && appSettings().loanRate) f.loan_rate.value = appSettings().loanRate;
  const rate = toNum(f.loan_rate.value);
  const days = loanDays(f.sub_end.value || f.sub_start.value, f.refund_date.value);
  const it = interestOf(amt, rate, days);
  const saved = curId && curRec() && curRec().loan_interest;
  $("#loanHint").textContent = saved != null && saved !== "" ? `기록된 이자 ${won(saved)}원` : amt && rate ? (days ? `이자 약 ${won(it)}원 · ${days}일` : "환불일 입력 시 계산") : "";
}

/* ============================================================ 마통 계산 탭 */
const parseRatio = (s) => { const m = String(s || "").replace(/,/g, "").match(/([\d.]+)\s*:\s*1/); return m ? +m[1] : null; };
/** 청약 진행 중이거나 예정인 종목만 (마감일이 오늘 이후) */
function loanPlanStocks() {
  const t = todayISO();
  return S.schedule.filter((s) => s.sub_end && s.sub_end >= t).sort((a, b) => a.sub_start.localeCompare(b.sub_start) || a.name.localeCompare(b.name));
}
const loanOpen = new Set(); // 펼쳐 둔 종목
function planOf(s) {
  const saved = ls.get("plan:" + s.no, {});
  const rec = myRecordFor(s);
  return {
    qty: saved.qty ?? (rec && rec.applied_qty) ?? "",
    loan: saved.loan ?? (rec && rec.loan_amount) ?? "",
    ratio: saved.ratio ?? (parseRatio(s.prop_competition) || ""),
    ret: saved.ret ?? "",
  };
}
function planCalc(s, p) {
  const rate = +appSettings().loanRate || 0;
  let price = s.offer_price, priceNote = "확정가";
  if (!price && s.price_band) { price = toNum(String(s.price_band).split("~").pop()); priceNote = "희망가 상단"; }
  const depRate = s.deposit_rate || 50;
  const qty = toNum(p.qty) || 0;
  const deposit = qty && price ? Math.round(qty * price * depRate / 100) : 0;
  const loan = p.loan === "" || p.loan == null ? deposit : toNum(p.loan) || 0;
  let refund = s.refund_date, refundNote = "";
  if (!refund && s.sub_end) { refund = addBizDays(s.sub_end, 2); refundNote = " (예상)"; }
  const days = loanDays(s.sub_end, refund);
  const interest = interestOf(loan, rate, days);
  const ratio = toNum(p.ratio);
  const propShares = ratio && qty ? qty / ratio : null;
  const valuePerPct = propShares != null && price ? propShares * price / 100 : null; // 수익률 1%당 이익
  const breakeven = valuePerPct ? interest / valuePerPct : null; // %
  const ret = toNum(p.ret);
  const gain = valuePerPct != null && ret != null && p.ret !== "" ? Math.round(valuePerPct * ret) : null;
  return { rate, price, priceNote, depRate, qty, deposit, loan, refund, refundNote, days, interest, ratio, propShares, breakeven, ret, gain, net: gain != null ? gain - interest : null };
}
function renderLoan() {
  const f = $("#formLoanSet");
  if (document.activeElement?.form !== f) {
    f.loanRate.value = appSettings().loanRate ?? "";
    f.deductLoan.checked = !!appSettings().deductLoan;
  }
  const stocks = loanPlanStocks();
  $("#loanEmpty").classList.toggle("hidden", stocks.length > 0);
  const t = todayISO();
  $("#loanCards").innerHTML = stocks.map((s) => {
    const p = planOf(s), c = planCalc(s, p);
    const live = s.sub_start <= t;
    return `<details class="loan-card" data-plan="${s.no}" ${loanOpen.has(s.no) ? "open" : ""}>
      <summary class="lc-head">
        <span class="lc-badge ${live ? "live" : ""}">${live ? "청약중" : dday(s.sub_start)}</span>
        <span class="lc-title"><b>${myRecordFor(s) ? "★ " : ""}${esc(s.name)}</b>
          <span class="muted small">${esc((s.brokers || "").split(",")[0])} · ${md(s.sub_start)}~${md(s.sub_end)} · 환불 ${md(c.refund)}${c.refundNote} · ${c.days}일</span></span>
        <span class="lc-sum">${loanSummary(c)}</span>
      </summary>
      <div class="lc-body">
      <div class="lc-inputs">
        <label>청약수량(주)<input data-k="qty" inputmode="numeric" value="${esc(p.qty)}" placeholder="예: 2000"></label>
        <label>마통 사용액(원)<input data-k="loan" inputmode="numeric" value="${esc(p.loan)}" placeholder="비우면 증거금 전액"></label>
        <label>비례경쟁률(:1)<input data-k="ratio" inputmode="decimal" value="${esc(p.ratio)}" placeholder="${s.prop_competition ? "" : "마감 후 공개"}"></label>
        <label>예상 상장 수익률(%)<input data-k="ret" inputmode="decimal" value="${esc(p.ret)}" placeholder="예: 80"></label>
      </div>
      <div class="lc-out">${loanOutHTML(s, c)}</div>
      </div>
    </details>`;
  }).join("");
}
/** 접힌 줄에 보이는 한 줄 요약 */
function loanSummary(c) {
  if (!c.rate || !c.qty) return "";
  if (c.propShares != null && c.propShares < 1) return `<span class="down">비례 1주 미만</span>`;
  if (c.net != null) return `<span class="${c.net >= 0 ? "up" : "down"}">${signWon(c.net)}원</span>`;
  if (c.breakeven != null && isFinite(c.breakeven)) return `분기 ${c.breakeven.toFixed(1)}%`;
  return `이자 ${won(c.interest)}원`;
}
function loanOutHTML(s, c) {
  const cell = (l, v, cl = "") => `<div><div class="l">${l}</div><div class="v ${cl}">${v}</div></div>`;
  let verdict = "";
  if (!c.rate) verdict = `<p class="lc-verdict muted">위에 마이너스통장 금리를 입력하면 이자를 계산해요.</p>`;
  else if (!c.qty) verdict = `<p class="lc-verdict muted">청약수량을 넣으면 계산해요.</p>`;
  else if (c.propShares == null) verdict = `<p class="lc-verdict muted">비례경쟁률을 넣으면 손익분기 수익률을 계산해요. (38에는 청약 마감 후 공개돼요)</p>`;
  else if (c.propShares < 1) verdict = `<p class="lc-verdict bad">비례 배정 약 ${c.propShares.toFixed(2)}주 예상 — 1주도 못 받을 가능성이 커서 <b>이자 ${won(c.interest)}원만 나갈 수 있어요.</b></p>`;
  else if (c.net != null) verdict = `<p class="lc-verdict ${c.net >= 0 ? "good" : "bad"}">상장 수익률 ${c.ret}% 가정 시 비례분 이익 ${won(c.gain)}원 − 이자 ${won(c.interest)}원 = <b>${signWon(c.net)}원</b> ${c.net >= 0 ? "이득" : "손해"} (손익분기 ${c.breakeven.toFixed(1)}%)</p>`;
  else verdict = `<p class="lc-verdict">상장 수익률이 <b>${c.breakeven.toFixed(1)}%</b> 넘어야 이자보다 이득이에요.</p>`;
  return `<div class="lc-grid">
    ${cell(`증거금 (${c.depRate}% · ${c.priceNote})`, c.deposit ? won(c.deposit) + "원" : "-")}
    ${cell(`이자 (${c.rate || "-"}% · ${c.days}일)`, c.rate && c.loan ? won(c.interest) + "원" : "-", c.interest ? "down" : "")}
    ${cell("예상 비례 배정", c.propShares != null ? `약 ${c.propShares.toFixed(2)}주` : "-")}
    ${cell("손익분기 수익률", c.breakeven != null && isFinite(c.breakeven) ? `${c.breakeven.toFixed(1)}%` : "-")}
  </div>${verdict}`;
}

/* ---------- 배정 합계 = 균등 + 비례 (둘 다 비어 있으면 합계를 직접 입력 가능) ---------- */
function syncAlloc() {
  const f = $("#formRec");
  const eq = f.alloc_equal.value.trim(), pr = f.alloc_prop.value.trim();
  const split = eq !== "" || pr !== "";
  if (split) f.allocated_qty.value = (toNum(eq) || 0) + (toNum(pr) || 0);
  f.allocated_qty.readOnly = split;
  $("#allocHint").textContent = split ? "자동" : "";
  syncFee(false);
}
const allocText = (r) => {
  if (r.allocated_qty == null || r.allocated_qty === "") return "-";
  const parts = [r.alloc_equal ? `균${r.alloc_equal}` : "", r.alloc_prop ? `비${r.alloc_prop}` : ""].filter(Boolean);
  return won(r.allocated_qty) + (parts.length ? ` <small class="muted">(${parts.join("+")})</small>` : "");
};

/** 새 기록 입력 (수기 입력 / 캘린더에서 불러오기) */
function openNewRecord(prefill = {}) {
  curId = null;
  const f = $("#formRec");
  f.reset();
  for (const el of f.elements) if (el.name) el.value = prefill[el.name] ?? "";
  $("#recTitle").textContent = "새 청약 기록";
  $("#recStatus").classList.add("hidden");
  $("#salesSection").classList.add("hidden");
  $("#btnDelRec").classList.add("hidden");
  $("#autofillMsg").classList.add("hidden");
  if (prefill.name) autofillFromName(); else setBrokerOptions(null);
  syncDeposit(true);
  syncFee(true);
  syncAlloc();
  syncLoan();
  if (!$("#dlgRec").open) $("#dlgRec").showModal();
  (prefill.name ? f.broker : f.name).focus();
}

function openRecord(id) {
  const r = S.records.find((x) => x.id === id);
  if (!r) return;
  curId = id;
  const f = $("#formRec");
  for (const el of f.elements) if (el.name) el.value = r[el.name] ?? "";
  $("#recStatus").classList.remove("hidden");
  $("#salesSection").classList.remove("hidden");
  $("#btnDelRec").classList.remove("hidden");
  $("#autofillMsg").classList.add("hidden");
  setBrokerOptions(S.schedule.find((x) => x.no === r.schedule_no));
  syncDeposit(true);
  syncFee(true);
  syncAlloc();
  syncLoan();
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
    ? `<thead><tr><th>매도일</th><th class="r">수량</th><th class="r">매도가</th><th class="r">공모가 대비</th><th class="r">수수료·세금</th><th class="r">손익</th><th>출금 가능일</th><th>이체</th><th></th></tr></thead><tbody>` +
      r.sales.map((s) => {
        const p = s.qty * (s.price - (r.offer_price || 0)) - (s.fee || 0);
        const d = r.offer_price ? (s.price - r.offer_price) / r.offer_price : null;
        const w = withdrawDate(s), done = isTransferred(s);
        return `<tr><td>${s.sell_date || "-"}</td><td class="r">${won(s.qty)}</td><td class="r">${won(s.price)}</td>
          <td class="r ${cls(d)}">${pct(d)}</td><td class="r">${won(s.fee)}</td><td class="r ${cls(p)}"><b>${signWon(p)}</b></td>
          <td>${w ? `${md(w)} <small class="muted">${won(saleCash(s))}원</small>` : "-"}</td>
          <td><label class="xfer"><input type="checkbox" data-xfer="${esc(s.id)}" ${done ? "checked" : ""}> ${done ? "완료" : "전"}</label></td>
          <td class="r"><button class="x-del" data-sale="${esc(s.id)}" aria-label="삭제">✕</button></td></tr>`;
      }).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">아직 매도 기록이 없어요.</td></tr></tbody>`;
  const hasAlloc = !(r.allocated_qty == null || r.allocated_qty === "");
  $("#recSummary").innerHTML = `
    <div><div class="l">배정${r.alloc_equal || r.alloc_prop ? ` (균등 ${won(r.alloc_equal || 0)} · 비례 ${won(r.alloc_prop || 0)})` : ""} / 남은 수량</div><div class="v">${hasAlloc ? won(r.allocated_qty) + "주" : "-"} / ${hasAlloc ? won(+r.allocated_qty - k.sold) + "주" : "-"}</div></div>
    <div><div class="l">평균 매도가</div><div class="v">${k.avgSell ? won(k.avgSell) + "원" : "-"}</div></div>
    <div><div class="l">실현손익</div><div class="v ${cls(k.profit)}">${k.sold ? signWon(k.profit) + "원" : "매도 후 계산"}</div></div>
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
  const totalProfit = sold.reduce((a, x) => a + x.k.profit, 0);
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
    if (!x.date || !x.k.sold) continue;
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
    if (x.k.sold) o.profit += x.k.profit;
  }
  const bl = Object.entries(br).sort((a, b) => b[1].profit - a[1].profit);
  const bMax = Math.max(0.0001, ...bl.map(([, o]) => Math.abs(o.cost ? o.profit / o.cost : 0)));
  $("#brokerTable").innerHTML = bl.length
    ? `<thead><tr><th>증권사</th><th class="r">참여/배정</th><th class="r">배정주</th><th class="r">손익</th><th class="r">수익률</th><th></th></tr></thead><tbody>` +
      bl.map(([b, o]) => {
        const ret = o.cost ? o.profit / o.cost : null;
        const w = ret == null ? 0 : (Math.abs(ret) / bMax) * 100;
        return `<tr><td><b>${esc(b)}</b></td><td class="r">${o.n} / ${o.allocN}</td><td class="r">${won(o.alloc)}</td>
          <td class="r ${cls(o.profit)}">${o.cost ? signWon(o.profit) : "-"}</td><td class="r ${cls(ret)}"><b>${pct(ret)}</b></td>
          <td><div class="hbar"><i style="left:0;width:${w}%;background:var(--${ret < 0 ? "down" : "up"})"></i></div></td></tr>`;
      }).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">기록이 없어요.</td></tr></tbody>`;

  renderEntry(sold);

  const rank = sold.slice().sort((a, b) => b.k.profit - a.k.profit);
  $("#rankTable").innerHTML = rank.length
    ? `<thead><tr><th>#</th><th>종목</th><th>증권사</th><th class="r">매도</th><th class="r">손익</th><th class="r">수익률</th></tr></thead><tbody>` +
      rank.map((x, i) => `<tr data-rec="${esc(x.r.id)}" style="cursor:pointer"><td class="muted">${i + 1}</td><td><b>${esc(x.r.name)}</b></td><td>${esc(x.r.broker || "-")}</td>
        <td class="r">${won(x.k.sold)}주</td><td class="r ${cls(x.k.profit)}">${signWon(x.k.profit)}</td><td class="r ${cls(x.k.ret)}"><b>${pct(x.k.ret)}</b></td></tr>`).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">매도 기록이 없어요.</td></tr></tbody>`;
}

/* ============================================================ 통계: 진입가능척도 대비 수익률 */
const ALLOC_LABEL = { both: "비례+균등", equal: "균등만", none: "구분 없음" };
/** 배정 구분: 비례 1주 이상 → both, 균등만 → equal, 균등/비례 미입력 → none */
function allocKind(r) {
  if (+r.alloc_prop > 0) return "both";
  if (+r.alloc_equal > 0) return "equal";
  return "none";
}
function renderEntry(sold) {
  const pts = sold
    .filter((x) => x.r.entry_score != null && x.r.entry_score !== "" && isFinite(+x.r.entry_score) && x.k.ret != null)
    .map((x) => ({ x: +x.r.entry_score, y: x.k.ret * 100, r: x.r, kind: allocKind(x.r) }));
  const chart = $("#entryChart"), table = $("#entryTable"), corr = $("#entryCorr");
  if (pts.length < 2) {
    chart.innerHTML = `<p class="empty">매도한 종목 중 진입가능척도가 기록된 게 ${pts.length}건이에요. 2건 이상이면 그래프가 나와요.<br><small>청약 메시지의 '*진입가능척도'가 자동으로 기록되고, 기록 편집에서 직접 넣을 수도 있어요.</small></p>`;
    table.innerHTML = ""; corr.textContent = "";
    return;
  }
  // 상관계수 + 회귀선
  const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  const rCoef = sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx;
  // 진입가능척도는 낮을수록 좋음 → 음(-)의 상관이면 '척도가 낮을수록 수익률이 높다'
  const a = rCoef == null ? 0 : Math.abs(rCoef);
  const strength = a >= 0.7 ? "뚜렷하게" : a >= 0.4 ? "어느 정도" : a >= 0.2 ? "약하게" : "";
  const trendTxt = rCoef == null ? "" : a < 0.2 ? "척도와 수익률 관계가 거의 없음" : `척도가 낮을수록 수익률이 ${strength} ${rCoef < 0 ? "높음" : "낮음"}`;
  corr.textContent = rCoef == null ? "" : `· 상관계수 ${rCoef.toFixed(2)} · ${trendTxt} (${n}건)`;

  // 산점도 (SVG)
  const W = 600, H = 280, L = 48, R = 14, T = 14, B = 34;
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(0, ...pts.map((p) => p.y)), y1 = Math.max(0, ...pts.map((p) => p.y));
  const padX = (x1 - x0 || 1) * 0.08, padY = (y1 - y0 || 1) * 0.1;
  x0 = Math.max(0, x0 - padX); x1 += padX; y0 -= padY; y1 += padY; // 척도는 0 이상이라 축도 0 아래로 안 내려감
  const sx = (v) => L + ((x1 - v) / (x1 - x0)) * (W - L - R); // X축 반전: 오른쪽일수록 척도 낮음(좋음)
  const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = (a, b, k) => Array.from({ length: k + 1 }, (_, i) => a + ((b - a) * i) / k);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="진입가능척도 대비 수익률 산점도">`;
  for (const v of ticks(y0, y1, 4)) svg += `<line class="ax" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${Math.round(v)}%</text>`;
  for (const v of ticks(x1, x0, 4)) svg += `<text x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${Math.round(v)}</text>`;
  svg += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">진입가능척도 (← 높음 · 낮을수록 좋음 →)</text>`;
  if (y0 < 0 && y1 > 0) svg += `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  svg += `<line class="trend" x1="${sx(x0)}" y1="${sy(icpt + slope * x0)}" x2="${sx(x1)}" y2="${sy(icpt + slope * x1)}"/>`;
  for (const p of pts) svg += `<circle class="k-${p.kind}" cx="${sx(p.x)}" cy="${sy(p.y)}" r="5.5" data-rec="${esc(p.r.id)}"><title>${esc(p.r.name)} · ${ALLOC_LABEL[p.kind]} · 척도 ${p.x} · 수익률 ${p.y >= 0 ? "+" : ""}${p.y.toFixed(1)}%</title></circle>`;
  const present = ["both", "equal", "none"].filter((k) => pts.some((p) => p.kind === k));
  const legend = `<div class="entry-legend">${present.map((k) => `<span><i class="k-${k}"></i>${ALLOC_LABEL[k]} ${pts.filter((p) => p.kind === k).length}</span>`).join("")}</div>`;
  chart.innerHTML = legend + svg + `</svg>`;

  // 구간별 (데이터 4분위로 나눔, 적으면 2~3구간)
  const sorted = pts.slice().sort((a, b) => a.x - b.x);
  const k = n >= 12 ? 4 : n >= 6 ? 3 : 2;
  const groups = Array.from({ length: k }, (_, i) => sorted.slice(Math.round((i * n) / k), Math.round(((i + 1) * n) / k))).filter((g) => g.length);
  table.innerHTML = `<thead><tr><th>척도 구간</th><th class="r">건수</th><th class="r">평균 수익률</th><th class="r">승률</th></tr></thead><tbody>` +
    groups.map((g) => {
      const avg = g.reduce((a, p) => a + p.y, 0) / g.length;
      const win = g.filter((p) => p.y > 0).length / g.length;
      return `<tr><td>${Math.round(g[0].x)} ~ ${Math.round(g[g.length - 1].x)}</td><td class="r">${g.length}</td>
        <td class="r ${cls(avg)}"><b>${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%</b></td><td class="r">${Math.round(win * 100)}%</td></tr>`;
    }).join("") + "</tbody>";
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
  for (const p of pendingCash()) {
    if (p.date > t) continue;
    msgs.unshift({ r: p.r, html: `💰 <b>${esc(p.r.name)}</b> 매도대금 ${won(p.amt)}원 출금 가능${p.r.broker ? ` (${esc(p.r.broker)})` : ""} — 이체했으면 체크` });
  }
  const bar = $("#alertBar");
  bar.innerHTML = msgs.map((m) => `<button class="chip-btn" data-rec="${esc(m.r.id)}">${m.html}</button>`).join("");
  bar.classList.toggle("hidden", !msgs.length);
}

/* ============================================================ 증권사 수수료 표 */
function addFeeRow(name, fee, isDefault) {
  const tr = document.createElement("tr");
  const tag = isDefault ? (VERIFIED_FEES.has(name) ? `<small class="fee-tag ok">공식 확인</small>` : `<small class="fee-tag">미확인</small>`) : "";
  tr.innerHTML = `<td><input class="fee-name" value="${esc(name)}" placeholder="증권사 이름" ${isDefault ? "readonly" : ""}>${tag}</td>
    <td class="r"><input class="fee-amt" inputmode="numeric" value="${esc(fee)}" placeholder="원"></td>
    <td>${isDefault ? "" : `<button type="button" class="x-del" aria-label="삭제">✕</button>`}</td>`;
  tr.querySelector(".x-del")?.addEventListener("click", () => tr.remove());
  $("#feeRows").appendChild(tr);
}
function openFees() {
  $("#feeRows").innerHTML = "";
  const t = feeTable();
  for (const [name, fee] of Object.entries(t)) addFeeRow(name, fee, name in DEFAULT_FEES);
  if ($("#dlgSettings").open) $("#dlgSettings").close();
  $("#dlgFees").showModal();
}
async function saveFees(e) {
  e.preventDefault();
  const fees = {};
  for (const tr of $$("#feeRows tr")) {
    const name = tr.querySelector(".fee-name").value.trim();
    const v = tr.querySelector(".fee-amt").value.replace(/,/g, "").trim();
    if (!name || v === "" || isNaN(+v)) continue;
    if (DEFAULT_FEES[name] !== +v) fees[name] = +v; // 기본값과 다른 것만 저장
  }
  try {
    await mutate((d) => { d.fees = fees; }, "ipo: 증권사 청약수수료 표 수정");
    $("#dlgFees").close();
    toast("수수료 표를 저장했어요");
  } catch (err) { toast(err.message); }
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
  // 마통 계산 탭: 입력하면 그 카드만 다시 계산 (입력값은 이 기기에 저장)
  $("#loanCards").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-k]");
    const card = e.target.closest("[data-plan]");
    if (!inp || !card) return;
    const s = S.schedule.find((x) => x.no === +card.dataset.plan);
    const p = {};
    for (const el of card.querySelectorAll("[data-k]")) p[el.dataset.k] = el.value.replace(/,/g, "").trim();
    ls.set("plan:" + s.no, p);
    const c = planCalc(s, p);
    card.querySelector(".lc-out").innerHTML = loanOutHTML(s, c);
    card.querySelector(".lc-sum").innerHTML = loanSummary(c);
  });
  // 펼침 상태 기억 (다시 그려도 유지)
  $("#loanCards").addEventListener("toggle", (e) => {
    const d = e.target.closest("[data-plan]");
    if (d) d.open ? loanOpen.add(+d.dataset.plan) : loanOpen.delete(+d.dataset.plan);
  }, true);
  $("#formLoanSet").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const rate = toNum(f.loanRate.value);
    try {
      await mutate((d) => { d.settings = { ...(d.settings || {}), loanRate: rate, deductLoan: f.deductLoan.checked }; }, "ipo: 마이너스통장 금리 설정");
      toast(rate ? `금리 ${rate}% 저장${f.deductLoan.checked ? " · 수익률에 이자 반영" : ""}` : "금리를 지웠어요");
    } catch (err) { toast(err.message); }
  };
  for (const n of ["loan_amount", "loan_rate", "sub_end", "sub_start", "refund_date"]) $("#formRec")[n].addEventListener("input", syncLoan);

  // 매도 기록의 '이체' 체크
  $("#salesTable").addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-xfer]");
    if (!cb) return;
    cb.disabled = true;
    try {
      await Actions.setTransferred(curId, cb.dataset.xfer, cb.checked);
      renderSales();
      toast(cb.checked ? "이체 완료로 표시했어요" : "이체 전으로 되돌렸어요");
    } catch (err) { cb.checked = !cb.checked; toast(err.message); }
    cb.disabled = false;
  });

  for (const id of ["fSub", "fList", "fRefund", "fCash", "fMine"]) {
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
    const vals = formValues($("#formRec"));
    if (!vals.name) { toast("종목명을 입력하세요"); return $("#formRec").name.focus(); }
    const btn = $("#btnSaveRec");
    btn.disabled = true;
    try {
      if (curId) {
        await Actions.update(curId, vals);
        toast("저장했어요");
      } else {
        const r = await Actions.create(vals);
        curId = r.id;
        toast(r.created ? `${r.name} 청약 기록을 추가했어요` : `${r.name} 기존 기록에 합쳤어요`);
      }
      $("#dlgRec").close();
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  };
  $("#formRec").name.addEventListener("change", () => { autofillFromName(); syncDeposit(false); });
  for (const n of ["applied_qty", "offer_price"]) $("#formRec")[n].addEventListener("input", () => syncDeposit(false));
  for (const n of ["alloc_equal", "alloc_prop"]) $("#formRec")[n].addEventListener("input", syncAlloc);
  $("#formRec").allocated_qty.addEventListener("input", () => syncFee(false));
  for (const ev of ["input", "change"]) $("#formRec").broker.addEventListener(ev, () => syncFee(false));
  $("#formRec").sub_fee.addEventListener("input", (e) => {
    e.target.dataset.auto = e.target.value.trim() === "" ? "1" : "0"; // 직접 입력하면 그 값 유지, 지우면 다시 자동
    syncFee(false);
  });
  $("#btnFees").onclick = openFees;
  $("#btnFeeAdd").onclick = () => addFeeRow("", "");
  $("#formFees").onsubmit = saveFees;
  $("#formRec").deposit.addEventListener("input", (e) => {
    e.target.dataset.auto = e.target.value.trim() === "" ? "1" : "0"; // 직접 입력하면 자동 계산 중지, 지우면 다시 자동
    syncDeposit(false);
  });
  $("#btnManual").onclick = () => { $("#dlgAdd").close(); openNewRecord(); };
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

  // 라이트/다크 모드: 처음엔 기기 설정을 따르고, 버튼을 누르면 선택한 모드로 고정
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const paintThemeBtn = () => {
    $("#btnTheme").textContent = isDark() ? "☀" : "🌙";
    $("#btnTheme").title = isDark() ? "라이트 모드로" : "다크 모드로";
    document.querySelector('meta[name="theme-color"]').content = isDark() ? "#171a20" : "#3b5bdb";
  };
  $("#btnTheme").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    ls.set("theme", next);
    paintThemeBtn();
  };
  paintThemeBtn();

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
