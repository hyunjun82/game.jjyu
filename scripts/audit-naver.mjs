/**
 * 쿠폰 누락 자가 점검 — 사람이 매번 "놓친 거 없냐"고 물어 대조하던 일을 자동으로 한다.
 *
 * 하는 일 (최근 3일, KST)
 *   1) 공식 라운지 전체(약 2,300개)의 공식 게시판을 훑어 운영자 글만 모은다.
 *      수집기(collect-naver)는 게시판 이름·글 제목으로 거르기 때문에, 이름이 제각각인 게시판이나
 *      제목에 '쿠폰'이 없는 글의 코드를 놓친다(2026-09-22~28 수동 대조에서 매번 나옴).
 *   2) 그 글 본문을 수집기와 같은 파서(parseCodes)로 읽어 코드가 나오는데 사이트 데이터에 없으면
 *        - 이미 추적 중인 라운지 → 그 글 번호를 scripts/naver-extra-posts.json 에 적는다.
 *          collect-naver 가 이 목록의 글을 게시판·제목과 상관없이 직접 읽는다.
 *        - 추적하지 않던 라운지   → scripts/naver-lounges.json 에 라운지를 추가한다.
 *   3) 결과를 scripts/audit-report.json 에 남긴다(무엇을 찾아 무엇을 넣었는지).
 *
 * 파서가 못 읽는 새 표기는 여기서도 못 잡는다 — 그건 리포트의 "라벨만 보이는 글"로 남긴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadLounges, parseCodes, bodyText, todayISO } from './collect-naver.mjs';

const B1 = 'https://comm-api.game.naver.com/nng_main/v1';
const ROOT = path.resolve(import.meta.dirname, '..');
const GAMES_DIR = path.join(ROOT, 'data', 'games');
const CONF_EXTRA = path.join(ROOT, 'scripts', 'naver-lounges.json');
const EXTRA_POSTS = path.join(ROOT, 'scripts', 'naver-extra-posts.json');
const REPORT = path.join(ROOT, 'scripts', 'audit-report.json');
const DAYS = 3;
const KEEP_DAYS = 30;
const CONCURRENCY = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data && data.code === 200) return data;
      if (data && String(data.code || '').startsWith('4')) return null;   // 잠김 등
    } catch (e) { /* 재시도 */ }
    await sleep(800 * (i + 1));
  }
  return null;
}
const ent = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
const slugOf = (id) => String(id).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// 유저 게시판·끝난 게시판은 보지 않는다. 보드가 8개 이하면 전부 본다.
const USER_BOARD = /자유|질문|건의|버그|공략|팁|가입|홍보|토론|창작|팬아트|스크린샷|길드|연맹|모집|후기|기대평|인증|당첨|결과|종료/;
const LABEL_ONLY = /(?:쿠폰\s*(?:코드|번호)|교환\s*코드|선물\s*코드|기프트\s*코드|리딤\s*코드)/;

function isoDaysAgo(n) {
  const d = new Date(Date.now() + 9 * 3600e3 - n * 86400e3);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function loadJSON(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } }

async function main() {
  const today = todayISO();
  const from = isoDaysAgo(DAYS - 1);
  const tracked = new Map(loadLounges().map((g) => [String(g.loungeId).toLowerCase(), g]));
  // 사이트에 이미 있는 코드: 라운지별
  const codesBySlug = new Map();
  for (const f of fs.readdirSync(GAMES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const g = loadJSON(path.join(GAMES_DIR, f), null);
    if (g) codesBySlug.set(g.slug, new Set((g.codes || []).map((c) => c.code.toUpperCase())));
  }
  const official = (await get(`${B1}/lounge/official`))?.content?.officialLounges || [];
  if (official.length < 1000) { console.log(`[audit] 공식 라운지 목록 응답 이상(${official.length}) — 건너뜀`); return; }

  const extra = loadJSON(EXTRA_POSTS, { _설명: 'audit-naver.mjs 가 쓴다. 수집기가 게시판·제목 조건과 상관없이 직접 읽을 글.', posts: {} });
  const conf = loadJSON(CONF_EXTRA, { lounges: [] });
  const report = { generatedAt: new Date().toISOString(), window: `${from}~${isoDaysAgo(0)}`, lounges: official.length, posts: 0, couponPosts: 0, fixedTracked: [], addedLounges: [], labelOnly: [] };
  const newLounges = new Map();

  let i = 0;
  async function worker() {
    while (i < official.length) {
      const L = official[i++];
      const id = String(L.loungeId);
      const b = await get(`${B1}/lounge/${id}/board`);
      if (!b) continue;
      const boards = (b.content.boardViews || []).filter((v) => v.board).map((v) => v.board).filter((x) => !x.memberAccessBoard);
      const pick = boards.length <= 8 ? boards : boards.filter((x) => !USER_BOARD.test(x.boardName || ''));
      const seen = new Set();
      for (const bd of pick.slice(0, 16)) {
        const f = await get(`${B1}/community/lounge/${id}/feed?offset=0&limit=30&order=NEW&buffFilteringYN=N&boardId=${bd.boardId}`);
        await sleep(100);
        for (const it of f?.content?.feeds || []) {
          const d = String(it.feed.createdDate || '').slice(0, 8);
          if (d < from || it.user?.userRoleCode === 'common_user' || seen.has(it.feed.feedId)) continue;
          seen.add(it.feed.feedId);
          report.posts++;
          const text = bodyText(it.feed.contents);
          if (!text) continue;
          const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          const nameWords = new Set(String(L.loungeName || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4));
          const got = parseCodes(text, iso).filter((c) => !nameWords.has(c.code.toUpperCase()));
          if (!got.length) {
            if (LABEL_ONLY.test(text)) report.labelOnly.push(`${ent(L.loungeName)} | ${iso} | ${ent(it.feed.title).slice(0, 50)}`);
            continue;
          }
          report.couponPosts++;
          const g = tracked.get(id.toLowerCase());
          if (g) {
            const have = codesBySlug.get(g.slug) || new Set();
            const missing = got.filter((c) => !have.has(c.code.toUpperCase()));
            if (!missing.length) continue;
            const list = extra.posts[id] || (extra.posts[id] = []);
            if (!list.some((x) => x.feedId === it.feed.feedId)) list.push({ feedId: it.feed.feedId, at: today, title: ent(it.feed.title).slice(0, 60) });
            report.fixedTracked.push(`${g.titleKo} | ${missing.map((c) => c.code).join(', ')} | ${ent(it.feed.title).slice(0, 40)}`);
          } else {
            if (!newLounges.has(id)) newLounges.set(id, { name: ent(L.loungeName), codes: new Set(), feeds: [] });
            const n = newLounges.get(id);
            got.forEach((c) => n.codes.add(c.code));
            n.feeds.push({ feedId: it.feed.feedId, at: today, title: ent(it.feed.title).slice(0, 60) });
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 추적 안 하던 라운지 추가 — 글 번호도 같이 적어 두면 게시판 조건과 상관없이 첫 수집에서 코드가 들어온다.
  const known = new Set(conf.lounges.map((g) => String(g.loungeId).toLowerCase()));
  const existingSlugs = new Set(fs.readdirSync(GAMES_DIR).map((f) => f.replace(/\.json$/, '')));
  for (const [id, n] of newLounges) {
    if (known.has(id.toLowerCase())) continue;
    let slug = slugOf(id);
    if (existingSlugs.has(slug) && !tracked.has(id.toLowerCase())) slug = `${slug}-kr`;
    conf.lounges.push({ slug, loungeId: id, titleKo: n.name, titleEn: id, auto: today, note: '자가 점검(audit-naver)에서 발견' });
    extra.posts[id] = [...(extra.posts[id] || []), ...n.feeds];
    report.addedLounges.push(`${n.name} (${id}) → /${slug}/ | ${[...n.codes].join(', ')}`);
  }
  // 오래된 글 번호는 지운다
  const cutoff = new Date(Date.parse(today) - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  for (const [id, list] of Object.entries(extra.posts)) {
    extra.posts[id] = list.filter((x) => x.at >= cutoff);
    if (!extra.posts[id].length) delete extra.posts[id];
  }
  fs.writeFileSync(EXTRA_POSTS, JSON.stringify(extra, null, 1) + '\n');
  if (report.addedLounges.length) fs.writeFileSync(CONF_EXTRA, JSON.stringify(conf, null, 2) + '\n');
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1) + '\n');

  console.log(`[audit] 라운지 ${official.length} · 운영자 글 ${report.posts} · 코드 있는 글 ${report.couponPosts}`);
  console.log(`[audit] 추적 라운지에서 놓친 글 ${report.fixedTracked.length} · 새 라운지 ${report.addedLounges.length} · 파서가 못 읽은 라벨 글 ${report.labelOnly.length}`);
  for (const s of report.fixedTracked) console.log(`  + ${s}`);
  for (const s of report.addedLounges) console.log(`  ++ ${s}`);
  console.log(`AUDIT_FIXED=${report.fixedTracked.length + report.addedLounges.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
