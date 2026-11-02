// 드론 그림 전시·발표(2026-11-02 사용자: "드론이 그림을 한장씩 들고 등장 하는거야.. 그리고 주면을 감싸는거야.. 그림을 더블 클릭하면 조금 더
// 가까이에서 볼수 있도록 해줘.. 그림이 나오면 옆에 강단 같은게 있고 그근처 가면 버튼이 나와.. 누르면 드론이 그림을 가지고 스트린이 있는 곳으로
// 이동해... 그러면 말을 하고 하나씩 완료하면 뒤로가구").
// - 들어오면 드론 10대가 그림을 한 장씩 매달고 멀리 아래(구름 쪽)에서 차례로 날아와 데크를 타원으로 둘러싼다(스크린 쪽은 비워 둔다).
// - 데크 스크린 쪽 끝에 강단. 가까이 가면 "그림 발표 시작" 버튼 → 첫 그림의 드론이 스크린(평면 TV 자리) 앞으로 날아가 크게 보여 준다.
//   발표자는 T를 눌러 말하고(voice.js), "완료 · 다음"을 누르면 그 드론은 제자리로 돌아가고 다음 드론이 온다. 마지막이 끝나면 모두 제자리.
//   발표 상태(발표자·몇 번째)는 방 전체가 같이 본다(서버 /voice 채널 gallery). 발표자가 나가면 끝난다.
// - 그림 더블클릭 = tv-zoom.js가 크게 보여 준다(zoomTargets).
// - 그림은 Aside ChatGPT로 그린 assets/gallery/painting-NN.png(titles.json). 아직 없으면 임시 그림을 보여 주고 15초마다 다시 찾는다.
// - 켜기·끄기(2026-11-02 사용자: "드론모드 끄는것도 넣어줘.. 저거 티브이의 기능중 하나에 포함 시켜주고...티브이 키고 발표 모드로 바꾸는거야..
//   티브이의 메뉴중 기타에 드론겔러리 추가 해줘"): 처음엔 꺼져 있다. TV 패널 → 📺 TV 화면 → 기타 → 드론 갤러리로 켜면(방 전체) TV가 켜지고
//   드론이 차례로 날아와 강단이 나온다. 끄면 발표가 끝나고 드론은 왔던 길(멀리 아래)로 돌아가며 강단이 사라진다.
import * as THREE from 'three';

const BASE = './assets/gallery/';
const RING = { rx: 6.4, rz: 9.6, height: 2.5, from: 35, to: 325 };   // 데크 중심 둘레 타원(m), 각도는 +z(스크린 쪽)=0°에서, 스크린 쪽 70°는 비움
const PODIUM = { x: 2.3, z: 4.7, near: 1.5 };                          // 강단 자리(데크 좌표)와 버튼이 뜨는 거리
const SCREEN_SCALE = 3.2, ENTER_GAP = .6;                             // 스크린 앞 확대 배율, 드론이 하나씩 나오는 간격(초)

