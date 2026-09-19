/**
 * 쿠폰 내는 라운지를 자동으로 찾아 목록에 넣는다.
 *
 * 1단계 — "따끈따끈 이벤트 소식": 쿠폰·사전예약 이벤트를 진행 중인 라운지(당일 반영).
 * 2단계 — 전수 순회: 공식 라운지 전체(2,300개, 2026-09-19 실측)를 돌며 쿠폰 코드가 읽히는
 *          라운지를 찾는다. 신규 라운지 20개·신설 라운지·인기 순위 TOP100 은 매번 먼저 보고,
 *          나머지는 한 번에 SWEEP_PER_RUN 개씩 돌아가며 본다(30분마다 도는 워크플로 기준
 *          하루 안에 한 바퀴). 결과는 scripts/naver-sweep.json 에 남겨 같은 라운지를
 *          RECHECK_DAYS 안에는 다시 안 본다.
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

const B1 = 'https://comm-api.game.naver.com/nng_main/v1';
const ROOT = path.resolve(import.meta.dirname, '..');
const CONF_EXTRA = path.join(ROOT, 'scripts', 'naver-lounges.json');
const SWEEP_FILE = path.join(ROOT, 'scripts', 'naver-sweep.json');
/** 회원 전용이라 못 읽는 인기 라운지 — 블로그 검색 수집(collect-search.mjs)이 이 목록을 같이 읽는다. */
const SEARCH_AUTO_FILE = path.join(ROOT, 'scripts', 'search-games.auto.json');
const SEARCH_FILE = path.join(ROOT, 'scripts', 'search-games.json');
const GAMES_DIR = path.join(ROOT, 'data', 'games');

/** 한 번에 순회할 라운지 수. --sweep=N 으로 바꾼다. 0이면 순회를 건너뛴다. */
const SWEEP_PER_RUN = Number((process.argv.find((a) => a.startsWith('--sweep=')) || '').split('=')[1] ?? 60);
/** 순위·신규 소스와 예전에 코드를 올린 적 있는 라운지는 2일, 나머지는 14일 안에 다시 안 본다. */
const RECHECK_HOT_DAYS = 2;
const RECHECK_DAYS = 14;

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

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data && data.code === 200) return data;
    } catch (e) { /* 재시도 */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

/** 사용 가능한 코드 수 — collect-naver.mjs 의 판정 규칙과 같게. */
function liveCount(codes, today) {
  return codes.filter((x) => x.expiry
    ? x.expiry >= today
    : x.expiryFrom === 'event-open'
      || !(x.postedAt && (Date.parse(today) - Date.parse(x.postedAt)) / 86400000 > 14)).length;
}

/**
 * 영문 소스로 이미 들어와 있는 같은 게임이면 그 slug 를 쓴다 — 페이지가 둘로 갈리지 않게.
 *   eternalevolution ↔ eternal-evolution, Dungeon_Hunter6_Awakening ↔ dungeon-hunter-6-awakening
 * 하이픈·대소문자만 다른 경우만 같은 게임으로 본다. 이름이 비슷한 다른 게임을 합치면 더 나쁘다.
 */
function existingSlugFor(loungeId) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(loungeId);
  if (!want || !fs.existsSync(GAMES_DIR)) return null;
  for (const f of fs.readdirSync(GAMES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    if (norm(slug) === want) return slug;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
      if (j.titleEn && norm(j.titleEn) === want) return slug;
    } catch (e) { /* 무시 */ }
  }
  return null;
}

/** 라운지 하나를 실제로 읽어 본다. 사용 가능한 코드가 있으면 목록에 넣을 항목을 돌려준다. */
async function probe(loungeId, name, today) {
  const slug = existingSlugFor(loungeId) || slugOf(loungeId);
  const g = { slug, loungeId, titleKo: cleanName(name), titleEn: titleEnOf(loungeId), auto: today };
  const r = await collectOne(g).catch((e) => ({ error: String(e.message || e) }));
  await sleep(300);
  if (r.error) return { g, error: r.error };
  const live = liveCount(r.codes, today);
  return { g, live, total: r.codes.length };
}

function loadSweep() {
  try { return JSON.parse(fs.readFileSync(SWEEP_FILE, 'utf8')); } catch (e) { return { _설명: '라운지별 마지막 순회 결과. discover-naver.mjs 가 쓴다.', checked: {} }; }
}

