// 한 명만 말하기(2026-11-01 사용자: "음성을 다른 사람에게 보내는 기능… 한명의 화자가 말할때 다른 사람에게 전달 되도록.. 실시간으로",
// "응 한명만 말하기 기능 추가 해줘"): 누르고 있는 동안만(T 키·버튼) 마이크를 보내고, 서버(/voice)가 발언권을 한 명에게만 준다.
// V 키는 main.js 시점 전환이 쓰고 있어 T(Talk)로 옮겼다.
// 음성은 WebRTC로 브라우저끼리 직접 오간다(같은 와이파이 기준, 인터넷 너머는 TURN 서버가 더 필요). 서버는 연결 신호와 발언권만 중계한다.
// 듣기(2026-11-02 사용자: "한명만 말하기 할땐 현제 같은 블록에 있음 다같이 잘들리게(블럭나중에 추가할 예정"): 같은 블록이면 거리와 상관없이
// 모두 같은 크기로 또렷하게 들린다. 지금은 데크 전체가 한 블록이다. 블록이 생기면 sameBlock(말하는 사람 id)으로 다른 블록 소리를 끈다.
// 화면 공유(2026-11-02 사용자: "내화면 공유도 가능해?" → "응 추가 기능 추가 해줘", "내화면은 티브이 화면에 보이는거야"): 같은 연결에 화면 영상·화면 소리를
// 함께 싣고, 받은 화면을 지금 켜진 TV 화면(돔이면 돔 모양, 아니면 평면 TV) 위에 덮어 보여 준다. 공유도 한 번에 한 명(서버 share 발언권).
// TV(main.js TvSystem)의 영상 재생 상태는 건드리지 않고 그 위에 덮기만 한다.
import * as THREE from 'three';
import { noServer } from './solo-room.js';

// 같은 네트워크 기준. 마이크 권한이 없는 브라우저는 자기 주소를 '*.local'로 가려서 듣기만 하는 두 사람끼리 못 찾으므로,
// 서버(serve.py STUN_PORT)에 실제 LAN 주소를 물어 후보로 쓴다
const STUN_PORT = 3478;
const ICE = { iceServers: [{ urls: `stun:${location.hostname}:${STUN_PORT}` }] };
const HEAD = 1.45;                // 표시 높이(m, 아바타 축척 전)
// 연결마다 같은 순서로 3칸을 미리 열어 두고 트랙만 갈아 끼운다(다시 협상하지 않아서 누르는 즉시 나간다)
const SLOTS = [['voice', 'audio'], ['video', 'video'], ['shareAudio', 'audio']];
const SHARE_BITRATE = 3_000_000;  // 화면 공유 최대 3Mbps(글자가 뭉개지지 않게 해상도 우선)

