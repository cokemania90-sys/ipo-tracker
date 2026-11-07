# -*- coding: utf-8 -*-
"""38.co.kr 공모주 일정 스크래핑 공통 모듈 (표준 라이브러리만 사용)"""
import html
import re
import ssl
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

SRC = "https://www.38.co.kr"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ipo-tracker"}
KST = timezone(timedelta(hours=9))


def now_kst():
    return datetime.now(KST)


def to_date(s):
    m = re.search(r"(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})", s or "")
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def to_range(s):
    """'2026.11.05~11.06' / '2026.12.30~2027.01.02' -> ('2026-11-05','2026-11-06')"""
    m = re.search(r"(\d{4})\.(\d{1,2})\.(\d{1,2})\s*~\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})", s or "")
    if not m:
        return None, None
    y, mo, d, y2, mo2, d2 = m.groups()
    y, mo, d, mo2, d2 = int(y), int(mo), int(d), int(mo2), int(d2)
    y2 = int(y2) if y2 else (y + 1 if mo2 < mo else y)
    return "%d-%02d-%02d" % (y, mo, d), "%d-%02d-%02d" % (y2, mo2, d2)


def to_num(s):
    if s is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(s))
    if s in ("", "-", ".", "-."):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def norm_name(s):
    s = re.sub(r"\(.*?\)", "", s or "")
    return re.sub(r"\s+", "", s).lower()


def strip_tags(h):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = html.unescape(h).replace("\xa0", " ")
    return re.sub(r"\s+", " ", h).strip()


def _legacy_ssl():
    # 38.co.kr은 오래된 TLS 설정이라 최신 OpenSSL 3(우분투 러너)에서 핸드셰이크가 거부됨 -> 보안 수준을 낮춘 컨텍스트 사용
    ctx = ssl.create_default_context()
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
    except ssl.SSLError:
        pass
    ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (ValueError, AttributeError):
        pass
    return ctx


_CTX = _legacy_ssl()


def fetch(url):
    last = None
    for u in (url, url.replace("https://", "http://", 1)):
        try:
            req = urllib.request.Request(u, headers=UA)
            with urllib.request.urlopen(req, timeout=25, context=_CTX) as r:
                return r.read().decode("cp949", "replace")
        except Exception as e:  # https 실패 시 http로 한 번 더
            last = e
    raise last


def parse_list(h):
    """공모주 청약일정 목록 표 -> [{no,name,sub_start,sub_end,offer_price,price_band,competition,brokers}]"""
    out = []
    for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", h):
        m = re.search(r"o=v&(?:amp;)?no=(\d+)", tr)
        if not m:
            continue
        cells = [strip_tags(c) for c in re.findall(r"(?is)<td[^>]*>(.*?)</td>", tr)]
        if len(cells) < 6:
            continue
        s, e = to_range(cells[1])
        if not s:
            continue
        out.append(dict(
            no=int(m.group(1)), name=cells[0], sub_start=s, sub_end=e,
            offer_price=to_num(cells[2]), price_band=cells[3].strip() or None,
            competition=cells[4].strip() or None, brokers=cells[5].strip() or None,
        ))
    return out


def parse_detail(h):
    t = strip_tags(h)
    D = r"(\d{4}\.\d{1,2}\.\d{1,2})"

    def rx(p):
        m = re.search(p, t)
        return m.group(1).strip() if m else None

    sub = re.search(r"공모청약일 " + D + r" ~ " + D, t)
    fc = re.search(r"수요예측일 " + D + r" ~ " + D, t)
    return dict(
        sub_start=to_date(sub.group(1)) if sub else None,
        sub_end=to_date(sub.group(2)) if sub else None,
        forecast_start=to_date(fc.group(1)) if fc else None,
        forecast_end=to_date(fc.group(2)) if fc else None,
        refund_date=to_date(rx(r"환불일 " + D)),
        listing_date=to_date(rx(r"(?<!신규)상장일 " + D)),
        offer_price=to_num(rx(r"확정공모가 ([\d,]+) 원")),
        price_band=rx(r"희망공모가액 ([\d,]+ ~ [\d,]+) 원"),
        competition=rx(r"청약경쟁률 ([\d.,]+:1)"),
        inst_competition=rx(r"기관경쟁률 ([\d.,]+:1)"),
        lockup_pct=to_num(rx(r"의무보유확약 ([\d.]+) ?%")),
        offer_amount=to_num(rx(r"공모금액 ([\d,]+) \(백만원\)")),
        brokers=rx(r"주간사 (.+?) 주식수"),
        market=rx(r"시장구분 (\S+)"),
        code=rx(r"종목코드 (\d{6})"),
        sub_limit=rx(r"청약 최고한도 : ([\d,~ ]+) 주"),
        deposit_rate=to_num(rx(r"일반청약자 [\d,]+ 주 \([\d.]+%\) 청약증거금율 : (\d+(?:\.\d+)?) ?%")),
    )


def refresh(items, pages=3, force=False):
    """items: {no: dict} 를 최신 목록/상세로 갱신하여 반환"""
    ts = now_kst().isoformat(timespec="seconds")
    today = now_kst().date()
    n_list = 0
    for p in range(1, pages + 1):
        try:
            rows = parse_list(fetch("%s/html/fund/index.htm?o=k&page=%d" % (SRC, p)))
        except Exception as e:
            print("list page %d failed: %s" % (p, e), file=sys.stderr)
            continue
        n_list += len(rows)
        for r in rows:
            cur = items.setdefault(r["no"], {})
            for k, v in r.items():
                if v is not None or k not in cur:
                    cur[k] = v
            cur["updated_at"] = ts

    cutoff = (today - timedelta(days=60)).isoformat()
    stale = (now_kst() - timedelta(hours=5)).isoformat(timespec="seconds")
    need = [
        no for no, s in items.items()
        if (s.get("sub_start") or "") >= cutoff and (
            force or not s.get("detail_at")
            or ((not s.get("listing_date") or s["listing_date"] >= today.isoformat()) and s["detail_at"] < stale)
        )
    ]

    def work(no):
        try:
            return no, parse_detail(fetch("%s/html/fund/?o=v&no=%d" % (SRC, no)))
        except Exception as e:
            print("detail %d failed: %s" % (no, e), file=sys.stderr)
            return no, None

    n_detail = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for no, d in ex.map(work, need):
            if not d:
                continue
            n_detail += 1
            cur = items[no]
            for k, v in d.items():
                if v is not None:
                    cur[k] = v
            cur["detail_at"] = ts
    return {"list": n_list, "details": n_detail}
