// 서버 없는 공개 페이지(GitHub Pages)의 혼자 보기 방(2026-11-02 사용자: "가 코딩 해줘" — 공개 주소에서 소유 공연·POV 버튼이 꺼져 있던 문제).
// serve.py가 하던 소유 공연·POV 재생 상태(control_stage·stage_snapshot·control_pov·pov_snapshot)를 이 브라우저 안에서 그대로 흉내 낸다.
// 상태 모양이 서버 snapshot과 같아서 multiplayer.js·main.js·dance.js는 서버가 있을 때와 같은 길로 돈다(시계도 같은 performance.now 기준).
// 함께 접속·채팅·음성·화면 공유는 서버가 있어야 해서 여기서는 하지 않는다.

let probe = null;
// 서버가 없는 정적 호스팅인가: 서버 API가 응답은 오는데 실패(404)하거나 JSON이 아니면 서버가 없는 것.
// 네트워크 오류(로컬 서버가 잠깐 꺼짐)는 서버 있음으로 보고 기존처럼 다시 붙기를 기다린다
export function noServer() {
  probe ??= fetch('./api/network-info', { cache: 'no-store' })
    .then(r => !r.ok || !(r.headers.get('content-type') || '').includes('json'))
    .catch(() => false);
  return probe;
}

// getMedia가 없으면(m001) 소유 공연만 다룬다
export function createSoloRoom({ name, getMedia, mediaId, onStage, onPov }) {
  const now = () => performance.now() / 1000;
  const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  function event(s, command, position, extra = {}) {
    s.events.push({ id: uid(), command, byName: name, position, playing: s.playing, revision: s.revision, timestamp: Date.now() / 1000, ...extra });
    s.events.splice(0, s.events.length - 50);
  }

  const stage = { playing: false, position: 0, duration: 33, anchor: now(), revision: 0, byName: '', events: [] };
  function stageSnap(t = now()) {
    const position = stage.position + (stage.playing ? t - stage.anchor : 0);
    if (position >= stage.duration && stage.playing) {
      Object.assign(stage, { position: stage.duration, playing: false, anchor: t, revision: stage.revision + 1 });
      event(stage, 'ended', stage.duration, { byName: '' });
    }
    return { playing: stage.playing, position: Math.min(position, stage.duration), duration: stage.duration, revision: stage.revision,
      byName: stage.byName, serverTime: t, events: [...stage.events] };
  }
  function controlStage(command, position) {
    if (!['play', 'pause', 'seek'].includes(command) || (command === 'seek' && !Number.isFinite(position))) return false;
    const t = now(), cur = stageSnap(t);
    if (!((command === 'play' && cur.playing) || (command === 'pause' && !cur.playing))) {
      let pos = command === 'seek' ? Math.max(0, Math.min(stage.duration, position)) : cur.position, playing = cur.playing;
      if (command === 'play') { if (pos >= stage.duration - .05) pos = 0; playing = true; }
      else if (command === 'pause') playing = false;
      else if (pos >= stage.duration) playing = false;
      Object.assign(stage, { position: pos, playing, anchor: t, revision: stage.revision + 1, byName: name });
      event(stage, command, pos);
    }
    onStage(stageSnap(), now);
    return true;
  }

  // POV: 서버처럼 "내가 다 받았는지"를 기다렸다가 재생한다(방에 나 하나)
  const first = getMedia?.(mediaId);
  const pov = first && { playing: false, waiting: false, position: 0, duration: first.duration, mediaId, mediaType: first.type, mediaName: first.title,
    anchor: now(), revision: 0, byName: '', events: [] };
  let ready = false, progress = 0;
  function povSnap(t = now()) {
    let position = pov.position + (pov.playing ? t - pov.anchor : 0);
    if (position >= pov.duration && pov.playing) {
      Object.assign(pov, { position: pov.duration, playing: false, waiting: false, anchor: t, revision: pov.revision + 1 });
      event(pov, 'ended', pov.duration, { byName: '', waiting: false });
      position = pov.duration;
    }
    if (pov.playing && !ready) {
      Object.assign(pov, { position: Math.min(position, pov.duration), playing: false, waiting: true, anchor: t, revision: pov.revision + 1 });
      event(pov, 'wait', pov.position, { waiting: true });
      position = pov.position;
    } else if (pov.waiting && ready) {
      Object.assign(pov, { playing: true, waiting: false, anchor: t, revision: pov.revision + 1 });
      event(pov, 'play', pov.position, { byName: pov.byName, waiting: false, autoReady: true });
      position = pov.position;
    }
    return { playing: pov.playing, waiting: pov.waiting, position: Math.min(position, pov.duration), duration: pov.duration, revision: pov.revision,
      byName: pov.byName, serverTime: t, mediaId: pov.mediaId, mediaType: pov.mediaType, mediaName: pov.mediaName,
      ready, minProgress: ready ? 100 : progress, downloading: ready ? [] : [{ id: 'me', name, progress }], events: [...pov.events] };
  }
  function controlPov(command, arg) {
    if (!pov) return false;
    const t = now(), cur = povSnap(t);
    if (command === 'select') {
      const meta = getMedia(arg); if (!meta) return false;
      Object.assign(pov, { mediaId: arg, mediaType: meta.type, mediaName: meta.title, duration: meta.duration, position: 0, playing: false, waiting: false,
        anchor: t, revision: pov.revision + 1, byName: name });
      event(pov, 'select', 0, { mediaId: arg, mediaType: meta.type, mediaName: meta.title });
    } else if (['play', 'pause', 'seek'].includes(command)) {
      if (command === 'seek' && !Number.isFinite(arg)) return false;
      if (!((command === 'play' && (cur.playing || cur.waiting)) || (command === 'pause' && !cur.playing && !cur.waiting))) {
        let pos = command === 'seek' ? Math.max(0, Math.min(pov.duration, arg)) : cur.position, playing = cur.playing, waiting = cur.waiting;
        if (command === 'play') { if (pos >= pov.duration - .05) pos = 0; playing = ready; waiting = !ready; }
        else if (command === 'pause') playing = waiting = false;
        else if (pos >= pov.duration) playing = waiting = false;
        Object.assign(pov, { position: pos, playing, waiting, anchor: t, revision: pov.revision + 1, byName: name });
        event(pov, command === 'play' && waiting ? 'wait' : command, pos, { waiting });
      }
    } else return false;
    onPov(povSnap(), now);
    return true;
  }
  function reportPovProgress(p, r, duration) {
    if (!pov) return false;
    if (Number.isFinite(duration) && duration >= 1 && duration <= 3600) pov.duration = duration;
    ready = Boolean(r); progress = ready ? 100 : Math.max(0, Math.min(99, Math.floor(p)));
    onPov(povSnap(), now);
    return true;
  }

  // 서버가 주기적으로 보내던 snapshot 대신(끝남·다운로드 완료 뒤 자동 재생을 알아챈다)
  const timer = setInterval(() => { onStage(stageSnap(), now); if (pov) onPov(povSnap(), now); }, 250);
  return { controlStage, controlPov, reportPovProgress, stage: () => stageSnap(), pov: () => pov && povSnap(), stop: () => clearInterval(timer) };
}
