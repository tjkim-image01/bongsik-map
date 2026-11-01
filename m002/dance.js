// 소유 춤 무대(2026-11-01 사용자: "이 공간에서 소유가 노래 틀고 춤추는 모습 추가, 화면에 플레이어 달고",
// "제어는 꼬마 캐릭터로 하고 소유의 춤을 구경하는 거야, 화면에서 플레이 누르면 춤추는 소유").
// 춤은 project/m002/player의 pose(t) 결과(손 21관절·얼굴 기준 손·어깨춤·고개 털기 등 보정 전부)를 30fps로 구운 것(assets/soyu/dance.json).
// 여기서는 프레임 사이를 slerp로 이어 노래(audio.currentTime)에 맞춰 뼈에 넣기만 한다. 다시 굽기: tools/bake-dance.md
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const A = './assets/soyu/';

export async function createSoyu({ parent, renderer, manager, position, facing = 0 }) {
  const [gltf, D, C] = await Promise.all([
    new GLTFLoader(manager).loadAsync(A + 'idol.glb'),
    fetch(A + 'dance.json').then(r => r.json()),
    fetch(A + 'idol-collide.json').then(r => r.json()),
  ]);
  const stage = new THREE.Group(); stage.name = 'SoyuStage';
  stage.position.copy(position); stage.rotation.y = facing; parent.add(stage);
  const model = gltf.scene; stage.add(model);
  let skinned = null;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
    // TRELLIS.2 메시 일부 면 법선이 안쪽을 봐서 각진 검은 조각이 생긴다(m002 기록) → 법선을 늘 카메라 쪽으로
    o.material.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = dot(normal, vViewPosition) < 0.0 ? -normal : normal;'); };
    o.material.needsUpdate = true;
    if (o.isSkinnedMesh && (!skinned || o.geometry.attributes.position.count > skinned.geometry.attributes.position.count)) skinned = o;
  });
  const byName = Object.fromEntries(skinned.skeleton.bones.map(b => [b.name, b]));
  const bones = D.boneNames.map(n => byName[n]);
  if (bones.some(b => !b)) throw new Error('소유 뼈 이름이 춤 데이터와 맞지 않아요.');
  const hips = byName[D.boneNames[0]];
  const hipsP = D.p[D.bones[0]];

  // 검은 야구 모자(m002와 같은 치수: 머리 타원체 ×1.12·×1.24, 챙 12°) — 쉬는 자세에서 놓고 머리 뼈에 붙인다
  model.updateMatrixWorld(true);
  const head = byName['mixamorigHead'];
  if (head && C.head?.radii) {
    const [cx, cy, cz] = C.head.center3, [rx, ry, rz] = C.head.radii;
    const base = cy + .03, ax = rx * 1.12, az = rz * 1.24, h = (cy + ry + .03) - base;
    const mat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: .75, metalness: 0, side: THREE.DoubleSide });
    const hat = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.scale.set(ax, h, az); dome.position.set(cx, base, cz); hat.add(dome);
    const shape = new THREE.Shape(); shape.absellipse(0, 0, ax * .92, az * .95, 0, Math.PI, false);
    const brim = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .006, bevelEnabled: false, curveSegments: 32 }), mat);
    brim.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(12); brim.position.set(cx, base + .004, cz + az * .55); hat.add(brim);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(.012, 16, 8), mat); btn.position.set(cx, base + h, cz); hat.add(btn);
    hat.traverse(o => { o.castShadow = true; o.frustumCulled = false; });
    model.add(hat); hat.updateMatrixWorld(true); head.attach(hat);
  }

  const audio = new Audio(A + 'itsme-32-65s.m4a'); audio.preload = 'auto';
  const N = D.frames, dur = N / D.fps;
  let shared = null, serverNow = () => performance.now()/1000, roomConnected = false, roomControl = null;
  let audioBlocked = false, audioPending = false, audioEpoch = 0;
  const timeline = () => shared ? THREE.MathUtils.clamp(shared.position + (shared.playing ? Math.max(0,serverNow()-shared.serverTime) : 0),0,dur) : Math.min(audio.currentTime,dur);
  const isPlaying = () => shared ? roomConnected && shared.playing && timeline() < dur : !audio.paused;
  function startAudio() {
    if (audioPending) return;
    audioPending = true; const epoch = audioEpoch;
    audio.play().then(() => {if(epoch===audioEpoch)audioBlocked=false;}).catch(error => {
      if(epoch===audioEpoch && isPlaying() && error.name !== 'AbortError')audioBlocked=true;
    }).finally(() => {audioPending=false;});
  }
  function syncAudio(force=false) {
    if (!shared) return;
    const t=timeline(), playing=isPlaying();
    if(!playing){if(!audio.paused)audio.pause();audio.playbackRate=1;}
    const drift=t-audio.currentTime;
    if(force || Math.abs(drift)>.18){audio.currentTime=Math.min(t,dur-.001);audio.playbackRate=1;}
    else if(playing && !audio.paused)audio.playbackRate=THREE.MathUtils.clamp(1+drift*.12,.98,1.02);
    if(playing && audio.paused && !audioBlocked)startAudio();
  }
  function enableAudio() {
    // Call from a real click, before the WebSocket round trip, to unlock audio
    // on phones. The dance itself always follows the room clock.
    audioBlocked=false; audio.currentTime=timeline()>=dur-.05?0:timeline();
    const epoch=audioEpoch;
    return audio.play().then(()=>{if(epoch===audioEpoch)audioBlocked=false;}).catch(error=>{
      if(error.name!=='AbortError')audioBlocked=true;
    });
  }
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function apply(t) {
    const f = THREE.MathUtils.clamp(t * D.fps, 0, N - 1.0001), i = Math.floor(f), a = f - i, r0 = D.q[i], r1 = D.q[i + 1];
    for (let k = 0; k < bones.length; k++) {
      qa.set(r0[4 * k], r0[4 * k + 1], r0[4 * k + 2], r0[4 * k + 3]);
      qb.set(r1[4 * k], r1[4 * k + 1], r1[4 * k + 2], r1[4 * k + 3]);
      bones[k].quaternion.slerpQuaternions(qa, qb, a);
    }
    hips.position.set(
      hipsP[3 * i] + (hipsP[3 * i + 3] - hipsP[3 * i]) * a,
      hipsP[3 * i + 1] + (hipsP[3 * i + 4] - hipsP[3 * i + 1]) * a,
      hipsP[3 * i + 2] + (hipsP[3 * i + 5] - hipsP[3 * i + 2]) * a);
  }
  const restPose = skinned.skeleton.bones.map(b => ({name:b.name, position:b.position.clone(), quaternion:b.quaternion.clone(), scale:b.scale.clone()}));
  apply(0);
  const hp = new THREE.Vector3();
  return {
    stage, model, restPose, motionData:D, audio, duration: dur,
    get time() { return timeline(); },
    get playing() { return isPlaying(); },
    get needsAudioTap() { return isPlaying() && audioBlocked; },
    get sharedState() { return shared && {...shared, connected:roomConnected, time:timeline(), audioPlaying:!audio.paused, audioBlocked}; },
    bindRoom(control) { roomControl=control; },
    setRoomConnected(connected) {
      roomConnected=connected;
      if(!connected && shared){shared={...shared,position:timeline(),playing:false,serverTime:serverNow()};audioEpoch++;audio.pause();}
    },
    syncRoom(state, clock) {
      const changed=!shared || shared.revision!==state.revision;
      if(changed)audioEpoch++;
      shared={...state};serverNow=clock;
      syncAudio(changed);apply(Math.min(timeline(),dur-.001));
    },
    enableAudio,
    play() { if(roomControl)return Promise.resolve(roomControl('play'));if(audio.currentTime>=dur-.05)audio.currentTime=0;return audio.play(); },
    pause() { if(roomControl)return roomControl('pause');audio.pause(); },
    seek(t) { if(roomControl)return roomControl('seek',t);audio.currentTime=THREE.MathUtils.clamp(t,0,dur);apply(audio.currentTime); },
    update() { syncAudio();apply(Math.min(timeline(),dur-1e-3)); },
    // 꼬마가 지나가지 못하게: 지금 소유 엉덩이의 바닥 위치(부모 좌표)
    center(out = new THREE.Vector3()) { stage.updateMatrixWorld(true); hips.getWorldPosition(hp); return parent.worldToLocal(out.copy(hp)); },
  };
}
