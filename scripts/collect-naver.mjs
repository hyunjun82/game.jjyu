/**
 * 네이버 게임 라운지 쿠폰 수집기.
 *
 * 왜 필요한가
 *   Pocket Gamer(영문 소스)는 한국 신작을 다루지 않는다. 반면 국내 서비스 게임은
 *   네이버 게임 라운지 공식 라운지의 "쿠폰 코드" 게시판에 매주 코드를 올린다.
 *   이 API는 무인증으로 열려 있다(2026-09-07 실측).
 *
 * 수집 원칙 (collect.mjs 와 동일)
 *   1) 코드는 지어내지 않는다. 본문 텍스트에 없는 문자열은 버린다.
 *   2) 만료된 코드는 지우지 않고 expired 로 내린다.
 *   3) 운영자(game_manager) 글만 읽는다 — 유저가 올린 "갤럭시스토어 할인쿠폰"은
 *      게임 리딤 코드가 아니라서 반드시 걸러야 한다.
 *
 * API 메모
 *   - 목록 응답의 feed.contents 는 스마트에디터 JSON, 상세 응답은 렌더된 HTML 이다.
 *     둘 다 처리한다.
 *   - boardId 를 주면 offset=0 만 동작한다(최신 30건). totalCount 로 누적 발행량은 알 수 있다.
 *   - memberAccessBoard:true 인 보드는 비로그인으로 본문을 못 읽는다(403). 건너뛴다.
 */
import fs from 'node:fs';
import path from 'node:path';

const B1 = 'https://comm-api.game.naver.com/nng_main/v1';
const ROOT = path.resolve(import.meta.dirname, '..');
const GAMES_DIR = path.join(ROOT, 'data', 'games');
const CONF = path.join(ROOT, 'data', 'naver-lounges.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 바디의 code 필드로 판정한다 — HTTP 200 에 code:30002 가 실려 오는 경우가 있다. */
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data && data.code === 200) return data;
    } catch (e) { /* 연결 리셋이 산발적으로 난다. 재시도로 흡수 */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

const ent = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** 스마트에디터 JSON 이면 nodes[].value 를 모으고, HTML 이면 태그를 턴다. */
function bodyText(raw) {
  if (!raw) return '';
  if (raw.trimStart().startsWith('{')) {
    const out = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'value' && typeof v === 'string') { if (v.trim()) out.push(v.trim()); }
          else walk(v);
        }
      }
    };
    try { walk(JSON.parse(raw)); } catch (e) { return ''; }
    return out.join('\n');
  }
  const t = raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return ent(t).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const BOARD_RE = /쿠폰|선물\s*코드|코드\s*선물|기프트/;
const LABEL_RE = /쿠폰|리딤|기프트|선물\s*코드|코드|번호|CDK/i;
const STOP = new Set([
  'GOOGLE','PLAY','STORE','APPLE','ONESTORE','GALAXY','SAMSUNG','ANDROID','IOS','APK',
  'HTTP','HTTPS','WWW','COM','NAVER','LOUNGE','EVENT','UPDATE','NOTICE','GAME','GM','CM',
  'VIP','SNS','FAQ','QNA','PC','TIP','NEW','HOT','BEST','ALL','AND','THE','FOR','YOU',
  'CLICK','LINK','HERE','DOWNLOAD','WINDOWS','MACOS',
]);

/** 코드처럼 생겼는지. 숫자만·너무 짧은 것·흔한 영단어는 버린다. */
function isSaneCode(c) {
  if (!c) return false;
  if (c.length < 5 || c.length > 20) return false;
  if (!/^[A-Za-z0-9]+$/.test(c)) return false;
  if (STOP.has(c.toUpperCase())) return false;
  if (/^\d+$/.test(c)) return false;                    // 숫자만
  if (/^(19|20)\d{2}$/.test(c)) return false;           // 연도
  const hasDigit = /\d/.test(c);
  const allUpper = /^[A-Z]+$/.test(c);
  return hasDigit || allUpper;                          // 311k93 / MZF1334 / ZPXKLU / GASDDW
}