/**
 * 2단계 — 전수 순회 후보를 우선순위대로 모은다.
 *   hot : 신규 공식 라운지 20 · 신설 라운지 · 일간/주간/월간 인기 TOP100 · 실시간 순위
 *   all : 공식 라운지 전체 (마지막으로 본 지 오래된 순)
 */
async function sweepCandidates(known, sweep, today) {
  // hotAll: 신규·순위 라운지 전부(목록에 있는 것 포함) — 검색 보완 대상 산출에 쓴다.
  // hot   : 그중 목록에 없는 것 — 순회 후보.
  const hotAll = new Map();
  const hot = new Map();
  const add = (x) => {
    const id = String(x?.loungeId || x?.originalLoungeId || '');
    if (!id) return;
    const name = ent(x.loungeName || x.loungeEnglishName || id);
    if (!hotAll.has(id)) hotAll.set(id, name);
    if (!known.has(id.toLowerCase()) && !hot.has(id)) hot.set(id, name);
  };

  const newest = await get(`${B1}/lounge/official?limit=20`);
  for (const x of newest?.content?.officialLounges || []) add(x);
  const fresh = await get(`${B1}/home/newLounges`);
  for (const x of fresh?.content?.loungeList || []) add(x);
  for (const term of ['daily', 'weekly', 'monthly']) {
    const r = await get(`${B1}/home/popular-game/lounge/ranking?term=${term}`);
    for (const x of r?.content?.popularGameLounge || []) add(x.lounge || x);
  }
  const rt = await get(`${B1}/home/real-time/lounge/ranking`);
  for (const x of rt?.content?.realTimeLounge || []) add(x.lounge || x);

  const all = new Map();
  const full = await get(`${B1}/lounge/official`);
  for (const x of full?.content?.officialLounges || []) {
    const id = String(x?.loungeId || x?.originalLoungeId || '');
    if (id && !known.has(id.toLowerCase()) && !all.has(id)) all.set(id, ent(x.loungeName || id));
  }

  const ageDays = (id) => { const c = sweep.checked[id]; return c ? (Date.parse(today) - Date.parse(c.at)) / 86400000 : Infinity; };
  // 예전에 코드를 올린 적이 있는 라운지(지금은 전부 만료)는 다시 올릴 가능성이 높다 — 순위 라운지처럼 자주 본다.
  const wasCouponLounge = (id) => (sweep.checked[id]?.total || 0) > 0;
  const due = (id) => ageDays(id) >= ((hot.has(id) || wasCouponLounge(id)) ? RECHECK_HOT_DAYS : RECHECK_DAYS);
  const hotList = [...hot].filter(([id]) => due(id));
  const allList = [...all].filter(([id]) => !hot.has(id) && due(id))
    .sort((a, b) => ageDays(b[0]) - ageDays(a[0]));   // 오래 안 본 것부터
  return { hotList, allList, hotTotal: hot.size, allTotal: all.size, hotAll };
}

/**
 * 회원 전용 라운지 중 인기 순위·신규에 든 게임을 블로그 검색 보완 대상으로 적는다.
 * 같은 코드가 블로그에 공개되는 게임이 많다(니케·명조 실측). 손으로 적은 search-games.json 과
 * 겹치는 게임은 뺀다. 라운지 목록에 이미 있는 게임은 그 slug 를 써서 페이지가 둘로 안 갈리게 한다.
 */
function writeSearchAuto(hotAll, sweep, known, lounges) {
  let manual = [];
  try { manual = JSON.parse(fs.readFileSync(SEARCH_FILE, 'utf8')).games || []; } catch (e) { /* 없음 */ }
  const manualSlugs = new Set(manual.map((g) => g.slug));
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const manualNames = new Set(manual.map((g) => norm(g.titleKo)));
  const bySlugLounge = new Map(lounges.map((g) => [String(g.loungeId).toLowerCase(), g]));
  const out = [];
  for (const [id, name] of hotAll) {
    const s = sweep.checked[id];
    const inList = bySlugLounge.get(id.toLowerCase());
    // 라운지 목록에 있는데 코드가 0개인 게임도 회원 전용이면 검색으로 보완한다.
    const locked = /잠김/.test(s?.error || '') || (inList && /잠김/.test(sweep.checked[inList.loungeId]?.error || ''));
    if (!locked) continue;
    const slug = inList ? inList.slug : (existingSlugFor(id) || slugOf(id));
    const titleKo = inList ? inList.titleKo : cleanName(name);
    if (manualSlugs.has(slug) || manualNames.has(norm(titleKo))) continue;
    if (titleKo.replace(/\s/g, '').length < 3) continue;     // 너무 짧은 이름은 검색이 엉뚱한 글을 문다
    out.push({ slug, loungeId: id, titleKo, titleEn: inList?.titleEn || titleEnOf(id) });
  }
  fs.writeFileSync(SEARCH_AUTO_FILE, JSON.stringify({
    _설명: '회원 전용 라운지 중 인기 순위·신규에 든 게임. discover-naver.mjs 가 매번 다시 쓴다. 손으로 고치려면 search-games.json 에 넣을 것.',
    generatedAt: new Date().toISOString(),
    games: out,
  }, null, 2) + '\n');
  return out.length;
}

