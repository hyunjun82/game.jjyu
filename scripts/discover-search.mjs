/**
 * 지금 쿠폰을 내는데 사이트에 없는 게임을 네이버 블로그·카페 검색으로 찾는다(2026-10-05 도입).
 *
 * 왜 필요한가
 *   네이버 라운지 2,300여 곳은 discover-naver.mjs 가 돈다. 그런데 쿠폰을 라운지 글로 안 올리고
 *   카카오 채널·공식 카페·디스코드에만 푸는 게임(애니모·쿠키런 킹덤·AFK 새로운 여정·메이플키우기 …)은
 *   라운지 수집기가 "코드 없음"으로 지나친다. 이런 게임 18개를 사람이 손으로 찾아 넣었다(10-03).
 *   매번 사람이 찾지 않도록, 최근 1개월 "OO 쿠폰 코드" 글 제목에서 게임 이름을 뽑아 자동으로 확인한다.
 *
 * 흐름
 *   1) 검색어 묶음으로 네이버 VIEW(최근 1개월) 제목을 모은다
 *   2) 제목에서 "쿠폰" 앞부분을 게임 이름 후보로 뽑는다(여행·쇼핑·통신 등 게임 아닌 쿠폰은 거른다)
 *   3) 이미 사이트·목록에 있는 이름, 최근 7일 안에 확인한 이름은 건너뛴다
 *   4) collect-search 의 collectOne 으로 그 이름의 최근 30일 블로그 글을 읽어
 *      **지금 쓸 수 있는 코드가 1개 이상**일 때만 scripts/search-games.found.json 에 넣는다
 *      (블로그 제목에 그 이름이 있어야 하고, 블로그 주인 아이디·다른 게임 코드는 이미 걸러진다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectOne } from './collect-search.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FOUND = path.join(ROOT, 'scripts', 'search-games.found.json');
const SEEN = path.join(ROOT, 'scripts', 'search-discover.json');
const MAX_CHECK = Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1] || 25);
const RECHECK_DAYS = 7;

const QUERIES = ['게임 쿠폰 코드', '쿠폰 코드 모음', '쿠폰코드 최신', '쿠폰 코드 총정리', '키우기 쿠폰 코드', '방치형 쿠폰 코드',
  'RPG 쿠폰 코드', 'MMORPG 쿠폰 코드', '디펜스 쿠폰 코드', '기프트 코드', '교환 코드 게임', '선물 코드 게임', '리딤 코드',
  '사전예약 쿠폰 코드', '쿠폰번호 게임', '모바일 게임 쿠폰', '신규 게임 쿠폰 코드', '쿠폰 코드 리세', '쿠폰 코드 신서버',
  '쿠폰 코드 등록 방법', '수집형 RPG 쿠폰 코드', '전략 게임 쿠폰 코드', '퍼즐 게임 쿠폰 코드'];
const NOT_GAME = /이심|esim|e심|VPN|호텔|우버|클룩|아고다|트립|항공|쿠팡|알리|테무|배민|요기요|올리브영|무신사|페이|넷플릭스|디즈니|티빙|택시|렌터카|여행|숙소|에어비앤비|부킹|익스피디아|할인|프로모션|면세|스타벅스|편의점|치킨|피자|마트|통신|요금|보험|카드|증권|대출|쏘카|버거|커피|뷰티|화장품|인강|강의|Saily|로밍|와이파이|그랩|야놀자|여기어때|11번가|이마트|컬리|당근|추천인|초대코드|레퍼럴|가입|오늘의집|쉬인|CU|GS25|토스/i;
const NAME_JUNK = /^(?:게임|신작|추석|추석맞이|한가위|인기|무료|최신|모바일|신섭|이벤트|RE)\b|티어|후기|공략|리뷰|추천|방송|업데이트|미리보기|사전예약 시작|어떤 게임|순위|보내세요|한가위|이벤트|특전|입장/;

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (x) => String(x || '').replace(/[\s:：!·,\-_.()'’]/g, '').toLowerCase();
const ent = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function getText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; game.jjyu coupon collector)' } });
      if (r.ok) return await r.text();
    } catch (e) { /* 재시도 */ }
    await sleep(1000 * (i + 1));
  }
  return '';
}

/** 한글 이름 → 영문 주소(국립국어원 로마자 표기 단순형). 라운지 ID 가 없을 때만 쓴다. */
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
function romanize(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) - 0xac00;
    if (c >= 0 && c < 11172) out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
    else out += /[A-Za-z0-9]/.test(ch) ? ch.toLowerCase() : '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function nameFromTitle(t) {
  if (NOT_GAME.test(t)) return null;
  const i = t.search(/쿠폰|기프트\s*코드|교환\s*코드|선물\s*코드|리딤|CDK/);
  if (i <= 0) return null;
  let n = t.slice(0, i).replace(/^\s*[[【(][^\]】)]{0,20}[\]】)]\s*/, '')
    .replace(/(?:\d{1,2}월|20\d{2}년?|최신|신작|무료)\s*/g, '').replace(/[\s,·|:\-~!]+$/, '').trim();
  // "모바일 방치형RPG 로그W", "MMORPG 게임 어나더던전" — 장르 말머리를 뗀다
  for (let k = 0; k < 4; k++) n = n.replace(/^(?:모바일\s*게임|모바일|방치형\s*RPG|방치형|수집형\s*RPG|MMORPG|RPG|SRPG|디펜스\s*게임|전략\s*게임|게임\s*추천|신규\s*게임|게임)\s+/i, '').trim();
  if (n.replace(/\s/g, '').length < 2 || n.length > 22 || NAME_JUNK.test(n)) return null;
  return n;
}

