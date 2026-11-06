# 공모주 기록장

공모주 일정을 캘린더로 보고, 청약한 종목의 배정·매도·수익률을 증권사별·기간별로 정리하는 웹앱입니다.

- **앱 주소**: https://cokemania90-sys.github.io/ipo-tracker/
- **공모주 일정**: GitHub Actions가 6시간마다 [38커뮤니케이션](https://www.38.co.kr/html/fund/)에서 가져와 `web/data/schedule.json`에 저장합니다.
- **내 기록**: 비공개 저장소 `claud1`의 `ipo-tracker/records.json`에 저장합니다. 앱의 ⚙ 설정에 토큰을 한 번 넣으면 핸드폰·PC에서 같은 기록을 봅니다.
- **상장일 알림**: 매일 08:30(KST)에 [ntfy](https://ntfy.sh) 앱으로 푸시를 보냅니다.

## 사용법
1. 공모주 알림 메시지(`■ 종목 (증권사)` 블록)를 **+ 청약 기록**에 붙여넣으면 기록됩니다. 캘린더에서 종목을 눌러 **청약할래요**를 눌러도 됩니다.
2. 환불일에 **배정수량**을 입력합니다.
3. 상장 후 매도할 때마다 **매도 추가**(날짜·수량·가격)를 입력합니다. 수수료·세금을 비워 두면 매도금액 × 설정 비율로 자동 계산됩니다.
4. **수익 통계** 탭에서 월·분기·연도별, 증권사별 수익률을 봅니다.

## 설정 (한 번만)
| 위치 | 이름 | 값 |
|---|---|---|
| Settings → Pages | Source | GitHub Actions |
| Settings → Secrets and variables → Actions | `NTFY_TOPIC` | ntfy 앱에서 구독할 주제 이름 |
| 〃 | `RECORDS_TOKEN` | claud1 Contents 읽기 권한이 있는 fine-grained 토큰 |

## 구조
```
web/              GitHub Pages로 배포되는 앱 (index.html, app.js, style.css, data/schedule.json)
scripts/          ipo_core.py(38 스크래퍼), scrape.py(일정 갱신), notify.py(ntfy 알림)
.github/workflows ipo-tracker.yml(일정 갱신+배포), ipo-notify.yml(매일 알림)
```

로컬 실행: `python -m http.server 8039 --directory web` (GitHub 미연결 시 기록은 그 브라우저에만 저장)