async function main() {
  const today = todayISO();
  const events = await fetchEvents();
  if (!events.length) console.log('[discover] 이벤트 피드 응답 없음 — 1단계 건너뜀');

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

  console.log(`[discover] 1단계 — 이벤트 ${events.length}건 · 쿠폰·사전예약 이벤트 진행 중인 신규 라운지 후보 ${cand.size}개`);
  const added = [];
  const sweep = loadSweep();
  const mark = (id, r) => { sweep.checked[id] = { at: today, ...(r.error ? { error: r.error } : { live: r.live, total: r.total }) }; };

  for (const c of cand.values()) {
    const r = await probe(c.loungeId, c.name, today);
    mark(c.loungeId, r);
    if (r.error) { console.log(`  - ${c.name} (${c.loungeId}): ${r.error}`); continue; }
    if (!r.live) { console.log(`  - ${c.name}: 코드 ${r.total}개 전부 만료 — 보류`); continue; }
    added.push(r.g); known.add(c.loungeId.toLowerCase());
    console.log(`  + ${c.name} (${c.loungeId}) → /${r.g.slug}/ · 코드 ${r.total}개(사용가능 ${r.live}) · 근거: ${c.titles[0].slice(0, 50)}`);
  }

  // 2단계 — 전수 순회
  if (SWEEP_PER_RUN > 0) {
    const { hotList, allList, hotTotal, allTotal, hotAll } = await sweepCandidates(known, sweep, today);
    // 신규·순위 라운지가 앞, 전체 목록이 뒤. 한 번에 SWEEP_PER_RUN 개까지만 — 넘치면 다음 실행이 이어서 본다.
    const queue = [...hotList, ...allList].slice(0, SWEEP_PER_RUN);
    console.log(`[discover] 2단계 — 신규·순위 라운지 ${hotTotal}개(볼 것 ${hotList.length}) · 전체 ${allTotal}개(안 본 지 ${RECHECK_DAYS}일 넘은 것 ${allList.length}) · 이번에 ${queue.length}개`);
    let n = 0;
    for (const [id, name] of queue) {
      const r = await probe(id, name, today);
      mark(id, r);
      n++;
      if (r.error || !r.live) continue;
      added.push(r.g); known.add(id.toLowerCase());
      console.log(`  + ${cleanName(name)} (${id}) → /${r.g.slug}/ · 코드 ${r.total}개(사용가능 ${r.live}) · 순회에서 발견`);
    }
    console.log(`[discover] 2단계 — ${n}개 확인`);
    // 회원 전용 라운지의 목록 내 게임은 sweep 에 기록이 없을 수 있다 — 여기서 한 번 확인해 둔다.
    for (const g of loadLounges()) {
      const id = String(g.loungeId);
      if (!hotAll.has(id) || sweep.checked[id]) continue;
      const r = await probe(id, g.titleKo, today);
      sweep.checked[id] = { at: today, ...(r.error ? { error: r.error } : { live: r.live, total: r.total }) };
    }
    const nAuto = writeSearchAuto(hotAll, sweep, known, loadLounges());
    console.log(`[discover] 회원 전용 인기 라운지 → 블로그 검색 보완 대상 ${nAuto}개 (search-games.auto.json)`);
  }

  if (added.length) {
    const conf = JSON.parse(fs.readFileSync(CONF_EXTRA, 'utf8'));
    conf.lounges.push(...added);
    fs.writeFileSync(CONF_EXTRA, JSON.stringify(conf, null, 2) + '\n');
    console.log(`[discover] 목록에 ${added.length}개 추가 → 이어서 collect-naver.mjs 가 페이지를 만든다`);
  } else {
    console.log('[discover] 추가할 라운지 없음');
  }
  fs.writeFileSync(SWEEP_FILE, JSON.stringify(sweep, null, 1) + '\n');
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  console.log(`DISCOVER_ADDED=${added.length}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