export function createVoice({ scene, camera, getSelf, getPlayer, getScreens, sameBlock = () => true, onWeather = () => {}, onGallery = () => {} }) {
  const peers = new Map();   // id → { pc, senders, name, sound, el, shareSound, shareEl, video, videoTex, queue }
  let ws = null, wsFor = null, myId = null, speaker = null, wantTalk = false, talking = false, mic = null, micPromise = null, retryAt = 0;
  let sharer = null, sharing = false, wantShare = false, screen = null, localVideo = null, localTex = null, testScreen = null;
  const listener = new THREE.AudioListener(); camera.add(listener);
  const resume = () => { if (listener.context.state !== 'running') listener.context.resume().catch(() => {}); };
  addEventListener('pointerdown', resume, { capture: true });

  // 화면: 보기 전환 버튼 아래 가운데에 "누르고 말하기" · "화면 공유" + 상태 한 줄
  const style = document.createElement('style');
  style.textContent = `.voice-ui{position:absolute;top:92px;left:50%;transform:translateX(-50%);z-index:4;display:flex;align-items:center;gap:6px;padding:5px 12px 5px 5px;background:var(--panel);border:1px solid var(--line);border-radius:8px;backdrop-filter:blur(18px);font-size:11px;color:#eee8dccc;white-space:nowrap;user-select:none}
.voice-ui button{padding:8px 13px;border-radius:4px;background:transparent;font-size:12px;touch-action:none}.voice-ui button[aria-pressed=true]{background:#f1e6d7;color:#293333}.voice-ui button:disabled{opacity:.5;cursor:default}
.voice-ui #voice-status{margin-left:4px}.voice-ui.someone{border-color:var(--accent)}@media(max-width:900px){.voice-ui{top:158px}}@media(max-width:580px){.voice-ui{top:auto;bottom:142px;font-size:10px}}`;   /* 폰: 위쪽은 인원 표시와 겹쳐서 방향 버튼과 아래 버튼 사이 빈칸으로 */
  document.head.append(style);
  const ui = document.createElement('div'); ui.className = 'voice-ui'; ui.setAttribute('role', 'group'); ui.setAttribute('aria-label', '음성·화면 공유');
  ui.innerHTML = '<button id="voice-talk" aria-pressed="false" title="누르고 있는 동안 내 목소리가 모두에게 가요 (T 키)">🎙 누르고 말하기 · T</button>'
    + '<button id="voice-share" aria-pressed="false" title="내 화면을 모두의 TV 화면에 띄워요">🖥 화면 공유</button><span id="voice-status" aria-live="polite">음성 연결 중…</span>';
  (document.getElementById('experience') || document.body).append(ui);
  const button = ui.querySelector('#voice-talk'), shareButton = ui.querySelector('#voice-share'), statusLine = ui.querySelector('#voice-status');
  const canShare = () => !!(testScreen || (window.isSecureContext && navigator.mediaDevices?.getDisplayMedia));
  shareButton.hidden = !navigator.mediaDevices?.getDisplayMedia;   // 휴대폰 브라우저는 화면 공유를 못 한다(보기만)

  // 말하는 사람 머리 위 표시
  const badge = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(241,230,215,.95)'; g.beginPath(); g.roundRect(4, 6, 248, 52, 26); g.fill();
    g.fillStyle = '#293333'; g.font = '600 28px ui-sans-serif,-apple-system,"Apple SD Gothic Neo",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔊 말하는 중', 128, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })); s.scale.set(1.1, .275, 1); s.visible = false; s.renderOrder = 5; return s;
  })();

  const avatarOf = (id) => id === myId ? getPlayer() : scene.getObjectByName(`Visitor_${id}`);
  function place(object, id, y) {
    const avatar = avatarOf(id);
    if (!avatar) { if (object.parent) object.removeFromParent(); return false; }
    if (object.parent !== avatar) avatar.add(object);
    object.position.set(0, y / (avatar.scale.y || 1), 0); return true;
  }

  let serverless = false;   // 서버 없는 공개 페이지(GitHub Pages)면 연결 중이라고 계속 띄우지 않는다
  noServer().then(none => { serverless = none; button.disabled = none; render(); });
  function render() {
    const someone = speaker && speaker.id !== myId, otherShare = sharer && sharer.id !== myId;
    button.setAttribute('aria-pressed', String(talking));
    shareButton.setAttribute('aria-pressed', String(sharing));
    shareButton.textContent = sharing ? '🖥 공유 끄기' : '🖥 화면 공유';
    shareButton.disabled = !sharing && (!!otherShare || !ws || ws.readyState !== WebSocket.OPEN);
    ui.classList.toggle('someone', !!(someone || otherShare));
    let text;
    if (serverless) text = '음성·화면 공유는 로컬 서버에서만 돼요';
    else if (!ws || ws.readyState !== WebSocket.OPEN) text = '음성 연결 중…';
    else if (talking) text = '내 목소리가 모두에게 가는 중';
    else if (someone) text = `🔊 ${speaker.name} 님이 말하는 중`;
    else if (wantTalk) text = '마이크 준비 중…';
    else if (sharing) text = '내 화면이 TV에 나오는 중';
    else if (otherShare) text = `🖥 ${sharer.name} 님 화면 공유 중`;
    else if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) text = '듣기만 돼요 · 마이크는 https 주소에서 켜져요';
    else text = peers.size ? `함께 듣는 사람 ${peers.size}명` : '혼자 있어요 · 다른 사람이 오면 들려요';
    statusLine.textContent = text;
    if (speaker && place(badge, speaker.id, HEAD + .55)) badge.visible = true; else badge.visible = false;
  }

  function send(payload) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
  const micTrack = () => mic?.getAudioTracks()[0] || null;
  const shareTracks = () => ({ video: sharing ? screen?.getVideoTracks()[0] || null : null, shareAudio: sharing ? screen?.getAudioTracks()[0] || null : null });
  function attach(peer, slots = ['voice', 'video', 'shareAudio']) {
    const tracks = { voice: talking ? micTrack() : null, ...shareTracks() };
    for (const slot of slots) {
      const sender = peer.senders[slot]; if (!sender) continue;
      sender.replaceTrack(tracks[slot]).catch(() => {});
      if (slot === 'video' && tracks.video) {
        const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = SHARE_BITRATE; p.degradationPreference = 'maintain-resolution';
        sender.setParameters(p).catch(() => {});
      }
    }
  }
  function setSending(on) {
    talking = on; const track = micTrack(); if (track) track.enabled = on;
    for (const p of peers.values()) attach(p, ['voice']);
    render();
  }

  function playStream(track) {   // Chrome은 원격 WebRTC 소리를 audio 요소에 붙여야 Web Audio로 흐른다(소리는 THREE.Audio로만 낸다)
    const stream = new MediaStream([track]), el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {});
    const sound = new THREE.Audio(listener); sound.setMediaStreamSource(stream); return { el, sound };
  }
  function createPeer(id, name) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection(ICE);
    const peer = { pc, senders: {}, name, sound: null, el: null, shareSound: null, shareEl: null, video: null, videoTex: null, queue: [] };
    peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', to: id, data: { candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => {
      const index = pc.getTransceivers().indexOf(e.transceiver), slot = SLOTS[index]?.[0] || (e.track.kind === 'video' ? 'video' : 'voice');
      if (slot === 'video') {
        peer.video = document.createElement('video'); Object.assign(peer.video, { muted: true, playsInline: true, autoplay: true });
        peer.video.srcObject = new MediaStream([e.track]); peer.video.play().catch(() => {});
        peer.videoTex?.dispose(); peer.videoTex = new THREE.VideoTexture(peer.video); peer.videoTex.colorSpace = THREE.SRGBColorSpace;
      } else if (slot === 'shareAudio') {
        peer.shareSound?.disconnect?.(); Object.assign(peer, (({ el, sound }) => ({ shareEl: el, shareSound: sound }))(playStream(e.track)));
        peer.shareSound.setVolume(0);   // 공유 중일 때만 켠다(아래 setInterval)
      } else {
        peer.sound?.disconnect?.(); Object.assign(peer, playStream(e.track));   // 같은 블록: 거리·방향 없이 같은 크기
        peer.sound.setVolume(sameBlock(id) ? 1 : 0);
      }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); render(); };
    if (myId < id) {   // 아이디가 작은 쪽이 먼저 제안한다(양쪽이 동시에 제안하지 않게)
      for (const [slot, kind] of SLOTS) peer.senders[slot] = pc.addTransceiver(kind, { direction: 'sendrecv' }).sender;
      attach(peer);
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => send({ type: 'signal', to: id, data: { description: pc.localDescription.toJSON() } })).catch(e => console.warn('음성 연결 제안 실패', e));
    }
    render(); return peer;
  }
  function dropPeer(id) {
    const p = peers.get(id); if (!p) return;
    p.pc.close(); p.sound?.disconnect?.(); p.shareSound?.disconnect?.();
    for (const el of [p.el, p.shareEl, p.video]) if (el) el.srcObject = null;
    p.videoTex?.dispose(); peers.delete(id); render();
  }
  async function onSignal(from, data) {
    const peer = peers.get(from) || createPeer(from, '');
    const { pc } = peer;
    try {
      if (data.description) {
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          pc.getTransceivers().forEach((t, i) => { if (!SLOTS[i]) return; t.direction = 'sendrecv'; peer.senders[SLOTS[i][0]] = t.sender; });
          attach(peer);
          await pc.setLocalDescription(await pc.createAnswer());
          send({ type: 'signal', to: from, data: { description: pc.localDescription.toJSON() } });
        }
        for (const c of peer.queue.splice(0)) await pc.addIceCandidate(c);
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else peer.queue.push(data.candidate);
      }
    } catch (e) { console.warn('음성 연결 신호 처리 실패', e); }
  }

  function closeAll() { for (const id of [...peers.keys()]) dropPeer(id); speaker = null; sharer = null; if (talking) setSending(false); if (sharing || wantShare) endShare(false); }
  function connect(id) {
    closeAll(); ws?.close(); wsFor = id; myId = id;
    const url = new URL('voice', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('id', id);
    const socket = ws = new WebSocket(url);
    socket.onopen = render;
    socket.onmessage = (event) => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'voice_welcome') { speaker = m.speaker; sharer = m.sharer ?? null; for (const p of m.peers) createPeer(p.id, p.name); if (m.weather) onWeather(m.weather); if (m.gallery) onGallery(m.gallery, myId); }
      else if (m.type === 'weather') onWeather(m.weather);   // 방 전체 날씨(weather.js) — 같은 채널을 같이 쓴다
      else if (m.type === 'gallery') onGallery(m.gallery, myId);   // 그림 발표(gallery.js)
      else if (m.type === 'voice_join') createPeer(m.id, m.name);
      else if (m.type === 'voice_leave') dropPeer(m.id);
      else if (m.type === 'signal') onSignal(m.from, m.data);
      else if (m.type === 'floor') {
        speaker = m.speaker;
        if (speaker?.id === myId) { if (wantTalk) setSending(true); else send({ type: 'talk', on: false }); }
        else if (talking) setSending(false);
      } else if (m.type === 'talk_denied') { speaker = m.speaker; }
      else if (m.type === 'share_floor') {
        sharer = m.sharer;
        if (sharer?.id === myId) { if (wantShare && screen) { sharing = true; for (const p of peers.values()) attach(p, ['video', 'shareAudio']); } else send({ type: 'share', on: false }); }
        else if (sharing) endShare(false);
      } else if (m.type === 'share_denied') { sharer = m.sharer; endShare(false); statusLine.textContent = `${sharer?.name ?? '다른 사람'} 님이 이미 공유 중이에요`; return; }
      render();
    };
    socket.onclose = () => { if (ws !== socket) return; closeAll(); ws = null; wsFor = null; retryAt = performance.now() + 2000; render(); };
  }

  async function startTalk() {
    resume(); if (wantTalk) return; wantTalk = true; render();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { wantTalk = false; render(); return; }
    try {
      mic ||= await (micPromise ||= navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
    } catch (e) {
      micPromise = null; wantTalk = false; statusLine.textContent = '마이크를 쓸 수 없어요 · 브라우저 마이크 권한을 확인해 주세요'; console.warn(e); return;
    }
    if (!wantTalk) return;   // 권한 창이 떠 있는 사이에 손을 뗐다
    const track = micTrack(); if (track) track.enabled = false;
    send({ type: 'talk', on: true });
  }
  function stopTalk() {
    if (!wantTalk && !talking) return;
    wantTalk = false; if (talking || speaker?.id === myId) send({ type: 'talk', on: false });
    setSending(false);
  }

  // 화면 공유: 브라우저 화면 선택 창 → 서버 발언권 → 모든 연결에 트랙을 끼운다. 브라우저의 "공유 중지"를 눌러도 끝난다
  async function startShare() {
    resume(); if (sharing || wantShare) return;
    if (!canShare()) { statusLine.textContent = '화면 공유는 컴퓨터 브라우저의 https 주소(또는 이 컴퓨터)에서만 돼요'; return; }
    wantShare = true; render();
    // 전체 화면은 빼고 창·브라우저 탭 하나만 고르게 한다(2026-11-02 사용자: "전체 화면모드는 제외하고 하나의 아이템을 보여주는 것으로 해줘...
    // 웹브라우져 등등을 선택 하고 보여줄수 있도록 해줘"). Chrome은 선택 창에서 '전체 화면' 칸을 숨기고, 이 공간 탭 자신도 목록에서 뺀다
    try {
      screen = testScreen || await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 15, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true,
        monitorTypeSurfaces: 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'exclude' });
    } catch (e) { wantShare = false; render(); if (e?.name !== 'NotAllowedError') console.warn(e); return; }   // 선택 창에서 취소
    const video = screen.getVideoTracks()[0];
    if (!video) { endShare(false); return; }
    if (video.getSettings().displaySurface === 'monitor') {   // 위 옵션을 모르는 브라우저(Safari·Firefox)에서 전체 화면을 고른 경우
      endShare(false); statusLine.textContent = '전체 화면은 공유할 수 없어요 · 창이나 브라우저 탭 하나를 골라 주세요'; return;
    }
    video.contentHint = 'detail';
    video.addEventListener('ended', () => endShare(true), { once: true });
    localVideo = document.createElement('video'); Object.assign(localVideo, { muted: true, playsInline: true, autoplay: true }); localVideo.srcObject = new MediaStream([video]); localVideo.play().catch(() => {});
    localTex = new THREE.VideoTexture(localVideo); localTex.colorSpace = THREE.SRGBColorSpace;
    send({ type: 'share', on: true });
  }
  function endShare(notify = true) {
    const was = sharing || wantShare; sharing = false; wantShare = false;
    if (notify && was) send({ type: 'share', on: false });
    for (const p of peers.values()) attach(p, ['video', 'shareAudio']);
    if (screen && screen !== testScreen) for (const t of screen.getTracks()) t.stop();
    screen = null; if (localVideo) localVideo.srcObject = null; localVideo = null; localTex?.dispose(); localTex = null;
    render();
  }

  // 공유 화면을 지금 켜진 TV 위에 덮는다: 돔(POV)이면 같은 곡면, 평면 TV·360°·TV 꺼짐이면 평면 TV 자리. TV와 같은 모양을 조금 안쪽에 그린다
  let overlay = null;
  const inset = new THREE.Matrix4().makeScale(.996, .996, .996);
  function shareMap() {   // 첫 프레임이 오기 전·끝난 직후의 빈 영상은 그리지 않는다(WebGL 'no video' 경고)
    if (!sharer) return null;
    const ready = (video) => video?.readyState >= 2 && video.videoWidth > 0;
    if (sharer.id === myId) return sharing && ready(localVideo) ? localTex : null;
    const peer = peers.get(sharer.id);
    return ready(peer?.video) ? peer.videoTex : null;
  }
  function updateOverlay() {
    const map = shareMap(), s = map && getScreens?.();
    const target = s && (s.on && s.type === 'pov' && s.dome ? { mesh: s.dome, curved: true } : s.flat ? { mesh: s.flat, curved: false } : null);
    if (!target) { if (overlay) overlay.visible = false; return; }
    if (!overlay) {
      overlay = new THREE.Mesh(target.mesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      overlay.name = 'ScreenShare'; overlay.matrixAutoUpdate = false; overlay.frustumCulled = false; overlay.renderOrder = 2; scene.add(overlay);
    }
    if (overlay.geometry !== target.mesh.geometry) overlay.geometry = target.mesh.geometry;
    if (overlay.material.map !== map) { overlay.material.map = map; overlay.material.needsUpdate = true; }
    target.mesh.updateWorldMatrix(true, false);
    overlay.matrix.copy(target.mesh.matrixWorld); if (target.curved) overlay.matrix.multiply(inset);
    overlay.visible = true;
  }
  const frame = () => { updateOverlay(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);

  button.addEventListener('pointerdown', (e) => { e.preventDefault(); button.setPointerCapture(e.pointerId); startTalk(); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, stopTalk);
  shareButton.addEventListener('click', () => { if (sharing || wantShare) endShare(true); else startShare(); });
  const typing = (e) => e.target instanceof Element && e.target.matches('input,textarea,select,[contenteditable]');
  // 한글 자판이면 e.key가 'ㅅ'이라 위치 기준(e.code)으로 받는다
  addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat && !typing(e) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startTalk(); } });
  addEventListener('keyup', (e) => { if (e.code === 'KeyT') stopTalk(); });
  addEventListener('blur', stopTalk);   // 화면 공유는 다른 창으로 가도 계속된다(발표하려고 다른 창을 띄우므로)
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTalk(); });

  // 방 접속(아이디)이 생기거나 바뀌면 음성 채널을 다시 연다. 블록·공유 상태에 따라 소리를 켜고 끈다
  setInterval(() => {
    const self = getSelf();
    if (self?.connected && self.id && self.id !== wsFor && performance.now() >= retryAt) connect(self.id);
    if (!self?.connected && ws) { const old = ws; ws = null; wsFor = null; old.close(); closeAll(); render(); }
    for (const [id, p] of peers) { p.sound?.setVolume(sameBlock(id) ? 1 : 0); p.shareSound?.setVolume(sharer?.id === id && sameBlock(id) ? 1 : 0); }
    render();
  }, 500);
  render();

  return {
    startTalk, stopTalk, startShare, stopShare: () => endShare(true),
    // 날씨 바꾸기를 방 전체에 보낸다. 연결 전이면 false(그때는 내 화면만 바뀐다)
    sendWeather: (kind, level) => { if (ws?.readyState !== WebSocket.OPEN) return false; send({ type: 'weather', kind, level }); return true; },
    sendGallery: (action, count) => { if (ws?.readyState !== WebSocket.OPEN) return false; send({ type: 'gallery', action, count }); return true; },
    myId: () => myId,
    // tv-zoom.js용: TV 위에 덮인 공유 화면과 그 영상 요소
    getShareView: () => overlay?.visible ? { mesh: overlay, source: sharer?.id === myId ? localVideo : peers.get(sharer?.id)?.video } : null,
    getState: () => ({ connected: ws?.readyState === WebSocket.OPEN, id: myId, speaker, talking, wantTalk, sharer, sharing, overlay: !!overlay?.visible,
      secure: window.isSecureContext, audioContext: listener.context.state,
      peers: [...peers].map(([id, p]) => ({ id, name: p.name, connection: p.pc.connectionState, hasAudio: !!p.sound, hasVideo: !!p.video })) }),
    // 검수용: 각 연결에서 받은 소리·화면 바이트
    async stats() {
      const out = {};
      for (const [id, p] of peers) {
        const r = await p.pc.getStats(), row = out[id] = {};
        r.forEach(s => { if (s.type === 'inbound-rtp') { if (s.kind === 'audio') row.audioBytes = (row.audioBytes || 0) + s.bytesReceived; else { row.videoBytes = s.bytesReceived; row.framesDecoded = s.framesDecoded; row.size = [s.frameWidth, s.frameHeight]; } } });
      }
      return out;
    },
    // 검수용: 마이크 대신 440Hz 시험음을 보낸다(마이크 권한 없이 자동 확인할 때)
    useTestTone(volume = .2) {
      const ctx = listener.context, osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 440; gain.gain.value = volume; osc.connect(gain).connect(dest); osc.start(); mic = dest.stream; micPromise = Promise.resolve(mic);
    },
    // 검수용: 화면 선택 창 없이 움직이는 시험 화면(1280×720 캔버스)을 공유한다
    useTestScreen() {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
      const paint = () => { const t = performance.now() / 1000; g.fillStyle = '#123'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#e4c99b'; g.font = '700 96px sans-serif'; g.textAlign = 'center';
        g.fillText('화면 공유 시험', 640, 300); g.font = '64px monospace'; g.fillText(t.toFixed(1), 640, 420); g.fillStyle = '#f55'; g.fillRect(40 + (t * 200) % 1160, 560, 80, 80); };
      paint(); setInterval(paint, 66);   // 뒤에 가려진 탭에서도(느리게나마) 그려지게 타이머로
      testScreen = c.captureStream(15); shareButton.hidden = false;
    },
  };
}
