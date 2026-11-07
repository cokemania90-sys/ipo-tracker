# -*- coding: utf-8 -*-
"""상장일 핸드폰 알림 (ntfy) - GitHub Actions에서 매일 08:30 KST 실행

환경변수
  NTFY_TOPIC    (필수) ntfy 앱에서 구독할 주제 이름. 남이 추측 못 하게 길고 랜덤하게.
  RECORDS_REPO  기록이 저장된 (비공개) 저장소. 예: cokemania90-sys/claud1
  RECORDS_PATH  저장소 안의 기록 파일 경로 (기본 ipo-tracker/records.json)
  RECORDS_TOKEN 그 저장소를 읽을 수 있는 토큰 (Contents: Read)
  APP_URL       (선택) 알림을 눌렀을 때 열 주소 (GitHub Pages 주소)
  NTFY_SERVER  (선택) 기본 https://ntfy.sh
  DRY_RUN=1    보내지 않고 내용만 출력
  TEST=1       테스트 알림 1건 전송
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ipo_core as core  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_RECORDS = os.path.join(ROOT, "records.json")  # 로컬 테스트용
SCHEDULE = os.path.join(ROOT, "web", "data", "schedule.json")


def load(path, key):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f).get(key, [])


def load_records():
    repo, token = os.environ.get("RECORDS_REPO"), os.environ.get("RECORDS_TOKEN")
    if not (repo and token):
        print("RECORDS_REPO/RECORDS_TOKEN 없음 -> 로컬 records.json 사용")
        return load(LOCAL_RECORDS, "records")
    path = os.environ.get("RECORDS_PATH") or "ipo-tracker/records.json"
    url = "https://api.github.com/repos/%s/contents/%s" % (repo, urllib.parse.quote(path))
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
        "User-Agent": "ipo-tracker",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("기록 파일이 아직 없어요:", path)
            return []
        raise
    return json.loads(base64.b64decode(j["content"]).decode("utf-8")).get("records", [])


def merged_records():
    """기록에 비어 있는 상장일/환불일 등을 일정 데이터로 보충"""
    sched = load(SCHEDULE, "items")
    by_no = {s["no"]: s for s in sched}
    by_name = {core.norm_name(s["name"]): s for s in sched}
    out = []
    for r in load_records():
        s = by_no.get(r.get("schedule_no")) or by_name.get(core.norm_name(r.get("name")))
        if s:
            for k in ("sub_start", "sub_end", "refund_date", "listing_date", "offer_price"):
                if not r.get(k):
                    r[k] = s.get(k)
        out.append(r)
    return out


def won(n):
    return format(int(n), ",") if n not in (None, "") else "-"


def send(title, message, tags="chart_with_upwards_trend", priority=4):
    topic = os.environ.get("NTFY_TOPIC")
    payload = {"topic": topic, "title": title, "message": message, "tags": [tags], "priority": priority}
    if os.environ.get("APP_URL"):
        payload["click"] = os.environ["APP_URL"]
    if os.environ.get("DRY_RUN") or not topic:
        print("[dry-run]" if topic else "[NTFY_TOPIC 없음]", json.dumps(payload, ensure_ascii=False, indent=1))
        return
    req = urllib.request.Request(
        os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        print("sent:", r.status, title)


def main():
    if os.environ.get("TEST"):
        return send("📈 공모주 알림 테스트", "알림이 정상적으로 도착했어요.")
    today = core.now_kst().date()
    t = today.isoformat()
    tm = (today + core.timedelta(days=1)).isoformat()
    recs = [r for r in merged_records() if r.get("allocated_qty") in (None, "") or int(r["allocated_qty"]) > 0]

    listing = [r for r in recs if r.get("listing_date") == t]
    tomorrow = [r for r in recs if r.get("listing_date") == tm]
    refund = [r for r in recs if r.get("refund_date") == t]
    sub_end = [r for r in recs if r.get("sub_end") == t]

    for r in listing:
        qty = "%s주 배정 · " % won(r["allocated_qty"]) if r.get("allocated_qty") else ""
        send("📈 오늘 %s 상장!" % r["name"],
             "%s%s · 공모가 %s원\n장 시작(09:00) 전에 매도 계획을 확인하세요." % (qty, r.get("broker") or "-", won(r.get("offer_price"))),
             priority=5)
    lines = []
    lines += ["내일 상장: %s (%s)" % (r["name"], r.get("broker") or "-") for r in tomorrow]
    lines += ["오늘 환불일: %s — 배정 수량을 입력하세요" % r["name"] for r in refund]
    lines += ["오늘 청약 마감: %s (%s)" % (r["name"], r.get("broker") or "-") for r in sub_end]
    if lines:
        send("📅 공모주 일정 알림", "\n".join(lines), tags="calendar", priority=3)

    # 매도대금 출금 가능 (매도일 D+2 영업일) — 앱에서 '이체 완료' 체크할 때까지 매일 알림
    cash = []
    for r in recs:
        for s in r.get("sales") or []:
            w = withdraw_date(s.get("sell_date"))
            if not w or w > t or is_transferred(s, w):
                continue
            amt = int(s.get("qty") or 0) * float(s.get("price") or 0) - float(s.get("fee") or 0)
            late = "" if w == t else " (%s부터)" % w[5:].replace("-", "/")
            cash.append("%s %s원 · %s%s" % (r["name"], won(amt), r.get("broker") or "-", late))
    if cash:
        send("💰 매도대금 출금 가능 %d건" % len(cash),
             "\n".join(cash) + "\n증권사 계좌에서 내 계좌로 이체하고, 앱에서 '이체 완료'를 체크하세요.",
             tags="moneybag", priority=4)
    if not (listing or lines or cash):
        print("오늘(%s) 알림 없음" % t)


# ---------------------------------------------------------------- 출금 가능일
HOLIDAYS_PATH = os.path.join(ROOT, "web", "data", "holidays.json")
TRANSFER_TRACK_FROM = "2026-11-07"  # 이 날짜 이전 출금분은 이미 이체한 것으로 간주 (앱과 동일)


def _holidays():
    try:
        with open(HOLIDAYS_PATH, encoding="utf-8") as f:
            return set(json.load(f).get("dates", []))
    except OSError:
        return set()


_HOL = None


def withdraw_date(sell_date, n=2):
    """매도일 + n 영업일 (주말·KRX 휴장일 제외)"""
    global _HOL
    if not sell_date:
        return None
    if _HOL is None:
        _HOL = _holidays()
    from datetime import date as _d
    d = _d.fromisoformat(sell_date)
    k = 0
    while k < n:
        d += core.timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in _HOL:
            k += 1
    return d.isoformat()


def is_transferred(s, w):
    if s.get("transferred") is not None:
        return bool(s["transferred"])
    return w < TRANSFER_TRACK_FROM


if __name__ == "__main__":
    main()
