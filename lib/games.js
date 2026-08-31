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

function normalize(raw) {
  const titleKo = raw.titleKo || KO_NAMES[raw.slug] || null;
  const codes = raw.codes || [];
  const active = codes.filter((c) => c.status === 'active');
  const expired = codes.filter((c) => c.status !== 'active');
  return {
    slug: raw.slug,
    titleEn: raw.titleEn || raw.slug,
    titleKo,
    // 한글명이 있으면 한글로, 없으면 영문 그대로 노출한다
    name: titleKo || raw.titleEn || raw.slug,
    updatedAt: raw.updatedAt || null,
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

export function getGame(slug) {
  const file = path.join(GAMES_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** 최근에 새 쿠폰이 붙은 게임 — 홈 상단 "새로 올라온 쿠폰"용 */
export function getRecentlyUpdated(limit = 12) {
  const games = getAllGames();
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
  const games = getAllGames();
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
