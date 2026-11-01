// TV 크게 보기(2026-11-02 사용자: "티브이 더블 클릭하면 그냥 확대해서 볼수 있도록 해줘. 더블클릭 하면 빠지도록 해줘.."):
// TV 화면(돔·평면 TV·그 위 공유 화면)을 두 번 누르면, 그 TV가 화면에 보이던 자리에서 화면 가득으로 커지며 2D로 보여 준다.
// 다시 두 번 누르거나 Esc면 원래 TV 자리로 줄어들며 빠진다. 카메라는 건드리지 않고, TV에 입혀진 영상·그림을 그대로 그려 보여 준다.
// 폰은 dblclick이 잘 안 와서 같은 자리를 0.32초 안에 두 번 탭한 것도 받는다. 360° 모드(공간 전체가 TV)는 대상이 아니다.
import * as THREE from 'three';

const TAP_MS = 320, TAP_PX = 30, MOVE = .42;

export function createTvZoom({ camera, canvas, getScreens, getShare, getExtra }) {   // getExtra: 드론 그림 등 더 크게 볼 것들(gallery.js)
  const style = document.createElement('style');
  style.textContent = `.tv-zoom{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(6,10,14,0);transition:background ${MOVE}s ease;touch-action:none;user-select:none}
.tv-zoom.open{background:rgba(6,10,14,.82)}
.tv-zoom canvas{position:absolute;left:0;top:0;transform-origin:0 0;border-radius:6px;box-shadow:0 20px 80px #000a;transition:transform ${MOVE}s cubic-bezier(.2,.8,.2,1),border-radius ${MOVE}s}
.tv-zoom p{position:absolute;bottom:18px;left:0;right:0;margin:0;text-align:center;font-size:12px;color:#fffaf1b3;opacity:0;transition:opacity .3s .2s}.tv-zoom.open p{opacity:1}`;
  document.head.append(style);

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let layer = null, view = null, from = null, closing = false;

  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function targets() {   // 앞에 덮인 공유 화면을 먼저 본다
    const list = [], share = getShare?.(), s = getScreens?.();
    if (share?.mesh && share.source) list.push({ mesh: share.mesh, source: share.source, label: '공유 화면' });
    for (const mesh of [s?.dome, s?.flat]) if (mesh && shown(mesh) && mesh.material?.map?.image) list.push({ mesh, source: mesh.material.map.image, label: 'TV' });
    for (const extra of getExtra?.() || []) if (extra.mesh && extra.source && shown(extra.mesh)) list.push(extra);
    return list;
  }
  function hit(x, y) {
    const r = canvas.getBoundingClientRect();
    pointer.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const list = targets(); if (!list.length) return null;
    const hits = raycaster.intersectObjects(list.map(t => t.mesh), false);
    return hits.length ? list.find(t => t.mesh === hits[0].object) : null;
  }
  // TV가 지금 화면에 보이는 사각형(꼭짓점을 화면에 투영)
  function screenRect(mesh) {
    mesh.geometry.computeBoundingBox(); mesh.updateWorldMatrix(true, false);
    const b = mesh.geometry.boundingBox, r = canvas.getBoundingClientRect(), v = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(mesh.matrixWorld).project(camera);
      if (v.z > 1) continue;   // 카메라 뒤
      const px = r.left + (v.x + 1) / 2 * r.width, py = r.top + (1 - v.y) / 2 * r.height;
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    if (!Number.isFinite(x0)) return { x: r.width / 2 - 40, y: r.height / 2 - 22, w: 80, h: 45 };
    x0 = Math.max(x0, -r.width); y0 = Math.max(y0, -r.height); x1 = Math.min(x1, r.width * 2); y1 = Math.min(y1, r.height * 2);
    return { x: x0, y: y0, w: Math.max(x1 - x0, 40), h: Math.max(y1 - y0, 24) };
  }
  const sizeOf = (src) => [src.videoWidth || src.naturalWidth || src.width || 1280, src.videoHeight || src.naturalHeight || src.height || 720];
  function fit(src) {   // 화면 가득(여백 3%), 비율 유지
    const [w, h] = sizeOf(src), W = innerWidth * .97, H = innerHeight * .9, k = Math.min(W / w, H / h);
    return { x: (innerWidth - w * k) / 2, y: (innerHeight - h * k) / 2, w: w * k, h: h * k };
  }
  const place = (el, box, full) => { el.style.transform = `translate(${box.x}px,${box.y}px) scale(${box.w / full.w},${box.h / full.h})`; };

  function open(target) {
    if (layer) return;
    view = target; from = screenRect(target.mesh);
    layer = document.createElement('div'); layer.className = 'tv-zoom'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-label', `${target.label} 크게 보기`);
    const pic = document.createElement('canvas'), full = fit(target.source);
    pic.width = Math.round(full.w * Math.min(devicePixelRatio, 2)); pic.height = Math.round(full.h * Math.min(devicePixelRatio, 2));
    pic.style.width = `${full.w}px`; pic.style.height = `${full.h}px`;
    layer.append(pic, Object.assign(document.createElement('p'), { textContent: '두 번 누르거나 Esc를 누르면 돌아가요' }));
    document.body.append(layer);
    place(pic, from, full);
    const g = pic.getContext('2d');
    const draw = () => { if (!layer) return; try { g.drawImage(view.source, 0, 0, pic.width, pic.height); } catch {} requestAnimationFrame(draw); };
    draw();
    requestAnimationFrame(() => requestAnimationFrame(() => { layer?.classList.add('open'); place(pic, full, full); }));
    watchTaps(layer, close);
    layer.addEventListener('dblclick', (e) => { e.preventDefault(); close(); });
  }
  function close() {
    if (!layer || closing) return;
    closing = true;
    const pic = layer.querySelector('canvas'), full = { w: parseFloat(pic.style.width), h: parseFloat(pic.style.height) };
    layer.classList.remove('open'); place(pic, screenRect(view.mesh), full);   // 지금 TV 자리로 줄어든다(그사이 카메라가 움직였어도)
    pic.style.borderRadius = '2px';
    const done = layer; setTimeout(() => { done.remove(); if (layer === done) { layer = null; view = null; } closing = false; }, MOVE * 1000);
  }

  // 두 번 누르기: 데스크톱 dblclick + 터치 두 번 탭
  function watchTaps(el, action) {
    let last = null;
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      const now = performance.now();
      if (last && now - last.t < TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_PX) { last = null; action(e); }
      else last = { t: now, x: e.clientX, y: e.clientY };
    });
  }
  canvas.addEventListener('dblclick', (e) => { const t = hit(e.clientX, e.clientY); if (t) { e.preventDefault(); open(t); } });
  watchTaps(canvas, (e) => { const t = hit(e.clientX, e.clientY); if (t) open(t); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer) close(); });

  return { open: () => { const t = targets()[0]; if (t) open(t); }, close, isOpen: () => !!layer && !closing, hitTest: (x, y) => hit(x, y)?.label ?? null };
}
