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
// 라운지 목록은 scripts/ 쪽을 우선한다.
// data/ 는 파일이 400개 가까워서 깃허브 웹 편집기가 커밋을 못 받는다(500). 목록을 손으로
// 늘릴 때는 여기에 올리고, data/ 쪽은 기존 항목을 남겨 둔 채 합친다(loungeId 기준 중복 제거).
const CONF_EXTRA = path.join(ROOT, 'scripts', 'naver-lounges.json');

export function loadLounges() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).lounges || []; } catch (e) { return []; } };
  const seen = new Set();
  const out = [];
  for (const g of [...read(CONF_EXTRA), ...read(CONF)]) {
    const key = String(g.loungeId).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

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

/**
 * 홈 "따끈따끈 이벤트 소식" 피드 — 모든 공식 라운지가 올린 "진행 중" 이벤트 목록.
 * 게임사가 이벤트마다 시작·종료일을 직접 적어 두므로, 본문에 만료일이 없는 쿠폰은
 * 이 종료일을 만료일로 쓴다. 2026-09-19 실측: 255건, 그중 쿠폰 이벤트 26건.
 * 실패해도 수집은 계속한다(만료일만 못 붙을 뿐).
 */
let EVENTS_P = null;
export function fetchEvents() {
  if (EVENTS_P) return EVENTS_P;
  EVENTS_P = (async () => {
    const all = [];
    for (let p = 1; p <= 5; p++) {
      const r = await get(`${B1}/home/game-company-events?pageNo=${p}&limit=150&direction=NEXT&pagingType=PAGE_NO`);
      const d = r?.content?.data || [];
      if (!d.length) break;
      all.push(...d);
      if (all.length >= (r.content.totalCount || 0)) break;
      await sleep(400);
    }
    return all;
  })();
  return EVENTS_P;
}
/**
 * feedId → { end, open, loungeId, title }.
 *   end  : 'YYYY-MM-DD' 종료일(없으면 null)
 *   open : 종료일 없이 "진행 중"으로 걸려 있는 이벤트 — 게임사가 끝내기 전까지 상시 쿠폰이다.
 */
/** 사전예약·사전등록 글도 본다 — 출시 전 게임이 "선물 코드"를 여기에 올린다(소드 앤 프론티아·혼문·요괴잡이소대). */
const PREREG_RE = /사전\s*(?:예약|등록)/;
const EVENT_TITLE_RE = /쿠폰|선물\s*코드|코드\s*선물|기프트\s*코드|리딤|사전\s*(?:예약|등록)/;
async function eventIndex() {
  const m = new Map();
  for (const e of await fetchEvents()) {
    if (!e.feedId) continue;
    const end = String(e.eventEndDate || '').slice(0, 10);
    m.set(Number(e.feedId), {
      end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null,
      open: !/^\d{4}-\d{2}-\d{2}$/.test(end),
      loungeId: String(e.loungeId || e.originalLoungeId || ''),
      title: ent(e.feedTitle),
    });
  }
  return m;
}

const ent = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** 스마트에디터 JSON 이면 nodes[].value 를 모으고, HTML 이면 태그를 턴다. */
export function bodyText(raw) {
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

const BOARD_RE = /쿠폰|교환\s*코드|선물\s*코드|코드\s*선물|기프트|사전\s*(?:예약|등록)/;
const LABEL_RE = /쿠폰|리딤|기프트|선물\s*코드|코드|번호|CDK/i;
const STOP = new Set([
  'GOOGLE','PLAY','STORE','APPLE','ONESTORE','GALAXY','SAMSUNG','ANDROID','IOS','APK',
  'HTTP','HTTPS','WWW','COM','NAVER','LOUNGE','EVENT','UPDATE','NOTICE','GAME','GM','CM',
  'VIP','SNS','FAQ','QNA','PC','TIP','NEW','HOT','BEST','ALL','AND','THE','FOR','YOU',
  'CLICK','LINK','HERE','DOWNLOAD','WINDOWS','MACOS',
  'DISCORD','TIKTOK','YOUTUBE','FACEBOOK','TWITTER','INSTAGRAM','KAKAO','CAFE',
  'OFFICIAL','GIFT','CODE','COUPON','REWARD','ITEM','ITEMS','LEVEL','SERVER',
  'TEAM','MVP','SVP','CHECK','ENTER','INPUT','OPEN','FREE','MOBILE','ONLINE',
  'VERSION','PLAYSTORE','APPSTORE','ONLY','WITH','FROM','THIS','THAT','YOUR',
  'MORE','TIME','DATE','NAME','POINT','POINTS','BONUS','SHARE','LIKE','FOLLOW',
  'COMING','SOON','TBA','TBD','NONE','NULL','TRUE','FALSE','ERROR','LOGIN','LOGOUT',
]);

/** 코드처럼 생겼는지. 숫자만·너무 짧은 것·흔한 영단어는 버린다. */
function isSaneCode(c, labeled = false) {
  if (!c) return false;
  // "6984-63786bf85-1" 처럼 하이픈으로 끊은 코드(삼국지 오리진2). 영문·숫자가 섞인 것만 — 날짜(2026-10-01)는 거른다.
  if (c.includes('-')) return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,4}$/.test(c) && c.length <= 24 && /[A-Za-z]/.test(c) && /\d/.test(c);
  if (c.length < 5 || c.length > 20) return false;
  if (!/^[A-Za-z0-9]+$/.test(c)) return false;
  // 입력 방법 안내의 "STEP1", "Step2" 가 코드로 잡혔다(오피스 퀸 키우기·우와 모험단·데블2M, 2026-09-25).
  if (/^(?:step|page|day|lv|no|ver|part|week|round|stage)\d{1,2}$/i.test(c)) return false;
  if (STOP.has(c.toUpperCase())) return false;
  if (/^\d+$/.test(c)) return false;                    // 숫자만
  if (/^(19|20)\d{2}$/.test(c)) return false;           // 연도
  const hasDigit = /\d/.test(c);
  const allUpper = /^[A-Z]+$/.test(c);
  // 소문자만으로 된 코드도 실제로 쓴다 — evernightopen, yulgangnextopen, joywhoa …
  // 영단어가 딸려 들어올 위험은 STOP 목록과 "라벨 근처" 규칙이 막는다.
  const allLower = c.length >= 6 && /^[a-z]+$/.test(c);
  // "쿠폰코드: Artemis" 처럼 라벨 바로 뒤에 붙은 토큰은 대소문자 섞여도 코드다.
  // 라벨 없이 굴러다니는 영단어(Google, Update)는 여전히 버린다.
  if (labeled && /^[A-Za-z]+$/.test(c)) return true;
  return hasDigit || allUpper || allLower;              // 311k93 / MZF1334 / ZPXKLU / evernightopen
}

/**
 * 만료 표기를 ISO 날짜로. 실측한 표기를 모두 받는다.
 *   "2026년 7월 10일(금)까지"  /  "(26/07/19(일) 08:59까지)"  /  "유효 기간: ~ 9월 11일 00:00"
 *
 * 원칙: "까지·마감"이 붙은 날짜만 만료일로 본다. 본문에 그냥 적힌 날짜는
 * 이벤트 시작일이나 점검일인 경우가 많아서 집으면 안 된다.
 * 기간이 "A부터 B까지"로 적히면 마지막에 걸린 B가 남는다.
 */
const TAIL = String.raw`(?:\([^)]{0,6}\))?\s*(?:\d{1,2}\s*[:시]\s*\d{2}\s*분?)?\s*(?:\((?:UTC|KST)\))?\s*(?:까지|마감)`;
const RE_KO = new RegExp(String.raw`(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*` + TAIL, 'g');
const RE_SLASH = new RegExp(String.raw`(\d{2,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*` + TAIL, 'g');

const iso = (y, mo, dy) =>
  (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)
    ? new Date(Date.UTC(y, mo - 1, dy)).toISOString().slice(0, 10)
    : null;

/** @param allowRange "기간: A ~ B" 표기를 받을지. 줄 단위로만 켠다 — 글 전체에서 집으면 다른 이벤트 기간이 섞인다. */
function parseExpiry(text, postISO, allowRange = false) {
  // 글이 올라온 해를 기준으로 삼는다. 오늘 기준으로 잡으면 6월 글의 "7월 3일"이 내년으로 튄다.
  const base = postISO ? new Date(postISO + 'T00:00:00Z') : new Date();
  let last = null;

  for (const m of text.matchAll(RE_SLASH)) {
    let y = Number(m[1]); if (y < 100) y += 2000;
    last = iso(y, Number(m[2]), Number(m[3])) || last;
  }
  for (const m of text.matchAll(RE_KO)) {
    const mon = Number(m[2]), day = Number(m[3]);
    let year = m[1] ? Number(m[1]) : base.getUTCFullYear();
    // 12월 글에 "1월 5일"처럼 해를 넘기는 표기만 +1 한다
    if (!m[1] && mon < base.getUTCMonth() + 1 - 6) year += 1;
    last = iso(year, mon, day) || last;
  }
  if (last) return last;

  // "사용 기한: ~2026/9/17 23:59" / "사용 기간: 2026년 9월 23일 ~ 2026년 12월 31일" — 연도가 붙은 라벨 표기.
  // 물결이 있으면 물결 뒤 날짜가 끝날이다. 라그나로크M 클래식 코드 8개가 이 표기를 못 읽어 만료 후에도
  // 사용 가능으로 남았다(2026-09-23 검수).
  const labY = text.match(/(?:사용\s*기한|사용\s*기간|유효\s*기간|만료\s*(?:시간|일자|일)|종료\s*(?:시간|일시|일))\s*[:：]?\s*([^\n]{0,60})/);
  if (labY) {
    const seg = labY[1];
    const dates = [...seg.matchAll(/(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})/g)];
    if (dates.length) {
      const tilde = seg.indexOf('~') >= 0 ? seg.indexOf('~') : seg.indexOf('～');
      const pick = tilde >= 0 ? (dates.find((d) => d.index > tilde) || dates[dates.length - 1]) : dates[dates.length - 1];
      const v = iso(Number(pick[1]), Number(pick[2]), Number(pick[3]));
      if (v) return v;
    }
  }
  // "유효 기간: ~ 9월 11일", "만료 시간 - [9/5 04:59]" 처럼 까지가 없는 표기는 라벨로 받는다.
  const lab = text.match(/(?:유효\s*기간|만료\s*(?:시간|일자|일))[^0-9]{0,12}(\d{1,2})\s*[월/.]\s*(\d{1,2})/);
  if (lab) {
    const mon = Number(lab[1]), day = Number(lab[2]);
    let year = base.getUTCFullYear();
    if (mon < base.getUTCMonth() + 1 - 6) year += 1;
    return iso(year, mon, day);
  }

  // "기간: 9.18 ~ 9.25 17:00" / "기간: 2026년 9월 18일(금) ~ 2026년 9월 22일(화)"
  // 물결 뒤의 날짜가 끝날이다. "기간" 이 앞에 있을 때만 받는다 — 본문에 그냥 적힌 범위는 점검 시간일 수 있다.
  const rng = allowRange && text.match(RE_RANGE);
  if (rng) {
    const mon = Number(rng[2]), day = Number(rng[3]);
    let year = rng[1] ? Number(rng[1]) : base.getUTCFullYear();
    if (!rng[1] && mon < base.getUTCMonth() + 1 - 6) year += 1;
    return iso(year, mon, day);
  }
  return null;
}
const RE_DATE1 = String.raw`(?:\d{4}\s*[년./]\s*)?\d{1,2}\s*[./월]\s*\d{1,2}\s*일?\s*(?:\([^)]{0,3}\))?\s*(?:\d{1,2}:\d{2})?`;
const RE_RANGE = new RegExp(String.raw`기간[^0-9\n]{0,6}(?:` + RE_DATE1 + String.raw`\s*)?[~～∼]\s*(?:(\d{4})\s*[년./]\s*)?(\d{1,2})\s*[./월]\s*(\d{1,2})`);

