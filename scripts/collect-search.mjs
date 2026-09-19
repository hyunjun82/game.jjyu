/**
 * 네이버 검색 기반 쿠폰 수집기 — 라운지가 막혔거나 없는 게임용.
 *
 * 왜 필요한가
 *   네이버 게임 라운지의 쿠폰 게시판 중 일부는 memberAccessBoard:true 라서
 *   비로그인으로 글 목록을 받으면 40310("라운지를 가입해주세요")이 온다.
 *   그런데 같은 코드가 네이버 블로그에 그대로 공개돼 있고 검색에 노출된다(2026-09-14 실측).
 *   그래서 막힌 게임만 검색으로 보완한다.
 *
 * 원칙
 *   1) 지난 쿠폰은 담지 않는다. 30일 넘은 글은 통째로 건너뛴다 — 죽은 코드만 잔뜩 들어온다.
 *   2) 블로그는 2차 출처다. 코드마다 출처 URL 을 남겨 추적 가능하게 한다.
 *   3) 다른 게임에 이미 등록된 코드는 버린다. 한 글에서 여러 게임을 다루면 섞여 들어온다.
 *   4) 본문에 게임 이름이 없으면 버린다.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GAMES_DIR = path.join(ROOT, 'data', 'games');
const CONF = process.env.SEARCH_CONF || path.join(ROOT, 'scripts', 'search-games.json');
/** discover-naver.mjs 가 자동으로 적는 회원 전용 인기 라운지 목록. 손으로 적은 목록이 우선한다. */
const CONF_AUTO = path.join(ROOT, 'scripts', 'search-games.auto.json');

/** 이보다 오래된 글은 안 본다. 쿠폰 수명이 1~2주라 한 달 지난 글은 전부 만료다. */
const MAX_POST_AGE_DAYS = 30;
/** 게임 하나당 훑을 블로그 글 수. 검색 상위만 봐도 최신 코드는 다 걸린다. */
const MAX_POSTS = 8;
/** 만료 표기가 없는 코드의 수명. collect-naver.mjs 와 같은 값. */
const STALE_DAYS = 14;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const todayISO = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; game.jjyu coupon collector)' },
      });
      if (res.ok) return await res.text();
    } catch (e) { /* 산발적 실패는 재시도로 흡수 */ }
    await sleep(1000 * (i + 1));
  }
  return '';
}

