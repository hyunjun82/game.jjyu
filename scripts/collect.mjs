/**
 * 게임 쿠폰 수집기 — Pocket Gamer 코드 허브에서 게임별 쿠폰을 긁어 data/games/*.json 으로 떨군다.
 *
 * 왜 Pocket Gamer 인가
 *   robots.txt 가 Allow: / 이고, /codes/index.rss 로 "어떤 게임이 언제 갱신됐는지"가 바로 나온다.
 *   게임마다 페이지 구조가 같아서 파서 하나로 443개가 전부 뚫린다(2026-08-31 실측).
 *
 * 수집 원칙
 *   1) 코드는 절대 지어내지 않는다. 소스에 없는 문자열은 버린다.
 *   2) 만료일이 지난 코드는 지우지 않고 expired 로 내린다 — "만료 코드"도 검색 수요가 있다.
 *   3) 소스가 코드를 내리면 우리도 내린다. 단 하루는 유예를 준다(소스 일시 오류 방어).
 */
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const BASE = 'https://www.pocketgamer.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const GAMES_DIR = path.join(ROOT, 'data', 'games');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch (e) { /* 재시도 */ }
    await sleep(800 * (i + 1));
  }
  return null;
}

/** "November 30th" 같은 영문 만료 표기를 ISO 날짜로. 연도가 없으면 가장 가까운 미래로 잡는다. */
const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
function parseExpiry(text) {
  if (!text) return null;
  const m = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const now = new Date();
  let year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  if (!m[3]) {
    const guess = Date.UTC(year, mon - 1, day);
    if (guess < now.getTime() - 86400000 * 30) year += 1;
  }
  const d = new Date(Date.UTC(year, mon - 1, day, 23, 59, 59));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/** 코드처럼 생겼는지. 영문 단어 나열이나 문장은 걸러낸다. */
function isSaneCode(c) {
  if (!c) return false;
  if (c.length < 4 || c.length > 24) return false;
  if (!/^[A-Za-z0-9_]+$/.test(c)) return false;
  if (/^(the|and|for|you|with|this|that|from|code|codes|here|new|all|get|use|free)$/i.test(c)) return false;
  if (/^\d+$/.test(c) && c.length < 6) return false;  // 단순 숫자
  return true;
}

/** 게임 코드 페이지 하나에서 { code, reward, expiry } 목록을 뽑는다. */
function parseCodes(html) {
  const out = [];
  const seen = new Set();
  const lis = html.match(/<li[^>]*>([\s\S]*?)<\/li>/g) || [];
  for (const raw of lis) {
    const text = stripTags(raw);
    // "CODE - 보상 설명" / "CODE — 보상" / "CODE: 보상"
    const m = text.match(/^([A-Za-z0-9_]{4,24})\s*[-–—:]\s*(.+)$/);
    if (!m) continue;
    const code = m[1];
    if (!isSaneCode(code)) continue;
    if (seen.has(code.toUpperCase())) continue;
    let reward = m[2].trim();
    const expiry = parseExpiry(reward);
    // 보상 문구에서 만료 안내는 떼어낸다
    reward = reward.replace(/\(?\s*valid until[^)]*\)?/i, '').replace(/\(new!?\)/i, '').replace(/\s{2,}/g, ' ').trim();
    if (/^(rewards?|free rewards?)$/i.test(reward)) reward = '';
    seen.add(code.toUpperCase());
    out.push({ code, reward, expiry });
  }
  return out;
}

/** 페이지 제목에서 게임 영문명을 뽑는다. */
function parseTitle(html) {
  const t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  let s = stripTags(t);
  // "Acecraft codes - Free diamonds ... | Pocket Gamer" → "Acecraft"
  s = s.split('|')[0];
  s = s.replace(/\s+(gift\s+codes|redeem\s+codes|codes)\b[\s\S]*$/i, '');
  s = s.replace(/[\s\-–—:]+$/, '').trim();
  return s;
}

async function collectOne(pathname) {
  const slug = pathname.replace(/^\//, '').split('/')[0];
  const html = await get(BASE + pathname);
  if (!html) return null;
  const codes = parseCodes(html);
  if (!codes.length) return null;
  return { slug, sourcePath: pathname, titleEn: parseTitle(html), codes };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** 기존 파일과 병합 — 새 코드는 firstSeen 을 남기고, 사라진 코드는 하루 유예 후 만료 처리. */
function merge(prev, fresh) {
  const today = todayISO();
  const prevByCode = new Map((prev?.codes || []).map((c) => [c.code.toUpperCase(), c]));
  const freshCodes = new Set(fresh.codes.map((c) => c.code.toUpperCase()));
  const merged = [];

  for (const c of fresh.codes) {
    const old = prevByCode.get(c.code.toUpperCase());
    merged.push({
      code: c.code,
      reward: c.reward || old?.reward || '',
      expiry: c.expiry || old?.expiry || null,
      firstSeen: old?.firstSeen || today,
      lastSeen: today,
      status: 'active',
    });
  }
  // 소스에서 사라진 코드
  for (const [, old] of prevByCode) {
    if (freshCodes.has(old.code.toUpperCase())) continue;
    const gone = old.lastSeen && old.lastSeen !== today;
    merged.push({ ...old, status: gone ? 'expired' : old.status || 'active' });
  }
  // 만료일이 지났으면 무조건 expired
  for (const c of merged) {
    if (c.expiry && c.expiry < today) c.status = 'expired';
  }
  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.firstSeen || '').localeCompare(a.firstSeen || '');
  });
  return merged;
}

async function main() {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const listFile = path.join(ROOT, 'data', '_paths.txt');
  let paths = fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

  const only = process.argv.find((a) => a.startsWith('--only='));
  if (only) {
    const n = Number(only.split('=')[1]);
    paths = paths.slice(0, n);
  }

  console.log(`[collect] ${paths.length}개 게임 수집 시작`);
  let ok = 0, skip = 0, changed = 0;
  const CONCURRENCY = 6;

  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((p) => collectOne(p).catch(() => null)));
    for (const r of results) {
      if (!r) { skip++; continue; }
      const file = path.join(GAMES_DIR, `${r.slug}.json`);
      const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      const codes = merge(prev, r);
      const next = {
        slug: r.slug,
        titleEn: r.titleEn,
        titleKo: prev?.titleKo || null,
        sourcePath: r.sourcePath,
        updatedAt: new Date().toISOString(),
        codes,
      };
      const before = prev ? JSON.stringify(prev.codes) : '';
      if (before !== JSON.stringify(codes)) changed++;
      fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
      ok++;
    }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, paths.length)}/${paths.length}`);
    await sleep(250);
  }
  console.log(`\n[collect] 완료 — 성공 ${ok} · 건너뜀 ${skip} · 변경 ${changed}`);
  console.log(`COLLECT_CHANGED=${changed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