/**
 * 본문에서 { code, reward, expiry } 목록을 뽑는다.
 *
 * 발행처마다 코드를 쓰는 모양이 다르다. 실측한 세 가지를 모두 받는다.
 *   (가) 인라인        "쿠폰 코드: 311k93"
 *   (나) 세로 나열      "선물 코드" 아래로 vip555 / vip666 / ... 11줄
 *   (다) 불릿·이모지    "- VR26CHAMPIONSHIP", "🎁 VRJULY2026 (26/07/19까지)"
 *
 * (나)를 한 줄씩 보면서 라벨 ±3줄만 인정하면 4번째 코드부터 잘려 나간다.
 * 그래서 연속된 코드 줄을 한 덩어리로 묶고, 덩어리의 앞뒤 3줄에 라벨이 있으면
 * 덩어리 전체를 받는다. 라벨을 요구하는 원칙은 그대로라 잡음은 늘지 않는다.
 */
const BULLET = /^(?:[^A-Za-z0-9가-힣]+|\d{1,2}[.)]\s)\s*/u;

/** 줄이 코드 한 개로만 이뤄졌으면 그 코드를, 아니면 빈 문자열을. 뒤에 괄호는 허용한다. */
function tokenOf(line) {
  const m = line.match(/^([A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,4}|[A-Za-z0-9]{5,20})\s*(.*)$/);
  if (!m) return '';
  const rest = m[2].trim();
  // 뒤에 괄호나 장식(<<, «, ✨)만 붙은 건 허용한다. "TOP 3 팀" 처럼 글자가 이어지면 버린다.
  if (rest && !/^[(（[]/.test(rest) && /^[A-Za-z0-9가-힣]/u.test(rest)) return '';
  return m[1];
}

export function parseCodes(text, postISO) {
  const lines = text.split('\n').map((s) => s.trim().replace(BULLET, '').trim()).filter(Boolean);
  const labelAt = lines.map((l) => LABEL_RE.test(l));
  const codeAt = lines.map((l) => { const t = tokenOf(l); return !!t && isSaneCode(t); });
  const postExpiry = parseExpiry(text, postISO);
  const found = new Map();

  const push = (code, expiry, labeled = false) => {
    if (!isSaneCode(code, labeled)) return;
    const key = code.toUpperCase();
    if (!found.has(key)) {
      found.set(key, { code, reward: '', expiry: expiry || postExpiry, postedAt: postISO || null });
    }
  };

  // (가) 인라인 — "쿠폰 코드: 311k93" / "쿠폰코드: FALLFEST ✨ 기간: 9.18 ~ 9.25" / "쿠폰 >> FIRSTSNOW2025 << 코드"
  const inlineOf = (line) => line.match(/(?:코드|번호|CDK)\s*[:：]?\s*([A-Za-z0-9]{5,20})\s*$/i)
    || line.match(/(?:코드|번호|CDK)\s*[:：]\s*([A-Za-z0-9]{5,20})(?![A-Za-z0-9])/i)
    || (LABEL_RE.test(line) && line.match(/(?:>>|»|【|「|\[)\s*([A-Za-z0-9]{5,20})\s*(?:<<|«|】|」|\])/));
  // "🎁：shuubun2026" — 선물 아이콘 뒤에 코드만 적는 발행처(에이펙스 걸스). 줄머리 기호를 떼기 전 원문으로 본다.
  for (const raw of text.split('\n')) {
    const g = raw.trim().match(/^🎁\s*[:：]\s*([A-Za-z0-9]{5,20})\s*$/u);
    if (g) push(g[1], parseExpiry(text, postISO), true);
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = inlineOf(line);
    if (!inline) continue;
    const labeled = /(?:쿠폰\s*(?:코드|번호)|교환\s*코드|선물\s*코드|리딤\s*코드|기프트\s*코드)\s*[:：]\s*[A-Za-z0-9]/i.test(line);
    // "쿠폰번호 : autumn26, moon26" — 한 줄에 쉼표로 여러 개(우와 모험단). 첫 코드 뒤의 것도 받는다.
    const tail = line.slice(line.indexOf(inline[1]) + inline[1].length);
    const more = /^\s*[,，/]/.test(tail) ? tail.split(/[,，/]/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9]{5,20}$/.test(x)) : [];
    // 같은 줄, 없으면 바로 아래 두 줄에 적힌 "기간 ~ 9.18" 이 그 코드만의 만료일이다.
    // 글 전체 기준 날짜로 떨어지면 첫 코드의 기간을 둘째 코드가 물려받는다(주말 쿠폰 사고).
    let expiry = parseExpiry(line, postISO, true);
    for (let k = i + 1; !expiry && k <= i + 2 && k < lines.length; k++) {
      if (inlineOf(lines[k])) break;                       // 다음 코드의 기간은 안 본다
      expiry = parseExpiry(lines[k], postISO, true);
    }
    push(inline[1], expiry, labeled);
    for (const x of more) push(x, expiry, labeled);
  }

  // 코드 줄의 만료일: 그 줄(뒤 괄호), 없으면 다음 코드 줄 전까지 최대 3줄 안의 "까지" 날짜.
  // 표로 올리는 발행처는 코드 | 보상 | 조건 | 기간 순으로 셀이 한 줄씩 떨어진다(별별 히어로).
  const expiryAt = (k) => {
    let e = parseExpiry(lines[k], postISO, true);
    for (let n = k + 1; !e && n <= k + 3 && n < lines.length && !codeAt[n]; n++) e = parseExpiry(lines[n], postISO, true);
    return e;
  };
  const accepted = new Set();

  // (나)(다) 연속 코드 덩어리 — 덩어리 앞 3줄 또는 뒤 3줄에 라벨이 있어야 인정
  for (let i = 0; i < lines.length; ) {
    if (!codeAt[i]) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && codeAt[j + 1]) j++;
    const near = labelAt.slice(Math.max(0, i - 3), i).some(Boolean)
      || labelAt.slice(j + 1, j + 4).some(Boolean);
    if (near && j - i + 1 <= 40) {
      for (let k = i; k <= j; k++) { push(tokenOf(lines[k]), expiryAt(k)); accepted.add(k); }
    }
    i = j + 1;
  }

  // (라) 표의 다음 행 — 인정된 코드 줄에서 12줄 안에 또 코드 줄이 오면 같은 표의 다음 행이다.
  // 라벨은 표 머리에만 있어서 둘째 행부터는 ±3줄 규칙에 걸리지 않는다. 행을 따라 내려간다.
  // (테이밍 마스터 2 는 한 행이 코드·기간·보상 7~9줄이다.)
  // 사이에 문장(감사합니다·참고·방법…)이 끼면 표가 끝난 것이다 — 본문의 잡동사니 토큰을 막는다.
  const SENTENCE = /습니다|세요|입니다|감사|안내|방법|주의|참고|유의|바랍|문의|공지/;
  for (let i = 0; i < lines.length; i++) {
    if (!codeAt[i] || accepted.has(i)) continue;
    let prev = -1;
    for (let k = i - 1; k >= Math.max(0, i - 12); k--) if (accepted.has(k)) { prev = k; break; }
    if (prev < 0) continue;
    let broken = false;
    for (let k = prev + 1; k < i; k++) if (SENTENCE.test(lines[k]) || labelAt[k]) { broken = true; break; }
    if (broken) continue;
    push(tokenOf(lines[i]), expiryAt(i));
    accepted.add(i);
  }
  // (마) 펼쳐진 표 — 헤더 셀이 전부 먼저 오고 값 셀이 뒤따르는 형태.
  //   쿠폰코드 / 시작 날짜 / 종료 날짜 / 보상1 / ...      ← 헤더 줄들
  //   7MQ3ZK  / 09월 21일 / 09월 22일 / 골드 / ...        ← 값 줄들
  // 이러면 코드와 "쿠폰코드" 라벨이 15줄까지 벌어져 ±3줄 규칙에 안 걸린다(나 혼자 만렙 키우기 실측).
  // 헤더 개수만큼 칸을 세어 값 줄을 맞추면 코드도 종료일도 정확히 집힌다. 행이 여러 개면 계속 읽는다.
  const CODE_LABEL = /^(?:쿠폰\s*(?:코드|명|번호)|코드|교환\s*코드|기프트\s*코드)$/;
  const END_LABEL = /종료|만료|사용\s*기한|유효/;
  const HEADER_CELL = /^.{1,14}$/;
  for (let i = 0; i < lines.length; i++) {
    if (!CODE_LABEL.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && HEADER_CELL.test(lines[j]) && !codeAt[j] && !/^(?:20\d{2}|\d{1,2})\s*[.년/]/.test(lines[j])) j++;
    const width = j - i;
    if (width < 2 || !codeAt[j]) continue;                 // 표가 아니거나 첫 값이 코드가 아니면 버린다
    const headers = lines.slice(i, j);
    const endAt = headers.findIndex((h) => END_LABEL.test(h));
    for (let row = j; row + width <= lines.length && codeAt[row]; row += width) {
      const cells = lines.slice(row, row + width);
      let exp = null;
      if (endAt > 0) exp = parseExpiry(cells[endAt] + ' 까지', postISO) || parseExpiry(cells[endAt], postISO, true);
      push(tokenOf(cells[0]), exp);
    }
  }
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
    if (/^(감사|받아서|앞으로도|>>|👉|⭐|★|▶|\[)/.test(l)) break;
    if (/다운로드|공식\s*(디스코드|틱톡|카페|채널)|바로가기/.test(l)) break;
    if (l.length > 90) continue;
    steps.push(l);
    if (steps.length >= 5) break;
  }
  return steps.join(' ').slice(0, 300);
}

