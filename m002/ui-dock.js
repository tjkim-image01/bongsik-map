// 화면 정리(2026-11-02 사용자: "너무 유아이들이 산만해.. 소유는 소유 5메타 근방일때 소유를 클릭하면 메뉴가 나타나... 지금은 잇츠미 1개야..
// 강단 근처 가서 클릭을 해.. 그러면 어떤 강의를 할지 메뉴가 나와 ... 그 강의에 맞는 셋트가 나오는거야.. 지금은 드론이 나오는거..
// 강단 누르면 컨트롤 텝이 나오고 메뉴도 나와.. 거기에서 날씨 조절을 하는거야.. 티브이는 아이콘으로 놔두자.. 플레이는 지금있는것 없애고
// 티브이 메뉴 눌렀을때 거기에 플레이 버튼을 넣어줘.. 남산타워 여의도 한강 저것도 오른쪽 아이콘에 넣어서 숨겨줘.. 망원경 아이콘 클릭하면
// 티브이 처럼 팜업메뉴가 나오고 누르면 그쪽 전망으로 이동.. 돔화면 아이콘 없애주고 천천히 이것도 비행기 아이콘으로 넣어줘..
// 걷기 인사 멈춘도 동작아이콘 넣고 누르면 나오게 해주고.. 말하기, 화면공유도 마찬가지").
//
// 기능 코드는 그대로 두고 화면에 늘 떠 있던 덩어리를 옮기기만 한다(버튼에 붙은 동작은 DOM을 옮겨도 그대로 산다).
// - 오른쪽 아이콘 줄(.dock): 🔭 전망(.views 버튼들) · ✈ 천천히 비행(#cruise) · 🧍 동작(#avatar-actions) · 🎙 말하기·화면 공유(.voice-ui) · ↺ 처음 위치(#home)
//   아이콘을 누르면 그 옆에 작은 팝업 메뉴가 열린다(한 번에 하나, 바깥을 누르거나 Esc면 닫힘). 돔 화면 버튼은 없앤다(TV 패널에 전원이 있다).
// - TV 패널 맨 위에 POV 플레이어(#pov)를 넣는다. 왼쪽에 늘 떠 있던 소유·POV 플레이어는 없어진다.
// - 소유: 5m 안에서 소유를 누르면 노래 메뉴(지금은 잇츠미 하나) → 고르면 그 자리에 소유 플레이어(#dance). 멀어지면 닫힌다.
// - 강단: 3m 안에서 강단을 누르면 [강의 | 컨트롤] 메뉴. 강의 = 주종근 화가 강의(지금 세트 = 드론 그림 전시, gallery.js), 컨트롤 = 날씨(weather.js 패널).
// - 가까이 가면 소유·강단 위에 "눌러서 메뉴" 꼬리표가 뜬다.
import * as THREE from 'three';

const SOYU_NEAR = 5, PODIUM_NEAR = 3, CLICK_PX = 7, CLICK_MS = 450;
const SONGS = [{ id: 'itsme', title: '잇츠미', sub: "ILLIT · It's Me" }];   // 나중에 늘린다
const LECTURES = [{ id: 'chu', title: '주종근 화가 강의', sub: '세트: 드론 그림 전시' }];
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  views: svg('<path d="M3 15l7-3 1.5 3.5-7 3z"/><path d="M10 12l8-4 2 4.5-8.5 3"/><path d="M12 16l-2 5M13 16l3 5"/>'),
  cruise: svg('<path d="M2 13l9-2 4-7h2l-1.5 7 5.5 1-1 2-5-.5L13 20h-2l.5-6-9 .5z"/>'),
  actions: svg('<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M8 22l4-8 4 8M5 10l7-1.5L19 10"/>'),
  voice: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  home: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
};