/** "유효 기간: ~ 9월 11일 00:00" 같은 표기를 ISO 날짜로. 연도가 없으면 가장 가까운 미래. */
function parseExpiry(text, postISO) {
  const m = text.match(/유효\s*기간[^0-9]{0,12}(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    || text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:까지|마감)/);
  if (!m) return null;
  const mon = Number(m[1]), day = Number(m[2]);
  if (!(mon >= 1 && mon <= 12 && day >= 1 && day <= 31)) return null;
  // 연도는 글이 올라온 해를 쓴다. 오늘 기준으로 잡으면 6월 글의 "7월 3일"이 내년으로 튄다.
  const base = postISO ? new Date(postISO + 'T00:00:00Z') : new Date();
  let year = base.getUTCFullYear();
  // 12월 글에 "1월 5일"처럼 해를 넘기는 표기만 +1 한다
  if (mon < base.getUTCMonth() + 1 - 6) year += 1;
  return new Date(Date.UTC(year, mon - 1, day)).toISOString().slice(0, 10);
}

/** 본문에서 { code, reward, expiry } 목록을 뽑는다. 라벨 근처(±3줄)만 인정한다. */
function parseCodes(text, postISO) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const labelAt = lines.map((l) => LABEL_RE.test(l));
  const expiry = parseExpiry(text, postISO);
  const found = new Map();

  const push = (code) => {
    if (!isSaneCode(code)) return;
    const key = code.toUpperCase();
    if (!found.has(key)) found.set(key, { code, reward: '', expiry, postedAt: postISO || null });
  };

  lines.forEach((line, i) => {
    // (가) 인라인: "쿠폰 코드:311k93", "쿠폰 번호: ZPXKLU"
    const inline = line.match(/(?:코드|번호|CDK)\s*[:：]?\s*([A-Za-z0-9]{5,20})\s*$/i);
    if (inline) push(inline[1]);

    // (나) 단독 줄이 통째로 코드인 경우 — 라벨이 위아래 3줄 안에 있어야 인정
    if (/^[A-Za-z0-9]{5,20}$/.test(line)) {
      const near = labelAt.slice(Math.max(0, i - 3), i + 4).some(Boolean);
      if (near) push(line);
    }
  });
  return [...found.values()];
}

/** 쿠폰 입력 방법 안내 — 한국 검색어 "입력 방법"이 상위라 페이지에 쓸 값이다. */
function parseHowTo(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /사용\s*방법|교환\s*방법|입력\s*방법|등록\s*방법/.test(l));
  if (start < 0) return '';
  const steps = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 9); i++) {
    const l = lines[i];
    if (/^(감사|받아서|앞으로도|>>|👉)/.test(l)) break;
    if (l.length > 90) continue;
    steps.push(l);
    if (steps.length >= 5) break;
  }
  return steps.join(' ').slice(0, 300);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** 만료일 표기가 없는 코드의 수명. 주간 발행이 표준이라 2주면 충분히 넉넉하다. */
const STALE_DAYS = 14;
const isStale = (postedAt, today) =>
  !!postedAt && (Date.parse(today) - Date.parse(postedAt)) / 86400000 > STALE_DAYS;

/** 기존 파일과 병합 — collect.mjs 와 동일 규칙. */
function merge(prev, freshCodes) {
  const today = todayISO();
  const prevByCode = new Map((prev?.codes || []).map((c) => [c.code.toUpperCase(), c]));
  const freshSet = new Set(freshCodes.map((c) => c.code.toUpperCase()));
  const merged = [];

  for (const c of freshCodes) {
    const old = prevByCode.get(c.code.toUpperCase());
    merged.push({
      code: c.code,
      reward: c.reward || old?.reward || '',
      expiry: c.expiry || old?.expiry || null,
      postedAt: c.postedAt || old?.postedAt || null,
      firstSeen: old?.firstSeen || today,
      lastSeen: today,
      status: 'active',
    });
  }
  for (const [, old] of prevByCode) {
    if (freshSet.has(old.code.toUpperCase())) continue;
    const gone = old.lastSeen && old.lastSeen !== today;
    merged.push({ ...old, status: gone ? 'expired' : old.status || 'active' });
  }
  for (const c of merged) {
    if (c.expiry) c.status = c.expiry < today ? 'expired' : 'active';
    else if (isStale(c.postedAt, today)) c.status = 'expired';
  }

  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.firstSeen || '').localeCompare(a.firstSeen || '');
  });
  return merged;
}

