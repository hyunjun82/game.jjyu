/**
 * 게임·쿠폰 데이터 로더.
 *
 * data/games/*.json 을 읽어 페이지가 쓰기 좋은 모양으로 바꿔준다.
 * 빌드 타임에만 도는 코드라 동기 IO 로 충분하다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KO_NAMES } from './ko-names.js';

const GAMES_DIR = path.join(process.cwd(), 'data', 'games');
const HIDDEN_FILE = path.join(process.cwd(), 'data', 'hidden.json');

/**
 * 홈·목록에서 뺄 게임.
 * 페이지 자체는 지우지 않는다 — 지우면 404가 나고, 검색으로 들어온 사람이 빈손으로 돌아간다.
 * 서비스 종료작은 오히려 "끝났다"고 알려주는 것이 답이 된다.
 */
const HIDDEN = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8'));
    return new Map((raw.hidden || []).map((h) => [h.slug, h]));
  } catch (e) { return new Map(); }
})();

/**
 * 코드가 아닌 것. 블로그·웹페이지에서 긁을 때 이미지 id 같은 16진수 토큰이 딸려 온다
 * (l6ff2740, aa5916c3 …). 만료일도 게시일도 없으면 근거가 없으니 코드로 치지 않는다.
 * 날짜가 붙어 있으면 진짜 16진수 코드를 쓰는 게임일 수 있으므로 살려 둔다.
 */
function looksLikeJunk(c) {
  if (c.expiry || c.postedAt) return false;
  return /^[0-9a-f]{8}$/i.test(c.code) || /^[a-z][0-9a-f]{7}$/i.test(c.code);
}

function normalize(raw) {
  const hidden = HIDDEN.get(raw.slug) || null;
  const titleKo = raw.titleKo || KO_NAMES[raw.slug] || null;
  const codes = (raw.codes || []).filter((c) => !looksLikeJunk(c));
  // 수집이 한 번이라도 건너뛰면 만료된 코드가 active 로 남는다.
  // "오늘 쓸 수 있는 것만" 이 사실이려면 표시 단계에서도 한 번 더 거른다.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const isDead = (c) => c.status !== 'active' || (c.expiry && c.expiry < today);
  // "사용 가능"이라 부르려면 근거가 있어야 한다 — 만료일, 게시일, 출처 URL 중 하나.
  // 셋 다 없는 코드는 언제 나왔는지도 모르는 것이라, 살았다고도 죽었다고도 말할 수 없다.
  // 지우지는 않는다. 페이지 아래 "확인 안 된 쿠폰"으로 따로 내린다.
  const isVerified = (c) => !!(c.expiry || c.postedAt || c.sourceUrl);
  // 서비스가 끝난 게임의 코드는 전부 만료로 내린다 — 못 쓰는 코드를 "사용 가능"이라 할 수 없다
  const ended = hidden && hidden.type === 'ended';
  const alive = ended ? [] : codes.filter((c) => !isDead(c));
  const active = alive.filter(isVerified);
  const unverified = alive.filter((c) => !isVerified(c));
  const expired = ended ? codes : codes.filter((c) => isDead(c));
  const source = raw.source || 'pocketgamer';
  // 노출 순서를 정하는 등급.
  //   0 = 한국 공식 출처(네이버 라운지·검색) — 지금도 한국어로 쿠폰이 올라오는 게임
  //   1 = 한글 이름이 붙은 게임 — 한국에서 검색되는 이름이 있다
  //   2 = 영문 이름뿐 — 한국 사람이 이 이름으로 검색할 일이 없다
  const tier = (source === 'naver-lounge' || source === 'naver-search') ? 0 : (titleKo ? 1 : 2);
  // 가장 최근에 새로 들어온 코드 — 같은 등급 안에서 최신 발행을 앞세운다
  const newest = codes.reduce((acc, c) => (c.firstSeen && c.firstSeen > acc ? c.firstSeen : acc), '');

  return {
    slug: raw.slug,
    image: `/g/${raw.slug}.webp`,
    source,
    tier,
    newest,
    titleEn: raw.titleEn || raw.slug,
    titleKo,
    // 한글명이 있으면 한글로, 없으면 영문 그대로 노출한다
    name: titleKo || raw.titleEn || raw.slug,
    updatedAt: raw.updatedAt || null,
    hidden: !!hidden,
    hiddenType: hidden ? hidden.type : null,
    hiddenNote: hidden ? hidden.note : null,
    active,
    unverified,
    expired,
    total: codes.length,
  };
}

export function getAllGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs
    .readdirSync(GAMES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => normalize(JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'))))
    .filter((g) => g.total > 0)
    .sort((a, b) => {
      // 한국 게임을 먼저 보여준다. 영문 이름뿐인 게임은 한국 사람이 그 이름으로 검색하지 않는다.
      if (a.tier !== b.tier) return a.tier - b.tier;
      // 쓸 수 있는 쿠폰이 있는 게임이 없는 게임보다 앞
      const aLive = a.active.length > 0, bLive = b.active.length > 0;
      if (aLive !== bLive) return aLive ? -1 : 1;
      // 최근에 쿠폰이 올라온 순 — "지금 살아 있는 게임"이 위로 온다
      if (a.newest !== b.newest) return (b.newest || '').localeCompare(a.newest || '');
      if (b.active.length !== a.active.length) return b.active.length - a.active.length;
      return a.name.localeCompare(b.name, 'ko');
    });
}

/**
 * 홈·전체목록에 실을 게임. 숨김 목록은 뺀다.
 * 주의: 페이지 생성(generateStaticParams)에는 절대 쓰지 말 것 — 쓰면 404가 난다.
 */
export function getListedGames() {
  return getAllGames().filter((g) => !g.hidden);
}

export function getGame(slug) {
  const file = path.join(GAMES_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/**
 * 홈 상단에 띄울 게임.
 * 한국 공식 출처(등급 0)에서 최근에 쿠폰이 올라온 게임만 올린다.
 * 영문 게임을 코드 수로 줄 세우면 타임 프린세스(418개) 같은 게 맨 위에 오는데,
 * 한국 사람이 그 이름으로 검색할 일이 없어서 첫 화면을 낭비하는 셈이 된다.
 */
export function getRecentlyUpdated(limit = 12) {
  const pick = (tierMax) => getListedGames()
    .filter((g) => g.tier <= tierMax && g.active.length > 0 && g.newest)
    .sort((a, b) => (b.newest || '').localeCompare(a.newest || '')
      || b.active.length - a.active.length);
  // 한국 출처만으로 자리가 안 차면 한글명 게임까지 넓힌다
  const kor = pick(0);
  return (kor.length >= limit ? kor : [...kor, ...pick(1).filter((g) => g.tier === 1)]).slice(0, limit);
}

export function totals() {
  const games = getListedGames();
  return {
    games: games.length,
    active: games.reduce((n, g) => n + g.active.length, 0),
    all: games.reduce((n, g) => n + g.total, 0),
  };
}

export const KST = 'Asia/Seoul';

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: 'long', day: 'numeric',
  }).format(d);
}