async function main() {
  const today = todayISO();
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const found = read(FOUND, { _설명: 'discover-search.mjs 가 찾아 넣은 게임 — 블로그 최근 30일 글에서 지금 쓸 코드가 확인된 것만.', games: [] });
  const seen = read(SEEN, { _설명: 'discover-search.mjs 가 확인한 이름과 날짜(7일 안엔 다시 안 봄).', checked: {} });

  // 이미 있는 이름
  const known = new Set();
  const add = (n) => { const k = squash(n); if (k) known.add(k); };
  for (const f of fs.readdirSync(path.join(ROOT, 'data', 'games'))) { try { add(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games', f), 'utf8')).titleKo); } catch (e) { /* 무시 */ } }
  for (const f of ['naver-lounges.json', 'search-games.json', 'search-games.auto.json']) {
    const j = read(path.join(ROOT, 'scripts', f), {});
    for (const g of j.lounges || j.games || []) add(g.titleKo);
  }
  for (const g of found.games) add(g.titleKo);
  // "로그W" 처럼 짧게 부르는 이름도 "로그W: 리메인즈 오브 갓" 과 같은 게임으로 본다(앞부분 일치).
  const isKnown = (n) => { const k = squash(n); for (const x of known) if (x === k || x.startsWith(k) || k.startsWith(x) || (k.length >= 4 && (x.includes(k) || k.includes(x)))) return true; return false; };

  // 라운지 ID(영문 주소용)
  let lounges = [];
  try { lounges = (await (await fetch('https://comm-api.game.naver.com/nng_main/v1/lounge/official')).json()).content.officialLounges || []; } catch (e) { /* 없음 */ }
  const loungeOf = (n) => lounges.find((l) => squash(ent(l.loungeName)) === squash(n));

  // 1) 제목 모으기
  const names = new Map();
  for (const q of QUERIES) {
    for (const start of [1, 11, 21]) {
      const u = `https://search.naver.com/search.naver?where=view&query=${encodeURIComponent(q)}&sm=tab_opt&nso=${encodeURIComponent('p:1m')}${start > 1 ? `&start=${start}` : ''}`;
      const html = await getText(u);
      for (const m of html.matchAll(/<a[^>]+href="(https:\/\/(?:blog|cafe)\.naver\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const t = ent(m[2].replace(/<[^>]+>/g, '')).replace('새 창 열림', '').trim();
        if (t.length < 8 || t.length > 90) continue;
        const n = nameFromTitle(t);
        if (n) names.set(n, (names.get(n) || 0) + 1);
      }
      await sleep(400);
    }
  }
  // 2) 새 이름만, 많이 나온 순
  const cand = [...names.entries()].filter(([n]) => !isKnown(n))
    .filter(([n]) => { const c = seen.checked[squash(n)]; return !c || (Date.parse(today) - Date.parse(c)) / 86400000 >= RECHECK_DAYS; })
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_CHECK);
  console.log(`[discover-search] 제목에서 뽑은 게임 이름 ${names.size}개 · 새 이름 확인 ${cand.length}개`);

  // 3) 확인
  let added = 0;
  for (const [n] of cand) {
    seen.checked[squash(n)] = today;
    const L = loungeOf(n);
    const slug = L ? String(L.loungeId).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() : romanize(n);
    if (!slug || fs.existsSync(path.join(ROOT, 'data', 'games', `${slug}.json`))) continue;
    const r = await collectOne({ slug, titleKo: n, titleEn: L ? L.loungeId : slug }).catch(() => ({ error: 'x' }));
    const today2 = todayISO();
    const live = (r.codes || []).filter((c) => !c.expiry || c.expiry >= today2).length;
    if (r.error || !live) { console.log(`  - ${n}: ${r.error || '지금 쓸 코드 없음'}`); continue; }
    found.games.push({ slug, titleKo: n, titleEn: L ? L.loungeId : slug, ...(L ? { loungeId: L.loungeId } : {}), found: today });
    known.add(squash(n)); added++;
    console.log(`  + ${n} → /${slug}/ · 지금 쓸 코드 ${live}개 (${r.codes.map((c) => c.code).join(', ')})`);
  }
  // 30일 지난 확인 기록은 지운다
  for (const [k, d] of Object.entries(seen.checked)) if ((Date.parse(today) - Date.parse(d)) / 86400000 > 30) delete seen.checked[k];
  fs.writeFileSync(FOUND, JSON.stringify(found, null, 2) + '\n');
  fs.writeFileSync(SEEN, JSON.stringify(seen, null, 1) + '\n');
  console.log(`[discover-search] 새로 넣은 게임 ${added}개`);
  console.log(`SEARCH_FOUND=${added}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