export function createGallery({ getPlayer, getScreens, send, getMyId, onShow }) {   // onShow(on): 켜지고 꺼질 때(main.js가 TV를 켠다)
  let parent = null, floorY = 0, built = false, titles = [], drones = [], podium = null, podiumGlow = null, t = 0, last = performance.now();
  let show = { on: false, presenter: null, index: -1, count: 0 }, myId = null;
  const loader = new THREE.TextureLoader();

  // ---------- 그림(없으면 임시 그림) ----------
  function placeholder(i, title) {
    const c = document.createElement('canvas'); c.width = 400; c.height = 500; const g = c.getContext('2d');
    const hue = (i * 37) % 360, grad = g.createLinearGradient(0, 0, 400, 500);
    grad.addColorStop(0, `hsl(${hue},45%,62%)`); grad.addColorStop(1, `hsl(${(hue + 60) % 360},40%,32%)`); g.fillStyle = grad; g.fillRect(0, 0, 400, 500);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 26px sans-serif'; g.textAlign = 'center'; g.fillText(title, 200, 240); g.font = '18px sans-serif'; g.fillText('그림을 그리는 중…', 200, 280);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function tryLoad(d) {
    if (d.loaded) return;
    loader.load(`${BASE}${d.file}?v=${Date.now()}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      d.canvas.material.map?.dispose(); d.canvas.material.map = tex; d.canvas.material.needsUpdate = true; d.loaded = true;
      const k = tex.image.height / tex.image.width;   // 그림 비율대로(가로 1m 기준)
      d.canvas.scale.set(1, k, 1); d.frame.scale.set(1.08, k + .08, 1); d.hang = -(.42 + k / 2);
    }, undefined, () => {});
  }

  // ---------- 드론 ----------
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: .6, roughness: .45 });
  const rotorMat = new THREE.MeshBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: .7 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x1b1f23 });
  function makeDrone(i, title, file) {
    const root = new THREE.Group(); root.name = `GalleryDrone_${i}`;
    const body = new THREE.Mesh(new THREE.BoxGeometry(.42, .1, .42), darkMetal); root.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), darkMetal); dome.position.y = .05; root.add(dome);
    const led = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), ledMat); led.position.set(0, .02, .22); root.add(led);
    const rotors = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .5, 6), darkMetal); arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(sz, sx) * -1;
      arm.position.set(sx * .18, 0, sz * .18); root.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .06, 10), darkMetal); motor.position.set(sx * .36, .04, sz * .36); root.add(motor);
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(.17, 20), rotorMat); rotor.rotation.x = -Math.PI / 2; rotor.position.set(sx * .36, .08, sz * .36); root.add(rotor); rotors.push(rotor);
    }
    // 매단 그림: 줄 2개 + 액자 + 캔버스(조명을 받아 날씨에 따라 어두워진다)
    const hangGroup = new THREE.Group(); root.add(hangGroup);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .05), frameMat); frame.scale.set(1.08, 1.33, 1); hangGroup.add(frame);
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: placeholder(i, title), roughness: .85 }));
    canvas.scale.set(1, 1.25, 1); canvas.position.z = .03; canvas.name = `Painting_${i}`; hangGroup.add(canvas);
    const back = canvas.clone(); back.material = frameMat; back.position.z = -.03; back.rotation.y = Math.PI; hangGroup.add(back);
    const cable = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.3, 0, 0), new THREE.Vector3(-.15, -1, 0), new THREE.Vector3(.3, 0, 0), new THREE.Vector3(.15, -1, 0)]), cableMat);
    root.add(cable);
    return { i, title, file, root, rotors, hangGroup, frame, canvas, cable, hang: -1.05, loaded: false, scale: 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), slot: new THREE.Vector3(), exit: new THREE.Vector3(), start: 0 };
  }

  // ---------- 강단 ----------
  function makePodium() {
    const g = new THREE.Group(); g.name = 'GalleryPodium';
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: .6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, .5), wood); base.position.y = .04; g.add(base);
    const column = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, .34), wood); column.position.y = .58; g.add(column);
    const top = new THREE.Mesh(new THREE.BoxGeometry(.66, .05, .46), wood); top.position.set(0, 1.12, 0); top.rotation.x = -.28; g.add(top);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .32, 6), darkMetal); mic.position.set(.18, 1.28, -.08); mic.rotation.x = .5; g.add(mic);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.03, 10, 8), darkMetal); head.position.set(.18, 1.42, -.17); g.add(head);
    const glow = new THREE.Mesh(new THREE.RingGeometry(.75, .9, 48), new THREE.MeshBasicMaterial({ color: 0xe4c99b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = .02; g.add(glow); podiumGlow = glow;
    return g;
  }

  async function build() {
    const player = getPlayer?.(); if (!player?.parent) return;
    built = true; parent = player.parent; floorY = player.position.y;
    try { titles = await (await fetch(`${BASE}titles.json`)).json(); } catch { titles = []; }
    if (!titles.length) titles = Array.from({ length: 10 }, (_, i) => ({ file: `painting-${String(i + 1).padStart(2, '0')}.png`, title: `그림 ${i + 1}` }));
    const n = titles.length, now = t;
    titles.forEach(({ file, title }, i) => {
      const d = makeDrone(i, title, file);
      const a = THREE.MathUtils.degToRad(RING.from + (RING.to - RING.from) * (n === 1 ? .5 : i / (n - 1)));
      d.slot.set(Math.sin(a) * RING.rx, floorY + RING.height + (i % 2 ? .35 : 0), Math.cos(a) * RING.rz);
      const out = new THREE.Vector3(d.slot.x, 0, d.slot.z).normalize();
      d.exit.copy(d.slot).addScaledVector(out, 70).add(new THREE.Vector3(0, -35, 0));   // 멀리 아래(구름 쪽)에서 오고 그리로 돌아간다
      d.pos.copy(d.exit); d.start = now + .8 + i * ENTER_GAP; d.root.position.copy(d.pos); d.root.visible = false;
      parent.add(d.root); drones.push(d); tryLoad(d);
    });
    podium = makePodium(); podium.position.set(PODIUM.x, floorY, PODIUM.z); podium.rotation.y = Math.PI; podium.visible = show.on; parent.add(podium);
    setInterval(() => drones.forEach(tryLoad), 15000);
  }

  // 스크린 앞 자리: 평면 TV(스크린) 가운데에서 데크 쪽으로 1.5m 앞, 데크 좌표로
  const tmp = new THREE.Vector3(), screenSpot = new THREE.Vector3();
  function screenTarget() {
    const flat = getScreens?.()?.flat;
    if (flat) { flat.updateWorldMatrix(true, false); tmp.setFromMatrixPosition(flat.matrixWorld); screenSpot.copy(parent.worldToLocal(tmp)); }
    else screenSpot.set(0, floorY + 5, 16);
    screenSpot.z -= 1.5; screenSpot.y = Math.max(screenSpot.y, floorY + 2.6); return screenSpot;
  }

  function frame() {
    const ms = performance.now(), dt = Math.min(.1, (ms - last) / 1000); last = ms; t += dt;
    if (!built) { build(); requestAnimationFrame(frame); return; }
    for (const d of drones) {
      if (!show.on) {   // 꺼짐: 아직 보이는 드론은 왔던 길로 돌아가고, 멀어지면 감춘다
        if (!d.root.visible) continue;
        if (d.pos.distanceTo(d.exit) < 3) { d.root.visible = false; continue; }
      } else if (t < d.start) continue;
      d.root.visible = true;
      const onScreen = show.presenter && show.index === d.i;
      const goal = !show.on ? d.exit : onScreen ? screenTarget() : d.slot, goalScale = onScreen ? SCREEN_SCALE : 1;
      // 부드럽게 날아간다(가속·감속), 움직이는 방향으로 살짝 기운다, 제자리에서는 둥실
      const k = 1 - Math.exp(-dt * (onScreen ? 1.5 : show.on ? 1.2 : .9));
      tmp.copy(goal); tmp.y += Math.sin(t * 1.3 + d.i) * .08;
      d.vel.copy(tmp).sub(d.pos).multiplyScalar(k / Math.max(dt, 1e-3));
      d.pos.lerp(tmp, k); d.root.position.copy(d.pos);
      d.scale += (goalScale - d.scale) * (1 - Math.exp(-dt * 2));
      d.hangGroup.scale.setScalar(d.scale); d.hangGroup.position.y = d.hang * d.scale;
      d.cable.scale.set(d.scale, .38 * d.scale, 1);   // 몸체에서 액자 윗변까지(액자 위 끝 = 매단 높이 + 액자 반 높이 = −0.38m × 배율)
      // 둘레에서도 스크린 앞에서도 데크 가운데(사람들)를 본다. lookAt은 월드 좌표를 받는다 — 데크 좌표(높이 ≈70m)를 그대로 넘기면
      // 하늘을 올려다봐서 그림이 누웠다(2026-11-02 검수)
      d.root.lookAt(parent.localToWorld(tmp.set(0, d.pos.y, 0)));
      d.root.rotateZ(THREE.MathUtils.clamp(-d.vel.x * .02, -.3, .3)); d.root.rotateX(THREE.MathUtils.clamp(d.vel.length() * .015, 0, .25));
      for (const r of d.rotors) r.rotation.z += dt * 38;
    }
    // 강단 근처면 버튼
    const player = getPlayer?.();
    if (player && podium) {
      const near = show.on && Math.hypot(player.position.x - PODIUM.x, player.position.z - PODIUM.z) < PODIUM.near;
      podiumGlow.material.opacity += ((near ? .75 : .25 + .15 * Math.sin(t * 2)) - podiumGlow.material.opacity) * Math.min(1, dt * 6);
      renderUI(near);
    }
    requestAnimationFrame(frame);
  }

  // ---------- 화면(버튼·발표 막대) ----------
  const style = document.createElement('style');
  style.textContent = `.gallery-bar{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:8px;padding:6px;border:1px solid var(--line);border-radius:10px;background:rgba(18,28,34,.82);backdrop-filter:blur(16px);color:var(--ink);font-size:12px;white-space:nowrap;max-width:calc(100% - 32px)}
.gallery-bar[hidden]{display:none}.gallery-bar .gb-text{padding:0 8px;overflow:hidden;text-overflow:ellipsis}
.gallery-bar button{padding:9px 14px;border-radius:6px;background:rgba(255,255,255,.09);font-size:12px}.gallery-bar button.primary{background:#f1e6d7;color:#293333;font-weight:600}
@media(max-width:580px){.gallery-bar{bottom:190px;font-size:11px;flex-wrap:wrap;justify-content:center;white-space:normal}}`;
  document.head.append(style);
  const bar = document.createElement('div'); bar.className = 'gallery-bar'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '그림 발표');
  (document.getElementById('experience') || document.body).append(bar);
  let lastKey = '';
  function renderUI(near) {
    const presenting = !!show.presenter, mine = presenting && show.presenter.id === myId, cur = drones[show.index];
    const key = [near, presenting, mine, show.index, show.presenter?.name].join('|');
    if (key === lastKey) return; lastKey = key;
    if (mine) {
      bar.innerHTML = `<span class="gb-text">🖼 ${show.index + 1}/${show.count} 「${cur?.title ?? ''}」 · T를 누르고 소개하세요</span><button class="primary" data-act="next">✓ 완료 · ${show.index + 1 >= show.count ? '마치기' : '다음 그림'}</button><button data-act="end">발표 끝</button>`;
    } else if (presenting) {
      bar.innerHTML = `<span class="gb-text">🎤 ${show.presenter.name} 님 발표 중 · ${show.index + 1}/${show.count} 「${cur?.title ?? ''}」</span>`;
    } else if (near) {
      bar.innerHTML = `<span class="gb-text">강단</span><button class="primary" data-act="start">🎤 그림 발표 시작</button>`;
    }
    bar.hidden = !(mine || presenting || near);
  }
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    act(act);
  });
  function act(action) {
    if (send?.(action, drones.length)) return;   // 방에 연결 안 돼 있으면(서버 없는 공개 페이지 등) 내 화면에서만
    if (action === 'on' || action === 'off') apply({ on: action === 'on', presenter: null, index: -1, count: show.count });
    else if (!show.on) return;
    else if (action === 'start') apply({ ...show, presenter: { id: myId ?? 'me', name: '나' }, index: 0, count: drones.length });
    else if (action === 'next') apply(show.index + 1 >= show.count ? { ...show, presenter: null, index: -1 } : { ...show, index: show.index + 1 });
    else apply({ ...show, presenter: null, index: -1 });
  }

  function apply(next, id = getMyId?.()) {
    if (id) myId = id;
    const was = show.on;
    show = { on: !!next?.on, presenter: next?.presenter ?? null, index: next?.index ?? -1, count: next?.count ?? 0 }; lastKey = '';
    if (podium) podium.visible = show.on;
    if (show.on && !was) drones.forEach((d, i) => { if (!d.root.visible) { d.pos.copy(d.exit); d.root.position.copy(d.pos); } d.start = t + .3 + i * ENTER_GAP; });   // 하나씩 다시 날아온다
    if (show.on !== was) onShow?.(show.on);
  }

  requestAnimationFrame(frame);
  return {
    apply,
    isOn: () => show.on,
    setOn: (on) => { if (on !== show.on) act(on ? 'on' : 'off'); },
    // tv-zoom.js: 그림 더블클릭 → 크게 보기
    zoomTargets: () => drones.filter(d => d.root.visible).map(d => ({ mesh: d.canvas, source: d.canvas.material.map?.image, label: d.title })),
    // 검수용: 내 캐릭터를 강단 앞으로 옮긴다
    goToPodium: () => { const p = getPlayer?.(); if (p) { p.position.x = PODIUM.x - .2; p.position.z = PODIUM.z - 1; } },
    getState: () => ({ built, show, drones: drones.map(d => ({ i: d.i, title: d.title, loaded: d.loaded, visible: d.root.visible, pos: d.pos.toArray().map(v => +v.toFixed(2)), scale: +d.scale.toFixed(2) })) }),
  };
}