async function collectOne(g) {
  const boardRes = await get(`${B1}/lounge/${g.loungeId}/board`);
  if (!boardRes) return { ...g, error: '보드 조회 실패' };

  const boards = (boardRes.content.boardViews || [])
    .filter((v) => v.board)
    .map((v) => v.board)
    .filter((b) => BOARD_RE.test(b.boardName) && !b.memberWriteBoard);

  if (!boards.length) return { ...g, error: '쿠폰 보드 없음' };

  const codes = [];
  let howTo = '', image = null, total = 0, latest = null, sourceUrl = null, locked = false;

  for (const b of boards) {
    if (b.memberAccessBoard) { locked = true; continue; }  // 가입 필요 — 본문 403
    const q = `offset=0&limit=30&order=NEW&buffFilteringYN=N&boardId=${b.boardId}`;
    const feed = await get(`${B1}/community/lounge/${g.loungeId}/feed?${q}`);
    await sleep(300);
    if (!feed || !feed.content.feeds?.length) { locked = true; continue; }

    total += feed.content.totalCount || 0;

    for (const item of feed.content.feeds) {
      if (item.user?.userRoleCode === 'common_user') continue;   // 유저 글 제외
      const text = bodyText(item.feed.contents);
      if (!text) continue;
      const d = String(item.feed.createdDate || '');
      const iso = d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
      const got = parseCodes(text, iso);
      if (!got.length) continue;

      if (!latest || (iso && iso > latest)) {
        latest = iso;
        sourceUrl = item.feedLink?.pc || null;
        if (!howTo) howTo = parseHowTo(text);
      }
      if (!image) image = item.feed.repImageUrl || item.lounge?.logoImageSquareUrl || null;
      for (const c of got) if (!codes.some((x) => x.code.toUpperCase() === c.code.toUpperCase())) codes.push(c);
    }
  }

  if (!codes.length) return { ...g, error: locked ? '보드 잠김(가입 필요)' : '코드 없음', total };
  return { ...g, codes, howTo, image, total, latest, sourceUrl };
}

async function main() {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
  const list = conf.lounges;
  const only = process.argv.find((a) => a.startsWith('--only='));
  // --fresh: 기존 파일을 무시하고 소스 기준으로 새로 쓴다(파서 수정 후 잔여물 정리용)
  const fresh = process.argv.includes('--fresh');
  const targets = only ? list.filter((g) => g.slug === only.split('=')[1]) : list;

  console.log(`[naver] ${targets.length}개 라운지 수집 시작`);
  let ok = 0, skip = 0, changed = 0, newCodes = 0;

  for (const g of targets) {
    const r = await collectOne(g).catch((e) => ({ ...g, error: String(e.message || e) }));
    if (r.error) { console.log(`  - ${r.titleKo}: ${r.error}`); skip++; await sleep(300); continue; }

    const file = path.join(GAMES_DIR, `${g.slug}.json`);
    const prev = !fresh && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const codes = merge(prev, r.codes);
    const before = prev ? JSON.stringify(prev.codes) : '';

    const next = {
      slug: g.slug,
      titleEn: g.titleEn || prev?.titleEn || g.slug,
      titleKo: g.titleKo,
      image: r.image || prev?.image || null,
      source: 'naver-lounge',
      loungeId: g.loungeId,
      sourceUrl: r.sourceUrl || prev?.sourceUrl || null,
      howTo: r.howTo || prev?.howTo || '',
      postCount: r.total || null,
      updatedAt: new Date().toISOString(),
      codes,
    };
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    if (before !== JSON.stringify(codes)) changed++;
    newCodes += codes.filter((c) => c.firstSeen === todayISO()).length;
    ok++;
    const act = codes.filter((c) => c.status === 'active').length;
    console.log(`  + ${g.titleKo}: 코드 ${codes.length}개(사용가능 ${act}) · 누적글 ${r.total} · 최신 ${r.latest}`);
    await sleep(300);
  }

  console.log(`[naver] 완료 — 성공 ${ok} · 건너뜀 ${skip} · 변경 ${changed}`);
  console.log(`NAVER_CHANGED=${changed}`);
  console.log(`NAVER_NEW=${newCodes}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
