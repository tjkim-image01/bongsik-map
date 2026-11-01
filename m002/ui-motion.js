// 화면 정리 버튼(2026-11-02 사용자: "모바일일 경우 유아이 사라지는 버튼 하나 추가 해줘.. 나타났다 사라졌다 하도록 해줘.. 사라질땐 동적으로 사라지도록해줘").
// 숨기기 자체는 main.js toggleUI(H 키·👁 버튼·body.ui-hidden)가 하고, 여기서는 그 위에 두 가지를 더한다.
// 1) 움직임: 숨길 때 각 UI 덩어리가 자기와 가장 가까운 화면 가장자리로 흐려지며 빠져나가고, 누른 자리에서 가까운 것부터 물결처럼 차례로 움직인다.
//    다시 보일 때는 같은 길로 돌아온다. 위치는 숨기는 순간의 화면 배치로 계산한다(화면 크기·열린 패널이 달라도 맞게).
// 2) 모바일(폭 900px 이하나 터치 화면): 오른쪽 가운데에 늘 떠 있는 둥근 버튼 하나로 숨기기/보이기를 오간다(위쪽 👁·복원 버튼 대신).
const PARTS = ['.topbar', '.views', '.location', '.bottom-bar', '.navigation', '.chat-toggle', '.tv-toggle', '.share-toggle', '.presence', '.dance',
  '.avatar-actions', '.chat-panel', '.tv-panel', '.share-panel', '.stage-notice', '.hint', '.voice-ui', '.weather-btn', '.weather-panel', '.gallery-bar'];
const OUT = .42, WAVE = .2;   // 한 덩어리가 빠지는 시간, 첫 덩어리와 마지막 덩어리 사이 시차(초)

const style = document.createElement('style');
const list = (prefix) => PARTS.map(p => `${prefix} ${p}`).join(',');
style.textContent = `
${list('body.ui-hidden')}{translate:var(--ui-dx,0) var(--ui-dy,0);scale:.82;filter:blur(7px)}
${list('body.ui-hidden.ui-moving')}{transition:translate ${OUT}s cubic-bezier(.45,0,.75,.25) var(--ui-delay,0s),scale ${OUT}s cubic-bezier(.45,0,.75,.25) var(--ui-delay,0s),filter ${OUT}s ease var(--ui-delay,0s),opacity ${OUT * .8}s ease var(--ui-delay,0s),visibility 0s linear calc(var(--ui-delay,0s) + ${OUT}s)!important}
${list('body.ui-moving:not(.ui-hidden)')}{transition:translate .55s cubic-bezier(.16,1.25,.4,1) var(--ui-delay,0s),scale .55s cubic-bezier(.16,1.25,.4,1) var(--ui-delay,0s),filter .45s ease var(--ui-delay,0s),opacity .35s ease var(--ui-delay,0s),visibility 0s linear var(--ui-delay,0s)!important}
body.ui-hidden .voice-ui,body.ui-hidden .weather-btn,body.ui-hidden .weather-panel,body.ui-hidden .gallery-bar{opacity:0;visibility:hidden;pointer-events:none}
.ui-fab{display:none;position:absolute;right:14px;top:50%;translate:0 -50%;z-index:9999;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(18,28,34,.55);color:#fffaf1;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);place-items:center;padding:0;touch-action:manipulation;transition:background .25s,opacity .25s,scale .2s}
.ui-fab svg{width:22px;height:22px;transition:rotate .5s cubic-bezier(.16,1.25,.4,1),scale .5s cubic-bezier(.16,1.25,.4,1)}
.ui-fab:active{scale:.9}
.ui-fab::after{content:"";position:absolute;inset:-1px;border-radius:50%;border:2px solid var(--accent,#e4c99b);opacity:0;pointer-events:none}
.ui-fab.pulse::after{animation:ui-fab-ring .6s ease-out}
@keyframes ui-fab-ring{from{opacity:.9;scale:1}to{opacity:0;scale:1.9}}
body.ui-hidden .ui-fab{background:rgba(18,28,34,.3);opacity:.6}
body.ui-hidden .ui-fab svg{rotate:180deg}
.ui-fab .eye-off{display:none}body.ui-hidden .ui-fab .eye-on{display:none}body.ui-hidden .ui-fab .eye-off{display:inline}
@media (max-width:900px),(pointer:coarse){.ui-fab{display:grid}.ui-restore-btn{display:none!important}#ui-toggle{display:none}}
`;
document.head.append(style);

