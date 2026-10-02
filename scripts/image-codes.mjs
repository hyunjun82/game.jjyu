/**
 * 이미지 속 쿠폰 코드 — 자가 점검이 골라 둔 "쿠폰 글인데 본문 글자에 코드가 없고 이미지가 있는 글"을
 * Claude 가 직접 보고 읽게 한다(2026-10-02 도입).
 *
 * 왜 OCR 이 아니라 Claude 인가
 *   tesseract 는 DoE: 던전앤엑자일 배너의 DOE1STYEAR 를 DOEASTYEAR 로 읽었다. 틀린 코드는 올리면 안 된다.
 *
 * 흐름 (audit.yml)
 *   1) node scripts/image-codes.mjs prepare  — 이미지를 내려받고 /tmp/imgjobs/manifest.json 을 쓴다
 *   2) claude -p …                            — Claude 가 manifest 의 이미지를 읽고 /tmp/imgjobs/result.json 을 쓴다
 *   3) node scripts/image-codes.mjs apply    — 결과를 scripts/image-codes.json 에 쌓는다
 *   collect-naver.mjs 가 image-codes.json 의 코드를 그 라운지 수집 때 함께 넣는다.
 *
 * 원칙
 *   - 글자 하나라도 확실하지 않으면 그 코드는 버린다(프롬프트에서 요구, 여기서 형식도 다시 거른다).
 *   - 한 번 본 글은 다시 보내지 않는다(사용 한도 절약). 30일 지난 기록은 지운다.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'audit-report.json');
const STORE = path.join(ROOT, 'scripts', 'image-codes.json');
const JOB = '/tmp/imgjobs';
const KEEP_DAYS = 30;
const MAX_POSTS = 15;       // 한 번에 Claude 에게 보낼 글 수
const MAX_IMAGES = 4;       // 글 하나당 이미지 수

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch (e) { return { _설명: '이미지 속 쿠폰 코드. scripts/image-codes.mjs 가 쓴다.', done: {}, lounges: {} }; }
}

async function prepare() {
  let report;
  try { report = JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch (e) { report = {}; }
  const store = load();
  const todo = (report.imageOnly || []).filter((p) => !store.done[p.feedId]).slice(0, MAX_POSTS);
  fs.rmSync(JOB, { recursive: true, force: true });
  fs.mkdirSync(JOB, { recursive: true });
  const posts = [];
  for (const p of todo) {
    const files = [];
    for (const [i, url] of p.images.slice(0, MAX_IMAGES).entries()) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 5000) continue;                          // 스티커·아이콘
        const ext = /\.png/i.test(url) ? 'png' : /\.gif/i.test(url) ? 'gif' : /\.webp/i.test(url) ? 'webp' : 'jpg';
        const f = path.join(JOB, `${p.feedId}_${i}.${ext}`);
        fs.writeFileSync(f, buf);
        files.push(f);
      } catch (e) { /* 실패한 이미지는 건너뛴다 */ }
    }
    if (files.length) posts.push({ feedId: p.feedId, loungeId: p.loungeId, game: p.game, date: p.date, title: p.title, images: files });
  }
  fs.writeFileSync(path.join(JOB, 'manifest.json'), JSON.stringify({ posts }, null, 1));
  console.log(`[image] 볼 글 ${posts.length}개 (이미지 ${posts.reduce((n, p) => n + p.images.length, 0)}장)`);
  console.log(`IMAGE_POSTS=${posts.length}`);
}

function apply() {
  const store = load();
  const today = todayISO();
  let manifest = { posts: [] }, result = [];
  try { manifest = JSON.parse(fs.readFileSync(path.join(JOB, 'manifest.json'), 'utf8')); } catch (e) { /* 없음 */ }
  try { result = JSON.parse(fs.readFileSync(path.join(JOB, 'result.json'), 'utf8')); } catch (e) { console.log('[image] result.json 없음 — 이번엔 반영 안 함'); return; }
  const byFeed = new Map(manifest.posts.map((p) => [String(p.feedId), p]));
  let added = 0;
  for (const r of Array.isArray(result) ? result : []) {
    const p = byFeed.get(String(r.feedId));
    if (!p) continue;
    for (const c of r.codes || []) {
      const code = String(c.code || '').trim();
      // 코드 형식 재확인: 영문·숫자(하이픈·밑줄 허용) 4~30자, 영문 포함
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{3,29}$/.test(code) || !/[A-Za-z]/.test(code)) continue;
      const expiry = /^\d{4}-\d{2}-\d{2}$/.test(c.expiry || '') && c.expiry >= p.date ? c.expiry : null;
      const list = store.lounges[p.loungeId] || (store.lounges[p.loungeId] = []);
      if (list.some((x) => x.code.toUpperCase() === code.toUpperCase())) continue;
      list.push({ code, expiry, postedAt: p.date, feedId: p.feedId, at: today,
        sourceUrl: `https://game.naver.com/lounge/${p.loungeId}/board/detail/${p.feedId}` });
      added++;
      console.log(`  + ${p.game}: ${code}${expiry ? ` (~${expiry})` : ''} · ${p.title}`);
    }
  }
  // 결과를 받은 글만 "봤음"으로 적는다 — Claude 가 실패하면 다음 점검에서 다시 본다.
  for (const r of Array.isArray(result) ? result : []) if (byFeed.has(String(r.feedId))) store.done[r.feedId] = today;
  const cutoff = new Date(Date.parse(today) - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(store.done)) if (v < cutoff) delete store.done[k];
  for (const [id, list] of Object.entries(store.lounges)) {
    store.lounges[id] = list.filter((x) => x.at >= cutoff);
    if (!store.lounges[id].length) delete store.lounges[id];
  }
  fs.writeFileSync(STORE, JSON.stringify(store, null, 1) + '\n');
  console.log(`[image] 이미지에서 읽은 코드 ${added}개 반영`);
}

const mode = process.argv[2];
if (mode === 'prepare') await prepare();
else if (mode === 'apply') apply();
else { console.error('사용법: node scripts/image-codes.mjs prepare|apply'); process.exit(1); }
