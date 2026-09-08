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

function normalize(raw) {
  const hidden = HIDDEN.get(raw.slug) || null;
  const titleKo = raw.titleKo || KO_NAMES[raw.slug] || null;
  const codes = raw.codes || [];
  // 수집이 한 번이라도 건너뛰면 만료된 코드가 active 로 남는다.
  // "오늘 쓸 수 있는 것만" 이 사실이려면 표시 단계에서도 한 번 더 거른다.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const isDead = (c) => c.status !== 'active' || (c.expiry && c.expiry < today);
  // 서비스가 끝난 게임의 코드는 전부 만료로 내린다 — 못 쓰는 코드를 "사용 가능"이라 할 수 없다
  const ended = hidden && hidden.type === 'ended';
  const active = ended ? [] : codes.filter((c) => !isDead(c));
  const expired = ended ? codes : codes.filter((c) => isDead(c));
  return {
    slug: raw.slug,
    image: `/g/${raw.slug}.webp`,
    titleEn: raw.titleEn || raw.slug,
    titleKo,
    // 한글명이 있으면 한글로, 없으면 영문 그대로 노출한다
    name: titleKo || raw.titleEn || raw.slug,
    updatedAt: raw.updatedAt || null,
    hidden: !!hidden,
    hiddenType: hidden ? hidden.type : null,
    hiddenNote: hidden ? hidden.note : null,
    active,
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
      // 사용 가능한 쿠폰이 많은 게임을 앞으로
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

/** 최근에 새 쿠폰이 붙은 게임 — 홈 상단 "새로 올라온 쿠폰"용 */
export function getRecentlyUpdated(limit = 12) {
  const games = getListedGames();
  const withNew = games
    .map((g) => {
      const newest = g.active.reduce((acc, c) => (c.firstSeen && c.firstSeen > acc ? c.firstSeen : acc), '');
      return { ...g, newest };
    })
    .filter((g) => g.newest);
  withNew.sort((a, b) => b.newest.localeCompare(a.newest));
  return withNew.slice(0, limit);
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