const ent = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function bodyText(raw) {
  const t = String(raw || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return ent(t).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const LABEL_RE = /쿠폰|리딤|기프트|선물\s*코드|코드|번호|CDK/i;
const STOP = new Set([
  'GOOGLE','PLAY','STORE','APPLE','ONESTORE','GALAXY','SAMSUNG','ANDROID','IOS','APK',
  'HTTP','HTTPS','WWW','COM','NAVER','LOUNGE','EVENT','UPDATE','NOTICE','GAME','GM','CM',
  'VIP','SNS','FAQ','QNA','PC','TIP','NEW','HOT','BEST','ALL','AND','THE','FOR','YOU',
  'CLICK','LINK','HERE','DOWNLOAD','WINDOWS','MACOS','DISCORD','TIKTOK','YOUTUBE','FACEBOOK',
  'TWITTER','INSTAGRAM','KAKAO','CAFE','OFFICIAL','GIFT','CODE','COUPON','REWARD','ITEM','ITEMS',
  'LEVEL','SERVER','TEAM','MVP','SVP','CHECK','ENTER','INPUT','OPEN','FREE','MOBILE','ONLINE',
  'VERSION','PLAYSTORE','APPSTORE','ONLY','WITH','FROM','THIS','THAT','YOUR','MORE','TIME','DATE',
  'NAME','POINT','POINTS','BONUS','SHARE','LIKE','FOLLOW','MMORPG','RPG','BLOG','POST','IMAGE',
  'VIDEO','SEARCH','TITLE','TOTAL','GAMES','SECRET','PRODUCTIVITY','DIGWOW',
]);

function isSaneCode(c) {
  if (!c) return false;
  if (c.length < 5 || c.length > 20) return false;
  // 블로그 HTML 에는 이미지·요소 id 로 쓰이는 16진수 토큰이 널려 있다(l6ff2740, aa5916c3 …).
  // 쿠폰은 사람이 읽는 문자열이라 이런 모양이 아니다.
  if (/^[0-9a-f]{8}$/i.test(c)) return false;
  if (/^[a-z][0-9a-f]{7}$/i.test(c)) return false;
  if (!/^[A-Za-z0-9]+$/.test(c)) return false;
  if (STOP.has(c.toUpperCase())) return false;
  if (/^\d+$/.test(c)) return false;
  if (/^(19|20)\d{2}$/.test(c)) return false;
  return /\d/.test(c) || /^[A-Z]+$/.test(c);
}

const TAIL = String.raw`(?:\([^)]{0,6}\))?\s*(?:\d{1,2}\s*[:시]\s*\d{2}\s*분?)?\s*(?:\((?:UTC|KST)\))?\s*(?:까지|마감)`;
const RE_KO = new RegExp(String.raw`(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*` + TAIL, 'g');
const RE_DOT = new RegExp(String.raw`(\d{2,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*` + TAIL, 'g');

const iso = (y, mo, dy) =>
  (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)
    ? new Date(Date.UTC(y, mo - 1, dy)).toISOString().slice(0, 10)
    : null;

function parseExpiry(text, postISO) {
  const base = postISO ? new Date(postISO + 'T00:00:00Z') : new Date();
  let last = null;
  for (const m of text.matchAll(RE_DOT)) {
    let y = Number(m[1]); if (y < 100) y += 2000;
    last = iso(y, Number(m[2]), Number(m[3])) || last;
  }
  for (const m of text.matchAll(RE_KO)) {
    const mon = Number(m[2]), day = Number(m[3]);
    let year = m[1] ? Number(m[1]) : base.getUTCFullYear();
    if (!m[1] && mon < base.getUTCMonth() + 1 - 6) year += 1;
    last = iso(year, mon, day) || last;
  }
  if (last) return last;
  const lab = text.match(/(?:유효\s*기간|만료\s*(?:시간|일자|일))[^0-9]{0,12}(\d{1,2})\s*[월/.]\s*(\d{1,2})/);
  if (!lab) return null;
  const mon = Number(lab[1]), day = Number(lab[2]);
  let year = base.getUTCFullYear();
  if (mon < base.getUTCMonth() + 1 - 6) year += 1;
  return iso(year, mon, day);
}

const BULLET = /^(?:[^A-Za-z0-9가-힣]+|\d{1,2}[.)]\s)\s*/u;

function tokenOf(line) {
  const m = line.match(/^([A-Za-z0-9]{5,20})\s*(.*)$/);
  if (!m) return '';
  const rest = m[2].trim();
  if (rest && !/^[(（[]/.test(rest)) return '';
  return m[1];
}

/** collect-naver.mjs 와 같은 규칙. 라벨 근처의 연속 코드 덩어리만 인정한다. */
function parseCodes(text, postISO) {
  const lines = text.split('\n').map((s) => s.trim().replace(BULLET, '').trim()).filter(Boolean);
  const labelAt = lines.map((l) => LABEL_RE.test(l));
  const codeAt = lines.map((l) => { const t = tokenOf(l); return !!t && isSaneCode(t); });
  const postExpiry = parseExpiry(text, postISO);
  const found = new Map();

  const push = (code, expiry) => {
    if (!isSaneCode(code)) return;
    const key = code.toUpperCase();
    if (!found.has(key)) found.set(key, { code, expiry: expiry || postExpiry, postedAt: postISO || null });
  };

  for (const line of lines) {
    const inline = line.match(/(?:코드|번호|CDK)\s*[:：]?\s*([A-Za-z0-9]{5,20})\s*$/i);
    if (inline) push(inline[1], null);
  }
  for (let i = 0; i < lines.length; ) {
    if (!codeAt[i]) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && codeAt[j + 1]) j++;
    const near = labelAt.slice(Math.max(0, i - 3), i).some(Boolean)
      || labelAt.slice(j + 1, j + 4).some(Boolean);
    if (near && j - i + 1 <= 40) {
      for (let k = i; k <= j; k++) push(tokenOf(lines[k]), parseExpiry(lines[k], postISO));
    }
    i = j + 1;
  }
  return [...found.values()];
}

/** 다른 게임 파일에 이미 있는 코드 — 블로그가 여러 게임을 한 글에 다루면 섞인다. */
function loadForeignCodes(selfSlug) {
  const set = new Set();
  for (const f of fs.readdirSync(GAMES_DIR)) {
    if (!f.endsWith('.json') || f === `${selfSlug}.json`) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
      for (const c of d.codes || []) set.add(c.code.toUpperCase());
    } catch (e) { /* 깨진 파일은 무시 */ }
  }
  return set;
}

const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * 블로그 글의 발행일. se_publishDate 가 가장 정확하다(수정일과 헷갈리면 안 된다).
 * 방금 올라온 글은 "10분 전", "어제" 처럼 상대 표기로 나온다. 그것도 같이 받는다.
 */
/** 글 제목. 본문에 이름이 스치기만 한 글을 걸러내려면 제목을 봐야 한다. */
function postTitle(html) {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? ent(m[1]) : '';
}

function postDate(html) {
  const m = html.match(/se_publishDate[^>]*>\s*([^<]{2,30})/);
  if (!m) return null;
  const v = m[1].trim();

  const abs = v.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (abs) return `${abs[1]}-${String(abs[2]).padStart(2, '0')}-${String(abs[3]).padStart(2, '0')}`;

  const shift = (d) => {
    const t = new Date(todayISO() + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - d);
    return t.toISOString().slice(0, 10);
  };
  if (/방금|분\s*전|시간\s*전/.test(v)) return shift(0);
  if (/어제/.test(v)) return shift(1);
  const rel = v.match(/(\d{1,3})\s*일\s*전/);
  if (rel) return shift(Number(rel[1]));
  return null;
}

async function collectOne(g) {
  const today = todayISO();
  const query = encodeURIComponent(g.query || `${g.titleKo} 쿠폰`);
  // 기간만 최근 1개월로 묶는다. 기본 정렬(관련도순)을 그대로 쓴다 —
  // 최신순으로 바꾸면 알리·쿠팡 제휴 스팸 블로그가 상위를 덮어 실제 게임 글이 밀려난다(실측).
  const RECENT = '&sm=tab_opt&nso=' + encodeURIComponent('p:1m');
  const html = await getText(`https://search.naver.com/search.naver?where=view&query=${query}${RECENT}`);
  if (!html) return { ...g, error: '검색 실패' };

  const links = [...new Set(
    [...html.matchAll(/href="(https:\/\/blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{9,}))"/g)]
      .map((m) => `${m[2]}|${m[3]}`),
  )].slice(0, MAX_POSTS);
  if (!links.length) return { ...g, error: '블로그 글 없음' };

  const foreign = loadForeignCodes(g.slug);
  const codes = [];
  let scanned = 0, skippedOld = 0;

  for (const l of links) {
    const [id, no] = l.split('|');
    const url = `https://blog.naver.com/PostView.naver?blogId=${id}&logNo=${no}`
      + '&redirect=Dlog&widgetTypeCall=true&noTrackingCode=true&directAccess=false';
    const page = await getText(url);
    await sleep(400);
    if (!page) continue;

    const posted = postDate(page);
    // 지난 쿠폰은 담지 않는다. 오래된 글은 열어봐야 죽은 코드뿐이다.
    if (!posted || daysBetween(today, posted) > MAX_POST_AGE_DAYS) { skippedOld++; continue; }

    const text = bodyText(page);
    // 게임 이름이 본문에 있어야 한다. 블로그는 콜론·띄어쓰기를 제각각 쓰므로 눌러서 비교한다.
    // ("열혈강호: 귀환" → "열혈강호귀환")
    const squash = (x) => x.replace(/[\s:：·,]/g, '');
    // 제목에 게임 이름이 있어야 한다. 본문만 보면 "열혈강호: 넥스트" 글이
    // 본문에서 "귀환"을 한 번 언급했다는 이유로 귀환 쿠폰으로 둔갑한다(실측).
    // "헌터 키우기"가 "소울 헌터 키우기" 글을 물지 않게 — 이름 바로 앞에 한글·영문·숫자가 붙어 있으면 다른 게임이다.
    const sTitle = squash(postTitle(page)), sName = squash(g.titleKo);
    const at = sTitle.indexOf(sName);
    if (at < 0) continue;
    if (at > 0 && /[가-힣A-Za-z0-9]/.test(sTitle[at - 1])) continue;
    if (!squash(text).includes(sName)) continue;
    scanned++;

    for (const c of parseCodes(text, posted)) {
      if (foreign.has(c.code.toUpperCase())) continue;               // 다른 게임 코드
      if (codes.some((x) => x.code.toUpperCase() === c.code.toUpperCase())) continue;
      codes.push({ ...c, sourceUrl: `https://blog.naver.com/${id}/${no}` });
    }
  }

  if (!codes.length) {
    return { ...g, error: skippedOld ? `최근 ${MAX_POST_AGE_DAYS}일 글 없음(오래된 글 ${skippedOld}건 건너뜀)` : '코드 없음' };
  }
  return { ...g, codes, scanned, skippedOld };
}

function merge(prev, fresh) {
  const today = todayISO();
  const prevByCode = new Map((prev?.codes || []).map((c) => [c.code.toUpperCase(), c]));
  const freshSet = new Set(fresh.map((c) => c.code.toUpperCase()));
  const merged = [];

  for (const c of fresh) {
    const old = prevByCode.get(c.code.toUpperCase());
    merged.push({
      code: c.code,
      reward: old?.reward || '',
      expiry: c.expiry || old?.expiry || null,
      postedAt: c.postedAt || old?.postedAt || null,
      sourceUrl: c.sourceUrl || old?.sourceUrl || null,
      firstSeen: old?.firstSeen || today,
      lastSeen: today,
      status: 'active',
    });
  }
  for (const [, old] of prevByCode) {
    if (freshSet.has(old.code.toUpperCase())) continue;
    merged.push({ ...old, status: old.lastSeen && old.lastSeen !== today ? 'expired' : (old.status || 'active') });
  }
  for (const c of merged) {
    if (c.expiry) c.status = c.expiry < today ? 'expired' : 'active';
    else if (c.postedAt && daysBetween(today, c.postedAt) > STALE_DAYS) c.status = 'expired';
  }
  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.firstSeen || '').localeCompare(a.firstSeen || '');
  });
  return merged;
}

