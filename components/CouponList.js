'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 쿠폰 목록.
 *
 * 앞의 FREE_COUNT 개는 그냥 보여준다 — 처음부터 전부 가리면 사용자가 바로 이탈한다.
 * 나머지는 흐림 처리하고 [보기]를 누르면 카운트다운 뒤 하나씩 열린다.
 * 그 몇 초가 오퍼월·광고가 뜰 시간을 만들어 준다.
 */
const FREE_COUNT = 2;
const REVEAL_SECONDS = 5;

function CodeRow({ item, locked, onReveal, revealing, secondsLeft, revealed }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = item.code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* 무시 */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [item.code]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hidden = locked && !revealed;

  return (
    <li className={`code-row${hidden ? ' is-locked' : ''}`}>
      <div className="code-main">
        <code className={`code-text${hidden ? ' is-blurred' : ''}`}>
          {hidden ? 'XXXXXXXX' : item.code}
        </code>
        {item.reward ? <p className="code-reward">{item.reward}</p> : null}
      </div>

      <div className="code-actions">
        {item.expiry ? <span className="code-expiry">~{item.expiry.slice(5).replace('-', '.')}</span> : null}
        {hidden ? (
          <button type="button" className="btn btn-reveal" onClick={onReveal} disabled={revealing}>
            {revealing ? `${secondsLeft}초` : '보기'}
          </button>
        ) : (
          <button type="button" className={`btn btn-copy${copied ? ' is-done' : ''}`} onClick={copy}>
            {copied ? '복사됨' : '복사'}
          </button>
        )}
      </div>
    </li>
  );
}

export default function CouponList({ codes }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const [pending, setPending] = useState(null);
  const [left, setLeft] = useState(REVEAL_SECONDS);

  useEffect(() => {
    if (pending === null) return undefined;
    setLeft(REVEAL_SECONDS);
    const started = Date.now();
    const id = setInterval(() => {
      const passed = Math.floor((Date.now() - started) / 1000);
      const remain = REVEAL_SECONDS - passed;
      if (remain <= 0) {
        clearInterval(id);
        setRevealed((prev) => {
          const next = new Set(prev);
          next.add(pending);
          return next;
        });
        setPending(null);
      } else {
        setLeft(remain);
      }
    }, 250);
    return () => clearInterval(id);
  }, [pending]);

  if (!codes.length) return null;

  return (
    <ol className="code-list">
      {codes.map((item, i) => (
        <CodeRow
          key={item.code}
          item={item}
          locked={i >= FREE_COUNT}
          revealed={revealed.has(item.code)}
          revealing={pending === item.code}
          secondsLeft={left}
          onReveal={() => { if (pending === null) setPending(item.code); }}
        />
      ))}
    </ol>
  );
}