export function createDock({ camera, canvas, getPlayer, soyu, gallery }) {
  const $ = (id) => document.getElementById(id);
  const root = $('experience') || document.body;
  const style = document.createElement('style');
  style.textContent = `
.dock{position:absolute;right:40px;top:84px;z-index:7;display:flex;flex-direction:column;gap:8px}
.dock>button{position:relative;width:44px;height:44px;display:grid;place-items:center;padding:0;border:1px solid var(--line);border-radius:50%;background:rgba(18,28,34,.62);color:var(--ink);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:pointer;transition:background .2s,border-color .2s}
.dock>button svg{width:21px;height:21px}.dock>button:hover{border-color:var(--accent)}
.dock>button[aria-pressed=true],.dock>button[aria-expanded=true]{background:#f1e6d7;color:#293333;border-color:transparent}
.dock>button.live::after{content:"";position:absolute;top:3px;right:3px;width:9px;height:9px;border-radius:50%;background:#ff6b5e;box-shadow:0 0 0 2px rgba(18,28,34,.8)}
.dock-pop{position:absolute;z-index:9;width:max-content;min-width:200px;max-width:min(330px,calc(100vw - 32px));max-height:calc(100vh - 120px);overflow:auto;padding:12px;border:1px solid #e4c99b55;border-radius:12px;background:#14232ef2;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 40px #0007;color:#f3f4f6;font-size:12px;animation:dock-in .28s cubic-bezier(.16,1.25,.4,1)}
.dock-pop[hidden]{display:none}
@keyframes dock-in{from{opacity:0;transform:translateY(6px) scale(.96)}}
.dock-pop header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.dock-pop header b{font-size:13px;color:var(--accent)}
.dock-pop header button{width:26px;height:26px;padding:0;border-radius:50%;background:#ffffff14;color:#fff;font-size:15px;line-height:1}
.dock-list{display:flex;flex-direction:column;gap:6px}
.dock-list button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:9px 11px;border:1px solid #ffffff22;border-radius:8px;background:#ffffff0a;color:#e5e7eb;text-align:left;cursor:pointer}
.dock-list button:hover{background:#ffffff18;border-color:#e4c99b66}.dock-list button.active{background:#e4c99b22;border-color:var(--accent);color:#fff}
.dock-list button b{font-size:12px;color:var(--accent)}.dock-list button small{font-size:10px;color:#9ca3af}
.dock-tabs{display:flex;gap:4px;margin-bottom:10px;padding:3px;border-radius:9px;background:#ffffff0d}.dock-tabs button{flex:1;padding:7px 0;border-radius:7px;background:transparent;color:#cfd3d8;font-size:12px}
.dock-tabs button[aria-selected=true]{background:#f1e6d7;color:#293333;font-weight:600}
.dock-note{margin:8px 0 0;color:#9ca3af;font-size:10.5px;line-height:1.5}
.dock-tag{position:absolute;z-index:5;transform:translate(-50%,-100%);padding:4px 9px;border-radius:999px;background:rgba(18,28,34,.78);border:1px solid var(--accent);color:var(--ink);font-size:11px;white-space:nowrap;pointer-events:none;transition:opacity .25s}
.dock-tag[hidden]{display:block;opacity:0}
/* 옮겨 넣은 덩어리: 원래 화면 위 자리 지정(absolute)을 풀고 팝업 안에 눕힌다 */
.dock-pop .dance,.tv-panel .dance{position:static!important;left:auto!important;top:auto!important;bottom:auto!important;transform:none!important;width:auto!important;min-width:0!important;margin:0;animation:none!important}
.tv-panel .dance.pov{margin:0 0 10px;background:#ffffff0a}
.dock-pop .avatar-actions{position:static!important;width:260px;max-width:none;margin:0;padding:0;background:none;border:0;backdrop-filter:none}.dock-pop .avatar-actions h2{display:none}
.dock-pop .voice-ui{position:static!important;transform:none!important;flex-wrap:wrap;background:none;border:0;padding:0;backdrop-filter:none}
.dock-pop .weather-panel,.dock-pop .weather-panel[hidden]{position:static!important;display:block;opacity:1;scale:1;visibility:visible;pointer-events:auto;width:auto;margin:0;padding:0;background:none;border:0;box-shadow:none;backdrop-filter:none}
.views,#dome-toggle,.flight-controls,.weather-btn{display:none!important}
body.ui-hidden .dock,body.ui-hidden .dock-pop,body.ui-hidden .dock-tag{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
@media(max-width:900px){.dock{right:25px;top:84px}}
@media(max-width:580px){.dock{right:19px;top:84px;gap:6px}.dock>button{width:38px;height:38px}.dock>button svg{width:18px;height:18px}}
@media(max-height:550px){.dock{top:70px;gap:5px}.dock>button{width:34px;height:34px}}`;
  document.head.append(style);

  // ---------- 팝업 ----------
  let open = null;
  function makePop(title, label) {
    const el = document.createElement('section'); el.className = 'dock-pop'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label || title);
    el.innerHTML = `<header><b></b><button type="button" aria-label="닫기">×</button></header><div class="dock-body"></div>`;
    el.querySelector('header b').textContent = title;
    el.querySelector('header button').addEventListener('click', () => close());
    root.append(el);
    return { el, body: el.querySelector('.dock-body'), button: null, onOpen: null };
  }
  function place(pop, at) {   // at: 아이콘 버튼(왼쪽에 연다) 또는 화면 좌표 {x,y}(그 위쪽에 연다)
    const W = innerWidth, H = innerHeight, r = pop.el.getBoundingClientRect();
    let x, y;
    if (at instanceof Element) { const b = at.getBoundingClientRect(); x = b.left - r.width - 10; y = b.top; }
    else {   // 누른 곳 위, 자리가 없으면 오른쪽(소유·강단을 가리지 않게), 그것도 없으면 왼쪽
      x = at.x - r.width / 2; y = at.y - r.height - 16;
      if (y < 70) { y = at.y - r.height / 2; x = at.x + 70; if (x + r.width > W - 80) x = at.x - 70 - r.width; }
    }
    pop.el.style.left = `${Math.max(16, Math.min(W - r.width - 16, x))}px`;
    pop.el.style.top = `${Math.max(16, Math.min(H - r.height - 16, y))}px`;
  }
  function show(pop, at) {
    if (open && open !== pop) close();
    open = pop; pop.el.hidden = false; pop.onOpen?.(); place(pop, at); pop.at = at;
    pop.button?.setAttribute('aria-expanded', 'true');
  }
  function close() {
    if (!open) return;
    open.el.hidden = true; open.button?.setAttribute('aria-expanded', 'false'); open = null;
  }
  addEventListener('pointerdown', (e) => {
    if (!open || open.el.contains(e.target) || open.button?.contains(e.target) || e.target === canvas) return;   // 화면(3D) 누르기는 아래 클릭 판정이 처리
    close();
  }, { capture: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('resize', () => { if (open) place(open, open.at); });

  // ---------- 오른쪽 아이콘 줄 ----------
  const dock = document.createElement('nav'); dock.className = 'dock'; dock.setAttribute('aria-label', '공간 메뉴');
  root.append(dock);
  function iconButton(icon, label) {
    const b = document.createElement('button'); b.type = 'button'; b.innerHTML = ICON[icon]; b.title = label; b.setAttribute('aria-label', label);
    dock.append(b); return b;
  }
  function popButton(icon, label, pop) {
    const b = iconButton(icon, label); b.setAttribute('aria-expanded', 'false'); pop.button = b;
    b.addEventListener('click', () => (open === pop ? close() : show(pop, b)));
    return b;
  }

  // 🔭 전망: 누르면 그쪽 전망으로 옮기고 닫는다
  const views = makePop('전망 보기');
  const viewList = document.createElement('div'); viewList.className = 'dock-list'; views.body.append(viewList);
  for (const b of document.querySelectorAll('.views [data-view]')) {
    viewList.append(b);
    b.addEventListener('click', () => setTimeout(close, 120));
  }
  popButton('views', '전망 보기', views);

  // ✈ 천천히 비행: 원래 버튼(#cruise)을 대신 누르고 눌림 상태를 따라간다
  const cruise = $('cruise'), plane = iconButton('cruise', '천천히 비행');
  plane.addEventListener('click', () => cruise?.click());
  const syncPlane = () => { const on = cruise?.getAttribute('aria-pressed') === 'true'; plane.setAttribute('aria-pressed', String(on)); plane.title = on ? '비행 멈추기' : '천천히 비행'; };
  if (cruise) new MutationObserver(syncPlane).observe(cruise, { attributes: true, attributeFilter: ['aria-pressed'] });
  syncPlane();

  // 🧍 동작
  const actions = makePop('캐릭터 동작');
  const actionPanel = $('avatar-actions');
  if (actionPanel) actions.body.append(actionPanel);
  popButton('actions', '캐릭터 동작', actions);

  // 🎙 말하기·화면 공유(누가 말하거나 공유 중이면 아이콘에 빨간 점)
  const voice = makePop('말하기 · 화면 공유');
  const mic = popButton('voice', '말하기 · 화면 공유', voice);
  const voiceUi = document.querySelector('.voice-ui');
  if (voiceUi) {
    voice.body.append(voiceUi);
    const note = document.createElement('p'); note.className = 'dock-note'; note.textContent = 'T 키를 누르고 있는 동안 말해요 (메뉴를 닫아도 돼요)'; voice.body.append(note);
    const syncMic = () => mic.classList.toggle('live', voiceUi.classList.contains('someone'));
    new MutationObserver(syncMic).observe(voiceUi, { attributes: true, attributeFilter: ['class'] }); syncMic();
  }

  // ↺ 처음 위치
  const home = $('home'), back = iconButton('home', '처음 위치로');
  back.addEventListener('click', () => home?.click());

  // ---------- TV 패널 맨 위에 POV 플레이어 ----------
  const tvPanel = $('tv-panel'), pov = $('pov');
  if (tvPanel && pov) tvPanel.querySelector('.tv-header')?.after(pov);

  // ---------- 소유 메뉴 ----------
  const soyuPop = makePop('소유');
  const songList = document.createElement('div'); songList.className = 'dock-list'; soyuPop.body.append(songList);
  const player = $('dance');
  let song = null;
  for (const s of SONGS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.song = s.id;
    b.innerHTML = '<b></b><small></small>'; b.querySelector('b').textContent = `🎵 ${s.title}`; b.querySelector('small').textContent = s.sub;
    b.addEventListener('click', () => { song = s.id; renderSongs(); place(soyuPop, soyuPop.at); });
    songList.append(b);
  }
  if (player) { player.hidden = true; soyuPop.body.append(player); }
  function renderSongs() {
    for (const b of songList.children) b.classList.toggle('active', b.dataset.song === song);
    if (player) player.hidden = !song;
    if (player) player.style.marginTop = song ? '10px' : '';
  }
  soyuPop.onOpen = renderSongs;

  // ---------- 강단 메뉴: 강의 | 컨트롤 ----------
  const podiumPop = makePop('강단');
  podiumPop.body.innerHTML = `<div class="dock-tabs" role="tablist"><button type="button" role="tab" data-tab="lecture" aria-selected="true">🎓 강의</button><button type="button" role="tab" data-tab="control" aria-selected="false">🎛 컨트롤</button></div>
<div data-pane="lecture"><div class="dock-list"></div><p class="dock-note"></p></div><div data-pane="control" hidden></div>`;
  const lectureList = podiumPop.body.querySelector('[data-pane=lecture] .dock-list'), lectureNote = podiumPop.body.querySelector('[data-pane=lecture] .dock-note');
  for (const l of LECTURES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.lecture = l.id;
    b.innerHTML = '<b></b><small></small>'; b.querySelector('b').textContent = `🎨 ${l.title}`; b.querySelector('small').textContent = l.sub;
    b.addEventListener('click', () => { $('gallery-toggle')?.click(); setTimeout(renderLecture, 50); });   // TV 켜기·영상 멈춤까지 main.js 그대로
    lectureList.append(b);
  }
  function renderLecture() {
    const on = !!gallery?.isOn?.();
    for (const b of lectureList.children) {
      b.classList.toggle('active', on);
      b.querySelector('small').textContent = on ? '진행 중 · 누르면 강의를 끝내요' : LECTURES.find(l => l.id === b.dataset.lecture).sub;
    }
    lectureNote.textContent = on ? '드론이 그림을 들고 둘러싸요. 강단 앞에서 "그림 발표 시작"을 누르면 한 장씩 TV 앞으로 옵니다.' : '강의를 고르면 그 강의 세트가 나와요. TV가 켜지고 발표 모드가 됩니다.';
  }
  const control = podiumPop.body.querySelector('[data-pane=control]');
  const weatherPanel = $('weather-panel');
  if (weatherPanel) control.append(weatherPanel);
  podiumPop.body.querySelector('.dock-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab; if (!tab) return;
    for (const b of podiumPop.body.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of podiumPop.body.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== tab;
    place(podiumPop, podiumPop.at);
  });
  podiumPop.onOpen = renderLecture;

  // ---------- 화면(3D) 누르기: 소유·강단 ----------
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), tmp = new THREE.Vector3(), soyuAt = new THREE.Vector3();
  const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const soyuProxy = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1.9, 12), proxyMat); soyuProxy.name = 'SoyuClickArea';
  const podiumAt = () => gallery?.podium?.();
  const distTo = (x, z) => { const p = getPlayer(); return p ? Math.hypot(p.position.x - x, p.position.z - z) : Infinity; };
  function soyuDist() { soyu.center(soyuAt); return distTo(soyuAt.x, soyuAt.z); }
  function podiumDist() { const p = podiumAt(); return p ? distTo(p.position.x, p.position.z) : Infinity; }

  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    pointer.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([soyuProxy.parent && soyuProxy, podiumAt()].filter(Boolean), true)[0] ?? null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX || performance.now() - down.t > CLICK_MS) { down = null; return; }
    down = null;
    const hit = pick(e.clientX, e.clientY);
    if (!hit) { close(); return; }
    const isSoyu = hit.object === soyuProxy, at = { x: e.clientX, y: e.clientY };
    if (isSoyu ? soyuDist() > SOYU_NEAR : podiumDist() > PODIUM_NEAR) { flash(at, isSoyu ? '소유 가까이(5m 안) 가서 눌러 주세요' : '강단 가까이 가서 눌러 주세요'); return; }
    show(isSoyu ? soyuPop : podiumPop, at);
  });

  // 가까이 가면 머리 위 꼬리표, 멀어지면 메뉴 닫기
  const tag = (text) => { const t = document.createElement('div'); t.className = 'dock-tag'; t.textContent = text; t.hidden = true; root.append(t); return t; };
  const soyuTag = tag('소유 · 눌러서 메뉴'), podiumTag = tag('강단 · 눌러서 메뉴'), hintTag = tag('');
  let hintUntil = 0;
  function flash(at, text) { hintTag.textContent = text; hintTag.style.left = `${at.x}px`; hintTag.style.top = `${at.y - 12}px`; hintTag.hidden = false; hintUntil = performance.now() + 1600; }
  function project(el, world, visible) {
    if (!visible) { el.hidden = true; return; }
    tmp.copy(world).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) { el.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    el.style.left = `${r.left + (tmp.x + 1) / 2 * r.width}px`; el.style.top = `${r.top + (1 - tmp.y) / 2 * r.height}px`; el.hidden = false;
  }
  function frame() {
    const p = getPlayer();
    if (p?.parent) {
      if (soyuProxy.parent !== p.parent) p.parent.add(soyuProxy);
      const sd = soyuDist(); soyuProxy.position.set(soyuAt.x, p.position.y + .95, soyuAt.z);
      const pd = podiumDist(), podium = podiumAt();
      if (open === soyuPop && sd > SOYU_NEAR + .5) close();
      if (open === podiumPop && pd > PODIUM_NEAR + 1) close();
      project(soyuTag, p.parent.localToWorld(tmp.set(soyuAt.x, p.position.y + 2.1, soyuAt.z)).clone(), sd < SOYU_NEAR && open !== soyuPop);
      if (podium) project(podiumTag, p.parent.localToWorld(tmp.set(podium.position.x, podium.position.y + 1.65, podium.position.z)).clone(), pd < PODIUM_NEAR && open !== podiumPop);
      if (!hintTag.hidden && performance.now() > hintUntil) hintTag.hidden = true;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { close, openSoyu: () => show(soyuPop, { x: innerWidth / 2, y: innerHeight / 2 }), openPodium: () => show(podiumPop, { x: innerWidth / 2, y: innerHeight / 2 }), isOpen: () => !!open,
    hitTest: (x, y) => { const h = pick(x, y); return h ? (h.object === soyuProxy ? 'soyu' : 'podium') : null; } };   // 검수용
}