async function main() {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const manual = JSON.parse(fs.readFileSync(CONF, 'utf8')).games;
  let auto = [];
  try { auto = JSON.parse(fs.readFileSync(CONF_AUTO, 'utf8')).games || []; } catch (e) { /* 아직 없음 */ }
  const seen = new Set(manual.map((g) => g.slug));
  const list = [...manual, ...auto.filter((g) => !seen.has(g.slug))];
  const only = process.argv.find((a) => a.startsWith('--only='));
  const targets = only ? list.filter((g) => g.slug === only.split('=')[1]) : list;

  console.log(`[search] ${targets.length}개 게임 수집 시작`);
  let ok = 0, skip = 0, changed = 0, newCodes = 0;

  for (const g of targets) {
    const r = await collectOne(g).catch((e) => ({ ...g, error: String(e.message || e) }));
    if (r.error) { console.log(`  - ${g.titleKo}: ${r.error}`); skip++; await sleep(400); continue; }

    const file = path.join(GAMES_DIR, `${g.slug}.json`);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 신규 */ }
    const codes = merge(prev, r.codes);
    const before = JSON.stringify(prev?.codes || []);
    const out = {
      slug: g.slug,
      titleEn: g.titleEn || prev?.titleEn || g.slug,
      titleKo: g.titleKo,
      image: prev?.image || null,
      source: 'naver-search',
      howTo: prev?.howTo || '',
      updatedAt: new Date().toISOString(),
      codes,
    };
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    const active = codes.filter((c) => c.status === 'active').length;
    if (JSON.stringify(codes) !== before) changed++;
    newCodes += codes.filter((c) => c.firstSeen === todayISO()).length;
    ok++;
    console.log(`  + ${g.titleKo}: 코드 ${codes.length}개(사용가능 ${active}) · 최근글 ${r.scanned}건`);
    await sleep(500);
  }

  console.log(`[search] 완료 — 성공 ${ok} · 건너뜀 ${skip} · 변경 ${changed}`);
  console.log(`SEARCH_CHANGED=${changed}`);
  console.log(`SEARCH_NEW=${newCodes}`);
}

main();
