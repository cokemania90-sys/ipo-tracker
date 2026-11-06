# -*- coding: utf-8 -*-
"""38.co.kr 공모주 일정을 web/data/schedule.json 으로 갱신 (GitHub Actions에서 6시간마다 실행)

로컬 실행:  python ipo-tracker/scripts/scrape.py [--force]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ipo_core as core  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "schedule.json")


def main():
    items = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for s in json.load(f).get("items", []):
                items[s["no"]] = s
    result = core.refresh(items, force="--force" in sys.argv)
    if result["list"] == 0:
        sys.exit("38.co.kr 목록을 하나도 가져오지 못했어요 (사이트 접속 실패 또는 구조 변경)")
    data = {
        "last_refresh": core.now_kst().isoformat(timespec="seconds"),
        "items": sorted(items.values(), key=lambda s: (s.get("sub_start") or "", s["no"])),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("schedule.json: %d items (list %d, details %d)" % (len(items), result["list"], result["details"]))


if __name__ == "__main__":
    main()
