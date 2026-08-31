# game.jjyu — 게임 쿠폰 코드 모음

`game.jjyu.co.kr` · Next.js 정적 내보내기 + Cloudflare Workers.

## 구조

```
scripts/collect.mjs   Pocket Gamer 에서 게임별 쿠폰을 긁어 data/games/*.json 으로 저장
data/games/*.json     게임 1개 = 파일 1개. 코드·보상·만료일·상태(active/expired)
data/_paths.txt       수집 대상 게임 경로 목록 (443개)
lib/games.js          JSON → 페이지용 데이터 변환
lib/ko-names.js       영문 슬러그 → 한국 서비스명 (없으면 영문 그대로 노출)
app/[slug]/page.js    게임별 쿠폰 페이지 (Article + FAQ + Breadcrumb 스키마)
components/CouponList.js  앞 2개는 공개, 나머지는 흐림 + [보기] 5초 후 공개
```

## 로컬 실행

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # out/ 생성
```

## 수집

```bash
node scripts/collect.mjs           # 전체(443개, 약 2분)
node scripts/collect.mjs --only=20 # 앞 20개만 (테스트용)
```

깃허브 액션이 3시간마다 자동으로 돌면서 변경분만 커밋한다.

## 수집 원칙

- 코드는 지어내지 않는다. 소스에 없으면 버린다.
- 만료된 코드는 지우지 않고 `expired` 로 내린다 — "만료 코드" 자체에도 검색 수요가 있다.
- 소스에서 코드가 사라져도 하루는 유예한다(소스 일시 오류 방어).
