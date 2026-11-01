import * as THREE from 'three';

// One room shares avatar motion, speech, stage transport and POV transport.
// Cameras and flight previews belong to each visitor.
export function createMultiplayer({
  player, camera, getMode, profile, avatarFactory, getLocalState, setSpawn, status,
  onStage, onStageError, onConnection, onViewStage,
  onPov, onPovError, onViewPov, getLocalPovProgress,
}) {
  const layer = document.getElementById('speech-layer');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendButton = document.getElementById('chat-send');
  const feedback = document.getElementById('chat-feedback');
  const announcements = document.getElementById('chat-announcement');
  const panel = document.getElementById('chat-panel');
  const toggle = document.getElementById('chat-toggle');
  const unreadBadge = document.getElementById('chat-unread');
  const toast = document.getElementById('stage-notice');
  const toastText = document.getElementById('stage-notice-text');
  const toastView = document.getElementById('stage-notice-view');
  const seenEvents = new Set();
  let toastTimer, toastKind = 'stage';
  const viewStage = () => { if (connected) onViewStage?.(); };
  const viewPov = () => { if (connected) onViewPov?.(false); };
  toastView.addEventListener('click', () => {
    if (toastKind === 'pov') viewPov();
    else viewStage();
  });
  document.getElementById('stage-notice-close').addEventListener('click', () => {toast.hidden=true;clearTimeout(toastTimer);});
  let unread = 0;
  function appendLine(line, notify = false) {
    const atBottom = announcements.scrollHeight - announcements.scrollTop - announcements.clientHeight < 48;
    document.getElementById('chat-empty')?.remove();
    announcements.append(line);
    while (announcements.childElementCount > 100) announcements.firstElementChild.remove();
    if (!panel.hidden && atBottom) announcements.scrollTop = announcements.scrollHeight;
    if (panel.hidden && notify) { unread++; unreadBadge.textContent=unread>99?'99+':String(unread);unreadBadge.hidden=false; }
  }
  function showToast(description, kind = 'stage', durationMs = 6500) {
    toastKind = kind;
    toastView.textContent = kind === 'pov' ? 'POV 보기' : '공연 보기';
    toastView.hidden = false;
    toastText.textContent = description;
    toast.hidden = false;
    clearTimeout(toastTimer);
    if (durationMs > 0) toastTimer = setTimeout(() => { toast.hidden = true; }, durationMs);
  }
  function announceStage(event, historical = false) {
    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);
    if (seenEvents.size > 300) seenEvents.delete(seenEvents.values().next().value);
    const who = event.byName || '누군가';
    const position = `${Math.floor(event.position/60)}:${String(Math.floor(event.position%60)).padStart(2,'0')}`;
    const descriptions = {
      play:`${who} 님이 소유 공연을 재생했습니다. 모두 함께 재생 중이에요.`,
      pause:`${who} 님이 소유 공연을 일시정지했습니다.`,
      seek:`${who} 님이 소유 공연을 ${position} 위치로 옮겼습니다.`,
      ended:'소유 공연이 끝났습니다.',
    };
    const description = descriptions[event.command];
    if (!description) return;
    const line = document.createElement('p');line.className='stage-message';line.dataset.eventId=event.id;
    const stamp = document.createElement('time'), date = new Date(event.timestamp*1000);
    stamp.dateTime=date.toISOString();stamp.textContent=date.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
    const text = document.createElement('span');text.textContent=description;
    line.append(stamp,text);
    if (event.command !== 'ended') {
      const button=document.createElement('button');button.type='button';button.className='stage-view';button.textContent='공연 보기';
      // Join the CURRENT room timeline. Never replay a past chat command.
      button.addEventListener('click',viewStage);line.append(button);
    }
    appendLine(line,!historical);
    if (!historical) showToast(description, 'stage', 6500);
  }
  function announcePov(event, historical = false, pov = null) {
    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);
    if (seenEvents.size > 300) seenEvents.delete(seenEvents.values().next().value);
    const who = event.byName || '누군가';
    const position = `${Math.floor(event.position/60)}:${String(Math.floor(event.position%60)).padStart(2,'0')}`;
    const dlList = pov?.downloading?.length
      ? pov.downloading.map(d => `${d.name} ${d.progress}%`).join(', ')
      : `${pov?.minProgress ?? 0}%`;
    const descriptions = {
      wait:`${who} 님이 POV 함께 보기를 눌렀습니다. 다운로드(${dlList}) 완료 후 동시에 재생됩니다.`,
      play:event.autoReady
        ? `모두 다운로드를 마쳐(${position}) POV 영상을 함께 재생합니다.`
        : `${who} 님이 POV 영상을 재생했습니다. 모두 함께 감상 중이에요.`,
      pause:`${who} 님이 POV 영상을 일시정지했습니다.`,
      seek:`${who} 님이 POV 영상을 ${position} 위치로 옮겼습니다.`,
      ended:'POV 영상 재생이 끝났습니다.',
    };
    const description = descriptions[event.command];
    if (!description) return;
    const line = document.createElement('p');line.className='stage-message pov-message';line.dataset.eventId=event.id;
    const stamp = document.createElement('time'), date = new Date(event.timestamp*1000);
    stamp.dateTime=date.toISOString();stamp.textContent=date.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
    const text = document.createElement('span');text.textContent=description;
    line.append(stamp,text);
    if (event.command !== 'ended') {
      const button=document.createElement('button');button.type='button';button.className='stage-view pov-view';button.textContent='POV 보기';
      button.addEventListener('click',viewPov);line.append(button);
    }
    appendLine(line,!historical);
    if (!historical) {
      showToast(description, 'pov', event.command === 'wait' ? 0 : 6500);
      if (event.command === 'play' || event.command === 'wait') onViewPov?.(true);
    }
  }
  function openChat(open = true, focus = false) {
    panel.hidden = !open;
    document.getElementById('experience').classList.toggle('chat-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '채팅 닫기' : '채팅 열기');
    if (open) {
      unread = 0; unreadBadge.hidden = true;
      requestAnimationFrame(() => { announcements.scrollTop = announcements.scrollHeight; });
      if (focus) input.focus();
    } else if (panel.contains(document.activeElement)) { input.blur(); toggle.focus(); }
  }
  toggle.addEventListener('click', () => openChat(panel.hidden));
  document.getElementById('chat-close').addEventListener('click', () => openChat(false));
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && !panel.hidden) openChat(false);
  });
  const self = { avatar:player, height:profile.character === 'soyu' ? 1.8 : 1.5, speech:'', speechSeq:0 };
  const projected = new THREE.Vector3();
  const remotes = new Map();
  let socket, id = null, connected = false, retry = 0, retryTimer, suspended = false;
  let joinedBefore = false;
  let clockOffset = 0, bestRtt = Infinity, clockReady = false;
  const serverNow = () => performance.now()/1000 + clockOffset;
  function receiveStage(stage, historical = false) {
    if (!stage) return;
    if (!clockReady) clockOffset = stage.serverTime - performance.now()/1000;
    onStage?.(stage, serverNow);
    // The notice and animation use the same authoritative snapshot. Receiving
    // a notice applies room state without sending any command back to the room.
    for (const event of stage.events || []) announceStage(event,historical);
  }
  function receivePov(pov, historical = false) {
    if (!pov) return;
    if (!clockReady) clockOffset = pov.serverTime - performance.now()/1000;
    onPov?.(pov, serverNow);
    for (const event of pov.events || []) announcePov(event, historical, pov);
    if (!toast.hidden && toastKind === 'pov' && pov.waiting && pov.downloading?.length) {
      const dlText = pov.downloading.map(d => `${d.name} ${d.progress}%`).join(', ');
      toastText.textContent = `POV 영상 다운로드 대기 중 (${dlText}) · 다 받으면 동시에 재생됩니다.`;
    }
  }
  function syncClock() {
    if (connected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'clock', sentAt:performance.now()}));
  }
  function controlStage(command, position) {
    if (!connected || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({type:'stage', command, ...(position === undefined ? {} : {position})}));
    return true;
  }
  function controlPov(command, arg) {
    if (!connected || socket?.readyState !== WebSocket.OPEN) return false;
    const payload = { type:'pov', command };
    if (command === 'select') payload.mediaId = String(arg);
    else if (arg !== undefined) payload.position = arg;
    socket.send(JSON.stringify(payload));
    return true;
  }
  function reportPovProgress(progress, ready, duration) {
    if (!connected || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({
      type:'pov_progress',
      progress:Math.max(0, Math.min(100, Math.floor(progress))),
      ready:Boolean(ready),
      ...(Number.isFinite(duration) && duration > 0 ? {duration} : {}),
    }));
    return true;
  }

  function report(text, online = false) {
    if (status.textContent !== text) status.textContent = text;
    status.dataset.online = String(online);
    sendButton.disabled = !online;
  }
  function speech(holder, data, own = false) {
    if (!data.speech) {
      holder.bubble?.remove(); holder.bubble = null; holder.speech = '';
      return;
    }
    if (holder.speechSeq === data.speechSeq && holder.speech === data.speech) return;
    holder.speechSeq = data.speechSeq; holder.speech = data.speech;
    if (!holder.bubble) {
      holder.bubble = document.createElement('div');
      holder.bubble.className = `speech-bubble${own ? ' self' : ''}`;
      layer.append(holder.bubble);
    }
    holder.bubble.textContent = data.speech;
    const line = document.createElement('p'); line.className = own ? 'own' : '';
    const sender = document.createElement('span'); sender.className = 'chat-sender';
    sender.textContent = own ? `${profile.name} (나)` : data.name || `손님 ${data.id.slice(0, 4)}`;
    const stamp = document.createElement('time');
    const now = new Date(); stamp.dateTime = now.toISOString();
    stamp.textContent = now.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit',hour12:false});
    const text = document.createElement('span'); text.textContent = data.speech;
    line.append(stamp, sender, text);
    appendLine(line,!own);
    if (own) feedback.textContent = '보냈어요 · 말풍선은 8초 동안 보여요';
  }
  function placeSpeech(holder, own = false) {
    const bubble = holder.bubble;
    if (!bubble) return;
    holder.avatar.getWorldPosition(projected); projected.y += holder.height + .52;
    projected.project(camera);
    const offscreen = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
    bubble.hidden = offscreen && !own;
    if (bubble.hidden) return;
    const fallback = own && (offscreen || getMode() === 'first');
    const width = layer.clientWidth, height = layer.clientHeight;
    const x = fallback ? width / 2 : (projected.x + 1) * width / 2;
    const y = fallback ? height * .56 : (1 - projected.y) * height / 2;
    const half = bubble.offsetWidth / 2 + 12;
    bubble.style.left = `${THREE.MathUtils.clamp(x, half, width - half)}px`;
    bubble.style.top = `${THREE.MathUtils.clamp(y, bubble.offsetHeight + 18, height - 20)}px`;
  }
  function remove(peer) {
    peer.bubble?.remove();
    peer.mixer.stopAllAction();
    peer.mixer.uncacheRoot(peer.avatar);
    peer.avatar.removeFromParent();
    peer.label.material.map.dispose(); peer.label.material.dispose();
    peer.ring.geometry.dispose(); peer.ring.material.dispose();
    peer.avatar.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    // Mesh geometry and character materials are shared with the local player.
  }
  function clear() {
    for (const peer of remotes.values()) remove(peer);
    remotes.clear();
    self.bubble?.remove(); self.bubble = null; self.speech = ''; self.speechSeq = 0;
  }
  function createPeer(data) {
    const controller = avatarFactory.create(data.character);
    const { avatar, mixer, actions, pose } = controller;
    avatar.name = `Visitor_${data.id}`;
    avatar.position.set(data.x, player.position.y, data.z);
    avatar.rotation.y = data.heading + Math.PI;
    player.parent.add(avatar);
    const color = new THREE.Color().setHSL((parseInt(data.id.slice(0, 4), 16) % 360) / 360, .65, .7);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.31, .35, 32), new THREE.MeshBasicMaterial({ color, side:THREE.DoubleSide, depthWrite:false }));
    // The avatar is scaled to 1.50m; place label/ring in that local coordinate system.
    ring.rotation.x = -Math.PI / 2; ring.position.y = .012; avatar.add(ring);
    const c = document.createElement('canvas'); c.width = 320; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 320, 64);
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'; ctx.shadowBlur = 6;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    const text = data.name || `손님 ${data.id.slice(0, 4)}`;
    ctx.strokeText(text, 160, 32, 304);
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillText(text, 160, 32, 304);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, depthWrite:false, transparent:true }));
    label.position.y = (controller.height + .25) / avatar.scale.y; label.scale.set(1.4, .28, 1); avatar.add(label);
    return { ...controller, label, ring, target:data, walking:false, gait:data.gait };
  }
  function send() {
    if (!connected || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 8192) return;
    const local = getLocalState();
    // Preserve explicit character actions (walk/wave/dance) even when the tab
    // is in the background so other visitors see the button action immediately.
    socket.send(JSON.stringify({ ...local, action:local.action, walking:local.walking && !document.hidden, type:'state' }));
  }
  function connect() {
    if (suspended) return;
    report(retry ? '다시 연결하는 중…' : '함께할 공간에 연결 중…');
    const url = new URL('./ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', profile.name); url.searchParams.set('character', profile.character);
    const povInit = getLocalPovProgress?.();
    if (povInit) {
      url.searchParams.set('povReady', povInit.ready ? '1' : '0');
      url.searchParams.set('povProgress', String(Math.floor(povInit.progress ?? 0)));
    }
    socket = new WebSocket(url);
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        id = message.id; connected = true; retry = 0; clear();
        clockReady = false; bestRtt = Infinity;
        // Reconnecting keeps the visitor's current spot; a fresh visit gets a
        // separate spawn so everyone is visible immediately.
        if (!joinedBefore) setSpawn(message.spawn);
        joinedBefore = true;
        report(`함께 1명 · ${profile.name}`, true);
        onConnection?.(true);
        const curPov = getLocalPovProgress?.();
        if (curPov) reportPovProgress(curPov.progress, curPov.ready, curPov.duration);
        receiveStage(message.stage,true); receivePov(message.pov,true); syncClock();
        feedback.textContent = 'Enter 또는 보내기로 말풍선 띄우기 · 최대 120자';
        send();
      } else if (message.type === 'snapshot' && connected) {
        receiveStage(message.stage);
        receivePov(message.pov);
        const me = message.players.find(p => p.id === id);
        if (me) speech(self, me, true);
        const others = message.players.filter(p => p.id !== id);
        const present = new Set(others.map(p => p.id));
        for (const [key, peer] of remotes) {
          if (!present.has(key)) { remove(peer); remotes.delete(key); }
        }
        for (const data of others) {
          if (!remotes.has(data.id)) remotes.set(data.id, createPeer(data));
          const peer = remotes.get(data.id); peer.target = data; peer.received = performance.now();
          speech(peer, data);
        }
        report(`함께 ${message.players.length}명 · ${profile.name}`, true);
        document.getElementById('chat-count').textContent = `${message.players.length}명`;
      } else if (message.type === 'chat_error') {
        feedback.textContent = message.message;
      } else if (message.type === 'clock') {
        const now = performance.now(), rtt = (now - message.sentAt)/1000;
        if (rtt >= 0 && rtt <= bestRtt * 1.25) {
          clockOffset = message.serverTime - (now/1000 - rtt/2);
          bestRtt = Math.min(bestRtt, rtt); clockReady = true;
        }
      } else if (message.type === 'stage_error') {
        onStageError?.(message.message);
      } else if (message.type === 'pov_error') {
        onPovError?.(message.message);
      }
    };
    socket.onerror = () => {}; // onclose handles offline status and retry.
    socket.onclose = () => {
      connected = false; clear();
      onConnection?.(false);
      toast.hidden=true;clearTimeout(toastTimer);
      report('연결 끊김 · 혼자 산책 중 / 재접속 대기');
      feedback.textContent = '다시 연결되면 말을 보낼 수 있어요';
      if (!suspended) retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
    };
  }
  // Use a Web Worker heartbeat so background tabs are not throttled past the
  // server's 1.5s stale-action window when testing or multitasking across tabs.
  let heartbeatWorker = null, sendTimer = null;
  try {
    const blob = new Blob(['setInterval(()=>postMessage(0),100);'], {type:'text/javascript'});
    heartbeatWorker = new Worker(URL.createObjectURL(blob));
    heartbeatWorker.onmessage = send;
  } catch {
    sendTimer = setInterval(send, 100);
  }
  const clockTimer = setInterval(syncClock, 5000);
  const hide = () => {
    suspended = true; clearTimeout(retryTimer); clearInterval(sendTimer); clearInterval(clockTimer);clearTimeout(toastTimer);
    heartbeatWorker?.terminate();
    socket?.close();
  };
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();
    if (event.key === 'Escape') { event.preventDefault(); openChat(false); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (composing) return;
    const text = input.value.trim();
    if (!text) return;
    if (!connected || socket?.readyState !== WebSocket.OPEN) {
      feedback.textContent = '다시 연결된 뒤 보내 주세요'; return;
    }
    if (socket.bufferedAmount > 8192) { feedback.textContent = '연결이 느려요. 잠시 뒤 다시 보내 주세요'; return; }
    socket.send(JSON.stringify({ type:'chat', text }));
    input.value = ''; feedback.textContent = '보내는 중…';
  });
  addEventListener('pagehide', hide);
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('visibilitychange', send);
  connect();

  return {
    openChat, controlStage, controlPov, reportPovProgress, sendNow:send,
    update(dt) {
      placeSpeech(self, true);
      const alpha = 1 - Math.exp(-dt * 16);
      for (const peer of remotes.values()) {
        const t = peer.target;
        peer.avatar.position.x = THREE.MathUtils.lerp(peer.avatar.position.x, t.x, alpha);
        peer.avatar.position.z = THREE.MathUtils.lerp(peer.avatar.position.z, t.z, alpha);
        const angle = t.heading + Math.PI - peer.avatar.rotation.y;
        peer.avatar.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * alpha;
        const walking = t.walking && performance.now() - peer.received < 1500;
        const age = (performance.now() - peer.received) / 1000;
        const motion = age < 1.5 ? (t.action || (walking ? 'walk' : 'idle')) : 'idle';
        let time = Number.isFinite(t.actionTime) ? t.actionTime : t.gait;
        if (walking) {
          const delta = THREE.MathUtils.euclideanModulo(t.gait - peer.gait + .5, 1) - .5;
          peer.gait = THREE.MathUtils.euclideanModulo(peer.gait + delta * alpha, 1);
          time = peer.gait * peer.durations.walk;
        } else if (motion !== 'idle') {
          if (peer.motion !== motion || !Number.isFinite(peer.motionTime)) {
            peer.motionTime = time;
          } else {
            peer.motionTime += dt;
            if (motion === 'walk' || motion === 'dance') {
              const dur = peer.durations[motion];
              peer.motionTime = peer.motionTime % dur;
              const diff = THREE.MathUtils.euclideanModulo(time - peer.motionTime + dur / 2, dur) - dur / 2;
              if (Math.abs(diff) > .35) peer.motionTime = time;
              else peer.motionTime = THREE.MathUtils.euclideanModulo(peer.motionTime + diff * .15, dur);
            } else if (motion === 'wave') {
              if (Math.abs(time - peer.motionTime) > .35) peer.motionTime = time;
              peer.motionTime = Math.min(peer.motionTime, peer.durations.wave - .001);
            }
          }
          time = peer.motionTime;
        } else {
          time = 0;
        }
        peer.animate(motion, time);peer.motion=motion;peer.motionTime=time;
        peer.walking = walking;
        placeSpeech(peer);
      }
    },
    getState: () => ({ connected, id, profile:{...profile}, count:connected ? remotes.size + 1 : 0, speech:self.speech,
      peers:[...remotes].map(([id, p]) => ({ id, name:p.target.name, character:p.kind, x:p.avatar.position.x, z:p.avatar.position.z,
        heading:p.avatar.rotation.y - Math.PI, walking:p.walking, action:p.motion, actionTime:p.motionTime, rig:p.motionState(), gait:p.gait, speech:p.speech || '',
        povReady:p.target.povReady ?? true, povProgress:p.target.povProgress ?? 100,
        target:{ ...p.target } })) }),
  };
}
