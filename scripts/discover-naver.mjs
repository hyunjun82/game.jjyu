/**
 * 네이버 게임 "따끈따끈 이벤트 소식" 에서 쿠폰 내는 라운지를 자동으로 찾아 목록에 넣는다.
 *
 * 왜 필요한가
 *   라운지 목록(scripts/naver-lounges.json)을 손으로 늘리면 신작이 쿠폰을 내도 놓친다.
 *   game.naver.com 홈의 "따끈따끈 이벤트 소식" 패널은 모든 공식 라운지가 올린 이벤트를
 *   한 줄로 모아 주고, 그중 쿠폰 이벤트는 제목에 쿠폰·선물코드·리딤이 들어간다.
 *   이 패널을 먹이는 API(/home/game-company-events)는 무인증으로 열려 있다(2026-09-19 실측).
 *
 * 원칙
 *   1) 진행 중(종료일이 오늘 이후이거나 없음)인 쿠폰 이벤트를 올린 라운지만 후보로 본다.
 *   2) 후보는 collectOne 으로 실제 코드가 나오는지 확인한 뒤에만 목록에 넣는다.
 *      쿠폰 글은 있는데 본문에서 코드를 못 읽는 라운지(가입 필요 등)는 넣지 않는다.
 *   3) 이미 목록에 있는 라운지는 건드리지 않는다. 사람이 정한 slug·제목이 우선이다.
 *   4) 원스토어·구글플레이 "할인 쿠폰" 이벤트는 게임 리딤 코드가 아니라 뺀다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectOne, loadLounges, todayISO, fetchEvents } from './collect-naver.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONF_EXTRA = path.join(ROOT, 'scripts', 'naver-lounges.json');
const GAMES_DIR = path.join(ROOT, 'data', 'games');

// 사전예약·사전등록 이벤트도 후보로 본다. 코드가 실제로 읽히는 라운지만 들어가므로
// "SNS 공유 인증" 같은 코드 없는 사전예약 이벤트는 여기서 걸러진다.
const COUPON_RE = /쿠폰|선물\s*코드|코드\s*선물|기프트\s*코드|리딤|사전\s*(?:예약|등록)/;
const STORE_RE = /원스토어|구글\s*플레이|갤럭시\s*스토어|앱스토어|할인\s*쿠폰|충전/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ent = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** 라운지 ID로 URL slug 를 만든다. Doomsday_Warrior → doomsday-warrior, BellatorM → bellator-m */
export function slugOf(loungeId) {
  return String(loungeId)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** 라운지 ID를 영문 제목으로 푼다(한글 제목이 있으니 화면엔 거의 안 쓰인다). */
const titleEnOf = (loungeId) => slugOf(loungeId).split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** 라운지 이름에서 부제·장르 꼬리를 뗀다. "영혼 키우기 : 두 얼굴의 소녀들" 은 그대로 둔다. */
const cleanName = (s) => ent(s).replace(/\s*[-–]\s*(달빛을 품은 )?MMORPG$/i, '').replace(/\s+X\s+대환장 MMORPG$/i, '').trim();

async function main() {
  const today = todayISO();
  const events = await fetchEvents();
  if (!events.length) { console.log('[discover] 이벤트 피드 응답 없음 — 건너뜀'); console.log('DISCOVER_ADDED=0'); return; }

  const known = new Set(loadLounges().map((g) => String(g.loungeId).toLowerCase()));
  const cand = new Map();
  for (const e of events) {
    const title = ent(e.feedTitle);
    if (!COUPON_RE.test(title)) continue;
    if (STORE_RE.test(title) && !/쿠폰\s*코드|선물\s*코드/.test(title)) continue;
    const end = String(e.eventEndDate || '').slice(0, 10);
    if (end && end < today) continue;                      // 끝난 이벤트는 근거로 안 쓴다
    const id = String(e.loungeId || e.originalLoungeId || '');
    if (!id || known.has(id.toLowerCase())) continue;
    if (!cand.has(id)) cand.set(id, { loungeId: id, name: cleanName(e.loungeName), titles: [] });
    cand.get(id).titles.push(title);
  }

  console.log(`[discover] 이벤트 ${events.length}건 · 쿠폰 이벤트 진행 중인 신규 라운지 후보 ${cand.size}개`);
  const added = [];
  for (const c of cand.values()) {
    const slug = slugOf(c.loungeId);
    const g = { slug, loungeId: c.loungeId, titleKo: c.name, titleEn: titleEnOf(c.loungeId), auto: today };
    const r = await collectOne(g).catch((e) => ({ error: String(e.message || e) }));
    await sleep(400);
    if (r.error) { console.log(`  - ${c.name} (${c.loungeId}): ${r.error}`); continue; }
    // collect-naver.mjs 의 판정 규칙과 같게: 만료일이 있으면 그 날짜, 없으면 게시 후 14일.
    const live = r.codes.filter((x) => x.expiry
      ? x.expiry >= today
      : x.expiryFrom === 'event-open'
        || !(x.postedAt && (Date.parse(today) - Date.parse(x.postedAt)) / 86400000 > 14)).length;
    if (!live) { console.log(`  - ${c.name}: 코드 ${r.codes.length}개 전부 만료 — 보류`); continue; }
    added.push(g);
    console.log(`  + ${c.name} (${c.loungeId}) → /${slug}/ · 코드 ${r.codes.length}개(사용가능 ${live}) · 근거: ${c.titles[0].slice(0, 50)}`);
  }

  if (added.length) {
    const conf = JSON.parse(fs.readFileSync(CONF_EXTRA, 'utf8'));
    conf.lounges.push(...added);
    fs.writeFileSync(CONF_EXTRA, JSON.stringify(conf, null, 2) + '\n');
    console.log(`[discover] 목록에 ${added.length}개 추가 → 이어서 collect-naver.mjs 가 페이지를 만든다`);
  } else {
    console.log('[discover] 추가할 라운지 없음');
  }
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  console.log(`DISCOVER_ADDED=${added.length}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