/**
 * 날짜 기준은 KST 로 통일한다.
 * collect.mjs·verify.mjs 는 KST 인데 여기만 UTC 를 쓰면, 한국 시간 자정~오전 9시 사이에
 * 만료 처리가 하루 늦어진다. 그 사이 발행 점검이 "만료일이 지났는데 사용가능"으로 잡아 실패한다.
 */
export const todayISO = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

/** 만료일 표기가 없는 코드의 수명. 주간 발행이 표준이라 2주면 충분히 넉넉하다. */
const STALE_DAYS = 14;
/**
 * 이보다 먼 만료일은 파싱 사고로 본다.
 * 120일로 잡았다가 실제 장기 쿠폰(닥사RPG 160일, 혼 293일, 삼국지 공성판 372일)을 전부 만료로
 * 떨어뜨렸고, 3년으로 올렸더니 "2029년 12월 31일까지"라고 적힌 웰컴 쿠폰(우산소녀 키우기)이
 * 또 떨어졌다. 게임사가 적은 날짜는 그대로 믿는다. 10년은 오타(2099 등)만 거르는 선이다.
 */
const MAX_VALID_DAYS = 365 * 10;
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
      expiryFrom: c.expiryFrom || (c.expiry ? null : old?.expiryFrom) || null,
      tag: c.tag || old?.tag || null,
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
  // 게시일로부터 10년을 넘는 만료일은 믿지 않는다. 지우고 경과일 규칙으로 넘긴다.
  for (const c of merged) {
    // 게시일을 아는 코드에만 적용한다. 다른 수집기가 넣은 값은 건드리지 않는다.
    // 게임사가 이벤트에 직접 적은 종료일은 3년짜리도 있다(상시 쿠폰). 그건 그대로 믿는다.
    if (c.expiry && c.postedAt && c.expiryFrom !== 'event') {
      const gap = (Date.parse(c.expiry) - Date.parse(c.postedAt)) / 86400000;
      if (gap > MAX_VALID_DAYS) c.expiry = null;
    }
    if (!c.expiryFrom) delete c.expiryFrom;
    if (!c.tag) delete c.tag;
  }
  for (const c of merged) {
    if (c.expiry) c.status = c.expiry < today ? 'expired' : 'active';
    // 게임사가 종료일 없이 "진행 중"으로 걸어 둔 이벤트의 코드는 게시 후 14일 규칙을 안 탄다.
    // 이벤트가 내려가면 다음 수집에서 fresh 에 안 잡혀 expired 로 내려간다.
    else if (c.expiryFrom === 'event-open' && c.status === 'active') c.status = 'active';
    else if (isStale(c.postedAt, today)) c.status = 'expired';
  }

  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.firstSeen || '').localeCompare(a.firstSeen || '');
  });
  return merged;
}