const fab = document.createElement('button');
fab.className = 'ui-fab'; fab.type = 'button';
fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<g class="eye-on"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g>'
  + '<g class="eye-off"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></g></svg>';
(document.getElementById('experience') || document.body).append(fab);

let origin = null;   // 물결이 시작하는 자리(마지막으로 누른 곳)
addEventListener('pointerdown', (e) => { origin = { x: e.clientX, y: e.clientY }; }, { capture: true });

// 방향·시차는 숨김 클래스가 붙기 **전에** 정해야 한다. 붙은 뒤에 재면 이미 옮겨진 자리를 재서 방향이 틀리고(2026-11-02 검수: 가장자리로 순간이동 후
// 안쪽으로 미끄러짐), 그 순간 main.js의 0.25초 흐림이 먼저 시작돼 시차가 사라졌다. 그래서 H 키·👁·복원 버튼을 캡처 단계에서 먼저 받는다.
function prepare() {
  const hiding = !document.body.classList.contains('ui-hidden');
  const W = innerWidth, H = innerHeight, o = origin || { x: W / 2, y: H / 2 }, parts = [];
  document.body.classList.add('ui-moving'); clearTimeout(moving);
  moving = setTimeout(() => document.body.classList.remove('ui-moving'), (OUT + WAVE + .3) * 1000);
  for (const el of document.querySelectorAll(PARTS.join(','))) {
    if (el.hidden || el === fab) continue;
    if (hiding) {
      const r = el.getBoundingClientRect();   // 아직 보이는 자리
      if (!r.width && !r.height) continue;
      el._uiBox = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      // 화면 밖으로 완전히 나가는 데 가장 짧은 쪽으로(가로로 긴 위·아래 막대는 위·아래로, 옆 버튼은 옆으로). 살짝 더 멀리
      const exits = [['l', r.right], ['r', W - r.left], ['t', r.bottom], ['b', H - r.top]].sort((a, b) => a[1] - b[1]);
      const side = exits[0][0], push = 28;
      el.style.setProperty('--ui-dx', side === 'l' ? `${-(r.right + push)}px` : side === 'r' ? `${W - r.left + push}px` : '0px');
      el.style.setProperty('--ui-dy', side === 't' ? `${-(r.bottom + push)}px` : side === 'b' ? `${H - r.top + push}px` : '0px');
    }
    if (el._uiBox) parts.push({ el, d: Math.hypot(el._uiBox.x - o.x, el._uiBox.y - o.y) });
  }
  const far = Math.max(1, ...parts.map(p => p.d));
  for (const { el, d } of parts) el.style.setProperty('--ui-delay', `${(d / far * WAVE).toFixed(3)}s`);
}
const typing = (e) => e.target instanceof Element && e.target.matches('input,textarea,select,[contenteditable]');
addEventListener('keydown', (e) => { if ((e.key === 'h' || e.key === 'H') && !typing(e) && !e.repeat) prepare(); }, { capture: true });
addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('#ui-toggle,#ui-restore-btn')) prepare(); }, { capture: true });

// 버튼 모양·알림 고리. 다른 경로로 바뀌었어도 움직임 클래스는 붙인다
let wasHidden = document.body.classList.contains('ui-hidden'), moving = 0;
new MutationObserver(() => {
  const hidden = document.body.classList.contains('ui-hidden');
  if (hidden === wasHidden) return;
  wasHidden = hidden;
  if (!document.body.classList.contains('ui-moving')) {
    document.body.classList.add('ui-moving');
    moving = setTimeout(() => document.body.classList.remove('ui-moving'), (OUT + WAVE + .3) * 1000);
  }
  fab.setAttribute('aria-pressed', String(hidden));
  fab.setAttribute('aria-label', hidden ? '화면 버튼 다시 보이기' : '화면 버튼 숨기기');
  fab.classList.remove('pulse'); void fab.offsetWidth; fab.classList.add('pulse');
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

fab.setAttribute('aria-pressed', String(wasHidden));
fab.setAttribute('aria-label', wasHidden ? '화면 버튼 다시 보이기' : '화면 버튼 숨기기');
fab.addEventListener('click', () => {
  const hidden = document.body.classList.contains('ui-hidden');
  document.getElementById(hidden ? 'ui-restore-btn' : 'ui-toggle')?.click();   // main.js toggleUI에 연결된 버튼(위 캡처에서 prepare가 먼저 돈다)
});