/**
 * 라운지 하나를 훑는다.
 *
 * 1차: "쿠폰 / 선물 코드" 전용 게시판. 대부분의 게임이 여기에만 올린다.
 * 2차: 전용 게시판이 없는 게임 — 공지·이벤트 게시판에 섞어 올린다. 이때는
 *      제목에 쿠폰·선물코드가 들어간 글만 본다. 게시판 전체를 읽으면 잡음이 크다.
 *      원스토어·구글플레이 "할인 쿠폰" 글은 게임 리딤 코드가 아니라서 반드시 뺀다.
 */
// 공지·이벤트 말고도 "게임소식"(드래곤에어), "점검&업데이트"(검선귀환)에 코드를 올리는 게임이 있다(2026-09-22 실측).
// 유저 게시판·끝난 이벤트 게시판은 읽지 않는다.
const SECTION_RE = /이벤트|공지|혜택|소식|뉴스|업데이트|점검|안내|선물|event|notice|news|update/i;
const SECTION_SKIP = /종료|당첨|결과|인증|자유|질문|건의|버그|공략|팁|가입|홍보|토론|창작|팬아트|스크린샷|길드|연맹|모집|후기|기대평/;
const TITLE_RE = /쿠폰|교환\s*코드|선물\s*코드|코드\s*선물|기프트\s*코드|리딤|사전\s*(?:예약|등록)/;
const STORE_RE = /원스토어|구글\s*플레이|갤럭시\s*스토어|앱스토어|할인\s*쿠폰|충전/;
/**
 * 본문에 "쿠폰 코드: XXXX" 처럼 라벨 바로 뒤에 코드가 적혀 있는지.
 * 제목에 쿠폰이 없는 글도 이게 있으면 쿠폰 글로 본다 — 이터널 리턴 "보름달 특별 이벤트 및 패키지 출시 안내"
 * 안의 ERGIFTBOX, 엘트릭스 "추석 특별 이벤트 안내" 안의 HAPPYCHUSEOK 를 제목 필터 때문에 놓쳤다(2026-09-22).
 * 제목에 "원스토어"가 들어간 글도 이게 있으면 게임 코드다("[쿠폰] 원스토어 인기순위 TOP 3 기념" 의 PLTONETOP3).
 */
const BODY_LABEL_RE = /(?:쿠폰\s*(?:코드|번호)|교환\s*코드|선물\s*코드|기프트\s*코드|리딤\s*코드|CDK)[\s\u200b:：\-•·▶■]{0,20}[【「\[(]?\s*[A-Za-z0-9]{5,20}/i;
/** 코드 앞뒤 세 줄에 "할인 쿠폰"·"% 할인"이 있으면 웹상점·스토어 할인 코드다 — 게임 보상 코드가 아니다(드래곤 엠파이어 WEBSHOP26SEP). */
function nearDiscount(text, code) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(code));
  if (i < 0) return false;
  return /할인\s*쿠폰|%\s*할인|할인\s*코드/.test(lines.slice(Math.max(0, i - 3), i + 4).join(' '));
}

export async function collectOne(g) {
  const boardRes = await get(`${B1}/lounge/${g.loungeId}/board`);
  if (!boardRes) return { ...g, error: '보드 조회 실패' };

  const all = (boardRes.content.boardViews || [])
    .filter((v) => v.board).map((v) => v.board).filter((b) => !b.memberWriteBoard);

  const primary = all.filter((b) => BOARD_RE.test(b.boardName));
  // 전용 게시판이 있어도 공지·이벤트는 같이 본다. 전용 게시판을 만들어 두고
  // 정작 코드는 공지에 올리는 게임이 있다(이것이 삼국지다 — 쿠폰 모음 게시판 1건).
  const secondary = all.filter((b) => SECTION_RE.test(b.boardName) && !SECTION_SKIP.test(b.boardName) && !primary.includes(b)).slice(0, 8);
  const boards = [...primary, ...secondary];

  if (!boards.length) return { ...g, error: '쿠폰 보드 없음' };

  // 게임 이름의 영문 단어("LUNAR：에버소울"의 LUNAR)는 본문 머리에 늘 적혀 코드로 잡힌다.
  const nameWords = new Set(String(g.titleKo || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4));
  const codes = [];
  let howTo = '', image = null, total = 0, latest = null, sourceUrl = null, locked = false;
  const events = await eventIndex();
  const seenFeed = new Set();

  /** 이벤트 종료일을 만료일로. 종료일 없는 진행 중 이벤트는 상시 쿠폰으로 표시한다. */
  const applyEvent = (got, feedId) => {
    const ev = events.get(Number(feedId));
    if (!ev) return;
    for (const c of got) {
      if (c.expiry) continue;
      if (ev.end) { c.expiry = ev.end; c.expiryFrom = 'event'; }
      else if (ev.open) { c.expiryFrom = 'event-open'; }
    }
  };
  /** 같은 코드가 두 글에 있으면 만료 근거가 있는 쪽을 남긴다. */
  const addCode = (c) => {
    const i = codes.findIndex((x) => x.code.toUpperCase() === c.code.toUpperCase());
    if (i < 0) { codes.push(c); return; }
    if (!codes[i].expiry && !codes[i].expiryFrom && (c.expiry || c.expiryFrom)) codes[i] = c;
  };

  for (const b of boards) {
    const titleOnly = !primary.includes(b);
    if (b.memberAccessBoard) { locked = true; continue; }  // 가입 필요 — 본문 403
    const q = `offset=0&limit=30&order=NEW&buffFilteringYN=N&boardId=${b.boardId}`;
    const feed = await get(`${B1}/community/lounge/${g.loungeId}/feed?${q}`);
    await sleep(300);
    if (!feed || !feed.content.feeds?.length) { if (!titleOnly) locked = true; continue; }

    if (!titleOnly) total += feed.content.totalCount || 0;

    for (const item of feed.content.feeds) {
      if (item.user?.userRoleCode === 'common_user') continue;   // 유저 글 제외
      const title = item.feed.title || '';
      const text = bodyText(item.feed.contents);
      if (!text) continue;
      const labeled = BODY_LABEL_RE.test(text);
      if (titleOnly && !TITLE_RE.test(title) && !labeled) continue;
      if (titleOnly && (STORE_RE.test(title) || STORE_RE.test(text.slice(0, 400))) && !labeled) continue;
      const d = String(item.feed.createdDate || '');
      const iso = d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
      const got = parseCodes(text, iso).filter((c) => !nearDiscount(text, c.code) && !nameWords.has(c.code.toUpperCase()));
      seenFeed.add(Number(item.feed.feedId));
      if (!got.length) continue;
      if (titleOnly) total += 1;

      // 본문에 만료일이 없으면 게임사가 이벤트에 적어 둔 종료일을 쓴다.
      // "12/31까지" 같은 안내 없이 "이벤트 기간" 만 적는 게임이 많다.
      applyEvent(got, item.feed.feedId);

      if (!latest || (iso && iso > latest)) {
        latest = iso;
        sourceUrl = item.feedLink?.pc || null;
        if (!howTo) howTo = parseHowTo(text);
      }
      if (!image) image = item.feed.repImageUrl || item.lounge?.logoImageSquareUrl || null;
      // 사전예약 글의 코드는 "사전예약 보상"으로 표시한다 — 출시 후에도 쓰는 코드가 많다(소드 앤 프론티아 2027-06-30까지).
      if (PREREG_RE.test(ent(title))) for (const c of got) c.tag = '사전예약';
      for (const c of got) addCode(c);
    }
  }

  // 게시판의 최신 30건 밖으로 밀려난 진행 중 쿠폰 이벤트 — "따끈따끈 이벤트 소식"에 걸려 있는
  // 글은 feedId 로 직접 읽는다. 3년짜리 상시 쿠폰(론칭 기념 등)이 여기서 나온다.
  for (const [feedId, ev] of events) {
    if (ev.loungeId.toLowerCase() !== String(g.loungeId).toLowerCase()) continue;
    if (!EVENT_TITLE_RE.test(ev.title) || seenFeed.has(feedId)) continue;
    const res = await get(`${B1}/community/lounge/${g.loungeId}/feed/${feedId}`);
    await sleep(300);
    seenFeed.add(feedId);
    const item = res?.content;
    if (!item?.feed) { locked = locked || !res; continue; }
    if (item.user?.userRoleCode === 'common_user') continue;
    const text = bodyText(item.feed.contents);
    if (!text) continue;
    // 스토어 할인 이벤트는 거른다. 단 본문에 "쿠폰 코드: …" 가 있으면 게임 코드다.
    if ((STORE_RE.test(ev.title) || STORE_RE.test(text.slice(0, 400))) && !BODY_LABEL_RE.test(text)) continue;
    const d = String(item.feed.createdDate || '');
    const iso = d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
    const got = parseCodes(text, iso).filter((c) => !nearDiscount(text, c.code) && !nameWords.has(c.code.toUpperCase()));
    if (!got.length) continue;
    total += 1;
    applyEvent(got, feedId);
    if (!latest || (iso && iso > latest)) {
      latest = iso;
      sourceUrl = item.feedLink?.pc || `https://game.naver.com/lounge/${g.loungeId}/board/detail/${feedId}`;
      if (!howTo) howTo = parseHowTo(text);
    }
    if (!image) image = item.feed.repImageUrl || item.lounge?.logoImageSquareUrl || null;
    if (PREREG_RE.test(ev.title) || PREREG_RE.test(ent(item.feed.title))) for (const c of got) c.tag = '사전예약';
    for (const c of got) addCode(c);
  }

  if (!codes.length) return { ...g, error: locked ? '보드 잠김(가입 필요)' : '코드 없음', total };
  return { ...g, codes, howTo, image, total, latest, sourceUrl };
}

async function main() {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const list = loadLounges();
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

// discover-naver.mjs 가 collectOne 을 가져다 쓸 수 있도록, 직접 실행했을 때만 main 을 돈다.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
