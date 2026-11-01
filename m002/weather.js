// 날씨(2026-11-02 사용자: "날씨 기능 추가 가능해?? 눈이 내린다던지 비가 온다던지 태풍이 온다던지.. 에셋 같은거 받아서 추가 가능해?" → "그렇게 진행 해줘",
// "날씨 컨트롤 할수 있도록 해주고.. 아이콘 누르면 나오게.."): 맑음·눈·비·태풍과 세기를 방 전체가 같이 본다(서버 /voice 채널의 weather).
// - 눈·비는 GPU 파티클: 카메라를 둘러싼 상자 안에서 떨어지고, 상자 밖으로 나가면 반대편에서 다시 나온다(무한히 내리는 것처럼). 바람으로 기운다.
// - 하늘: 배경 앞에 반투명 구를 씌워 흐리게, 조명(반구광·햇빛·채움광·환경광)을 낮춘다. 태풍은 번개(하늘 번쩍 + 조명) + 천둥 + 비행선 흔들림.
// - 소리는 받은 파일 없이 브라우저에서 합성한다(빗소리 = 걸러낸 백색 잡음, 바람 = 천천히 흔들리는 갈색 잡음, 천둥 = 낮아지는 잡음 덩어리).
//   라이선스 걱정이 없고 바로 된다. 나중에 실제 녹음(CC0)으로 바꾸려면 SOUND 부분만 오디오 파일 재생으로 바꾸면 된다.
// - 바뀔 때는 2~3초에 걸쳐 서서히 옮겨 간다.
import * as THREE from 'three';

// sky = 하늘 덮개 색·진하기, light = 조명 배율, wind = 바람(m/s, x·z), fall = 떨어지는 속도(m/s)
// cloud = [덮는 비율(0~1), 색, 진하기, 옆으로 흐르는 기본 속도 m/s] — 구름(2026-11-02 사용자: "구름은 안되나?? 구름이 옆으로 지나가는거..")
const PRESETS = {
  clear: { icon: '☀︎', name: '맑음', snow: 0, rain: 0, sky: [0xffffff, 0], light: 1, wind: [0, 0], fall: 0, len: 0, rainSound: 0, windSound: 0, sway: 0, lightning: 0, cloud: [.35, 0xfff1e4, .8, 3] },
  // 첫 판(하늘 .46/.64, 조명 .6/.42, 비 투명도 .55)은 화면에서 너무 약해 보여서 2026-11-02 진하게 올렸다
  snow:  { icon: '❄︎', name: '눈',   snow: 1, rain: 0, sky: [0xe4eaf0, .34], light: .8, wind: [.8, .3], fall: 1.3, len: 0, rainSound: 0, windSound: .18, sway: 0, lightning: 0, cloud: [.75, 0xe6ebf0, .85, 2] },
  rain:  { icon: '☂︎', name: '비',   snow: 0, rain: .7, sky: [0x4f5a66, .6], light: .5, wind: [1.6, .5], fall: 13, len: 1.1, rainSound: .55, windSound: .12, sway: 0, lightning: 0, cloud: [.95, 0x8c959e, .9, 5] },
  storm: { icon: '🌀', name: '태풍', snow: 0, rain: 1, sky: [0x232a32, .78], light: .32, wind: [10, 3.5], fall: 18, len: 1.6, rainSound: .8, windSound: .75, sway: 1, lightning: 1, cloud: [1, 0x49515a, .95, 12] },
};
// 구름 44개: 데크(원점)에서 80~700m 띠 안, 높이 −30~110m(눈높이 근처를 지나가게). 하늘(월드)에 붙어 있어 비행선이 움직이면 사이를 지나간다
// 첫 판(30개, 크기 50~140m, 높이 −40~160m)은 정면에 걸리는 구름이 적고 작아서 늘렸다
const CLOUDS = { count: 44, inner: 80, outer: 700, low: -30, high: 110, size: [70, 190] };
const SNOW = { count: 14000, box: [48, 30, 48], size: .14 };   // 첫 판(7000개, 64m 상자, .09)은 너무 성겨서 늘렸다
const RAIN = { count: 16000, box: [44, 28, 44] };
const FADE = 2.4;   // 날씨가 바뀔 때 옮겨 가는 시간(초)

export function createWeather({ scene, camera, getShip, send }) {
  // ---------- 파티클 ----------
  const wrapGLSL = `vec3 wrapBox(vec3 w){vec3 lo=uCenter-uBox*.5;return lo+mod(w-lo,uBox);}
float edgeFade(vec3 p){vec3 d=abs(p-uCenter)/(uBox*.5);return 1.-smoothstep(.75,1.,max(max(d.x,d.y),d.z));}`;
  function points() {
    const g = new THREE.BufferGeometry(), seed = new Float32Array(SNOW.count * 3), rand = new Float32Array(SNOW.count), speed = new Float32Array(SNOW.count);
    for (let i = 0; i < SNOW.count; i++) { seed.set([Math.random(), Math.random(), Math.random()], i * 3); rand[i] = Math.random(); speed[i] = .6 + Math.random() * .8; }
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3)); g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1)); g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...SNOW.box) }, uOffset: { value: new THREE.Vector3() }, uTime: { value: 0 }, uDensity: { value: 0 }, uSize: { value: SNOW.size }, uScale: { value: 400 } },
      vertexShader: `uniform vec3 uCenter,uBox,uOffset;uniform float uTime,uDensity,uSize,uScale;attribute float aRand,aSpeed;varying float vAlpha;${wrapGLSL}
void main(){vec3 w=position*uBox+uOffset*aSpeed;w.x+=sin(uTime*.8*aSpeed+position.y*40.)*.5;w.z+=cos(uTime*.7*aSpeed+position.x*40.)*.5;
vec3 p=wrapBox(w);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;float on=step(aRand,uDensity);
gl_PointSize=on*uSize*uScale/max(-mv.z,.1);vAlpha=on*edgeFade(p);}`,
      fragmentShader: `varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.15,d)*vAlpha*.9;if(a<.01)discard;gl_FragColor=vec4(1.,1.,1.,a);}`,
    });
    const o = new THREE.Points(g, m); o.frustumCulled = false; o.renderOrder = 3; o.name = 'WeatherSnow'; return o;
  }
  function streaks() {   // 빗줄기 하나 = 선분(머리·꼬리 두 점)
    const n = RAIN.count, g = new THREE.BufferGeometry(), seed = new Float32Array(n * 6), rand = new Float32Array(n * 2), speed = new Float32Array(n * 2), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random()], r = Math.random(), v = .8 + Math.random() * .4;
      seed.set(s, i * 6); seed.set(s, i * 6 + 3); rand[i * 2] = rand[i * 2 + 1] = r; speed[i * 2] = speed[i * 2 + 1] = v; end[i * 2 + 1] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3)); g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1)); g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...RAIN.box) }, uOffset: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: .8 }, uDensity: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: `uniform vec3 uCenter,uBox,uOffset,uDir;uniform float uLen,uDensity;attribute float aRand,aSpeed,aEnd;varying float vAlpha;${wrapGLSL}
void main(){vec3 p=wrapBox(position*uBox+uOffset*aSpeed);p-=uDir*uLen*aSpeed*aEnd;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
vAlpha=step(aRand,uDensity)*edgeFade(p)*(1.-aEnd*.9);}`,
      fragmentShader: `uniform float uFlash;varying float vAlpha;void main(){if(vAlpha<.01)discard;gl_FragColor=vec4(mix(vec3(.82,.87,.94),vec3(1.),uFlash),vAlpha*.85);}`,
    });
    const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.renderOrder = 3; o.name = 'WeatherRain'; return o;
  }
  const snow = points(), rain = streaks();
  // 하늘 덮개: 배경(구 1000m·원통 1100m)보다 안쪽, 데크·TV보다 바깥. 불투명 물체 뒤에서만 보인다
  const sky = new THREE.Mesh(new THREE.SphereGeometry(850, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  sky.renderOrder = -1; sky.frustumCulled = false; sky.name = 'WeatherSky';
  scene.add(snow, rain, sky);

  // ---------- 구름: 부드러운 솜뭉치 그림(아래쪽은 살짝 어둡게) 4~7장을 겹친 덩어리가 바람 방향으로 흘러간다 ----------
  function cloudTexture(seed) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    let s = seed * 7919 + 17; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 24; i++) {
      const x = 56 + rnd() * 144, y = 92 + rnd() * 76, r = 26 + rnd() * 58, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(.55, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-atop';
    const shade = g.createLinearGradient(0, 70, 0, 230); shade.addColorStop(0, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(120,130,142,.55)');
    g.fillStyle = shade; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const cloudTex = [0, 1, 2, 3].map(cloudTexture), clouds = [], cloudGroup = new THREE.Group(); cloudGroup.name = 'WeatherClouds';
  for (let i = 0; i < CLOUDS.count; i++) {
    const group = new THREE.Group(), size = CLOUDS.size[0] + Math.random() * (CLOUDS.size[1] - CLOUDS.size[0]), mats = [], puffs = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < puffs; j++) {
      const m = new THREE.SpriteMaterial({ map: cloudTex[(i + j) % 4], transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const sprite = new THREE.Sprite(m); sprite.renderOrder = 1;
      sprite.scale.set(size * (.7 + Math.random() * .6), size * (.45 + Math.random() * .3), 1);
      sprite.position.set((Math.random() - .5) * size * 1.4, (Math.random() - .5) * size * .25, (Math.random() - .5) * size * .6);
      group.add(sprite); mats.push(m);
    }
    const a = Math.random() * Math.PI * 2, r = CLOUDS.inner + Math.sqrt(Math.random()) * (CLOUDS.outer - CLOUDS.inner);
    group.position.set(Math.cos(a) * r, CLOUDS.low + Math.random() * (CLOUDS.high - CLOUDS.low), Math.sin(a) * r);
    cloudGroup.add(group); clouds.push({ group, mats, r: Math.random(), speed: .7 + Math.random() * .6, alpha: 0 });
  }
  scene.add(cloudGroup);
  const cloudColor = new THREE.Color(0xfff1e4), cloudTarget = new THREE.Color(0xfff1e4), cloudLit = new THREE.Color(), cloudDrift = new THREE.Vector3();

  // ---------- 상태(현재값이 목표값으로 서서히) ----------
  const target = { ...PRESETS.clear, level: .7 }, now = { snow: 0, rain: 0, skyOpacity: 0, light: 1, windX: 0, windZ: 0, fall: 0, len: .8, rainSound: 0, windSound: 0, sway: 0, lightning: 0, cover: 0, cloudOpacity: .8, cloudSpeed: 3 };
  const skyColor = new THREE.Color(0xffffff), skyTarget = new THREE.Color(0xffffff);
  let state = { kind: 'clear', level: .7, byName: '' }, flash = 0, nextBolt = 0, lights = null, envBase = null, t = 0, last = performance.now();
  const snowOffset = new THREE.Vector3(), rainOffset = new THREE.Vector3(), camPos = new THREE.Vector3(), rainVel = new THREE.Vector3(), boltColor = new THREE.Color(0xdde6ff);

  function apply(next) {
    if (!next || !PRESETS[next.kind]) return;
    state = { kind: next.kind, level: Math.max(.2, Math.min(1, Number(next.level) || .7)), byName: next.byName || '' };
    Object.assign(target, PRESETS[state.kind]); skyTarget.set(target.sky[0]); cloudTarget.set(target.cloud[1]);
    nextBolt = performance.now() / 1000 + 2; renderUI();
  }
  function grabLights() {   // main.js 조명 원래 세기를 한 번 기억해 두고 배율만 곱한다
    lights = []; scene.traverse(o => { if (o.isHemisphereLight || o.isDirectionalLight) lights.push({ light: o, base: o.intensity }); });
    envBase = scene.environmentIntensity ?? 1;
  }
  const approach = (cur, to, dt, time = FADE) => cur + (to - cur) * Math.min(1, dt / time * 3);

  function frame() {
    const ms = performance.now(), dt = Math.min(.1, (ms - last) / 1000); last = ms; t += dt;
    const L = state.level, p = target;
    now.snow = approach(now.snow, p.snow * L, dt); now.rain = approach(now.rain, p.rain * (.35 + .65 * L), dt);
    now.skyOpacity = approach(now.skyOpacity, p.sky[1] * (.6 + .4 * L), dt); now.light = approach(now.light, 1 - (1 - p.light) * (.6 + .4 * L), dt);
    now.windX = approach(now.windX, p.wind[0] * (.5 + L), dt); now.windZ = approach(now.windZ, p.wind[1] * (.5 + L), dt);
    now.fall = approach(now.fall, p.fall, dt); now.len = approach(now.len, p.len || now.len, dt);
    now.rainSound = approach(now.rainSound, p.rainSound * L, dt); now.windSound = approach(now.windSound, p.windSound * L, dt);
    now.sway = approach(now.sway, p.sway * L, dt); now.lightning = p.lightning * L;
    skyColor.lerp(skyTarget, Math.min(1, dt / FADE * 3));

    const cam = camera.getWorldPosition(camPos);
    // 눈: 천천히 떨어지며 바람에 흘러감
    snowOffset.x += now.windX * dt; snowOffset.z += now.windZ * dt; snowOffset.y -= (now.fall || 1.3) * dt;
    snow.material.uniforms.uCenter.value.copy(cam); snow.material.uniforms.uOffset.value.copy(snowOffset);
    snow.material.uniforms.uTime.value = t; snow.material.uniforms.uDensity.value = now.snow;
    snow.material.uniforms.uScale.value = innerHeight * Math.min(devicePixelRatio, 1.5) * .5 * camera.projectionMatrix.elements[5];
    snow.visible = now.snow > .002;
    // 비: 바람 방향으로 기울어진 선
    const v = rainVel.set(now.windX, -Math.max(now.fall, 1), now.windZ);
    rainOffset.addScaledVector(v, dt);
    const ru = rain.material.uniforms; ru.uCenter.value.copy(cam); ru.uOffset.value.copy(rainOffset); ru.uDir.value.copy(v).normalize(); ru.uLen.value = now.len; ru.uDensity.value = now.rain;
    rain.visible = now.rain > .002;

    // 번개(태풍): 몇 초마다 하늘이 번쩍, 천둥은 조금 늦게
    const sec = ms / 1000;
    if (now.lightning > .05 && sec > nextBolt) {
      flash = 1; nextBolt = sec + (3 + Math.random() * 9) / (.5 + now.lightning);
      SOUND.thunder(.4 + Math.random() * 2, .5 + .5 * now.lightning);
    }
    flash = Math.max(0, flash - dt * (flash > .5 ? 6 : 2.5));
    const flicker = flash * (.6 + .4 * Math.sin(ms * .09));
    ru.uFlash.value = flicker;
    sky.position.copy(cam); sky.material.opacity = now.skyOpacity * (1 - flicker * .7); sky.material.color.copy(skyColor).lerp(boltColor, flicker); sky.visible = sky.material.opacity > .002;

    if (!lights) grabLights();
    for (const { light, base } of lights) light.intensity = base * (now.light + flicker * 1.4);
    if (envBase !== null) scene.environmentIntensity = envBase * (now.light + flicker);

    // 구름: 바람 방향(맑으면 기본 동쪽으로)으로 흐르고, 띠 밖으로 나가면 반대편에서 다시 나온다. 끝자락에서는 흐려져서 튀지 않는다
    const cl = p.cloud, kindScale = state.kind === 'clear' ? 1 : .55 + .45 * L;
    now.cover = approach(now.cover, cl[0] * kindScale, dt); now.cloudOpacity = approach(now.cloudOpacity, cl[2], dt); now.cloudSpeed = approach(now.cloudSpeed, cl[3] * (.6 + .6 * L), dt);
    cloudColor.lerp(cloudTarget, Math.min(1, dt / FADE * 3)); cloudLit.copy(cloudColor).lerp(boltColor, flicker * .8);
    cloudDrift.set(now.windX, 0, now.windZ); if (cloudDrift.lengthSq() < .01) cloudDrift.set(1, 0, .25); cloudDrift.normalize().multiplyScalar(now.cloudSpeed);
    for (const c of clouds) {
      const pos = c.group.position; pos.addScaledVector(cloudDrift, dt * c.speed);
      let d = Math.hypot(pos.x, pos.z);
      if (d > CLOUDS.outer) { pos.x *= -.98; pos.z *= -.98; d *= .98; }
      const edge = 1 - THREE.MathUtils.smoothstep(d, CLOUDS.outer * .82, CLOUDS.outer);
      c.alpha = approach(c.alpha, (c.r < now.cover ? now.cloudOpacity : 0) * edge, dt, 1.2);
      for (const m of c.mats) { m.opacity = c.alpha; m.color.copy(cloudLit); }
      c.group.visible = c.alpha > .003;
    }

    // 태풍: 비행선이 흔들린다(최대 약 1.3°). 맑아지면 제자리로
    const ship = getShip?.();
    if (ship) { const a = .023 * now.sway; ship.rotation.z = a * (Math.sin(t * .7) + .45 * Math.sin(t * 1.9)); ship.rotation.x = a * .55 * Math.sin(t * .53 + 1); }

    SOUND.set(now.rainSound, now.windSound);
    requestAnimationFrame(frame);
  }

  // ---------- 소리(합성) ----------
  const SOUND = (() => {
    let ctx = null, master = null, rainGain = null, rainHiss = null, windGain = null, on = true;
    try { on = localStorage.getItem('m002-weather-sound') !== 'off'; } catch {}
    function noise(seconds, brown) {
      const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return b;
    }
    function loop(buffer) { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.start(); return s; }
    function start() {
      if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
      ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = on ? 1 : 0; master.connect(ctx.destination);
      const white = noise(2.5, false), brown = noise(5, true);
      // 빗소리: 넓은 쏴아(400Hz~7kHz) + 가까운 톡톡(2.5kHz 대역)
      rainGain = ctx.createGain(); rainGain.gain.value = 0; rainGain.connect(master);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      loop(white).connect(hp).connect(lp).connect(rainGain);
      rainHiss = ctx.createGain(); rainHiss.gain.value = .35; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = .8;
      loop(white).connect(bp).connect(rainHiss).connect(rainGain);
      // 바람: 갈색 잡음을 낮게 거르고, 거르는 높이와 크기를 느리게 흔든다(휘잉)
      windGain = ctx.createGain(); windGain.gain.value = 0; windGain.connect(master);
      const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 500; wlp.Q.value = 3;
      const swell = ctx.createGain(); swell.gain.value = .7; loop(brown).connect(wlp).connect(swell).connect(windGain);
      const lfo = ctx.createOscillator(); lfo.frequency.value = .11; const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 320; lfo.connect(lfoAmt).connect(wlp.frequency); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = .07; const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = .3; lfo2.connect(lfo2Amt).connect(swell.gain); lfo2.start();
      SOUND.brown = brown;
    }
    addEventListener('pointerdown', start, { capture: true }); addEventListener('keydown', start, { capture: true });
    return {
      set(rain, wind) { if (!ctx) return; const k = ctx.currentTime; rainGain.gain.setTargetAtTime(rain * .5, k, .3); windGain.gain.setTargetAtTime(wind * .9, k, .4); },
      thunder(delay, power) {
        if (!ctx || !on) return;
        const k = ctx.currentTime + delay, s = ctx.createBufferSource(); s.buffer = SOUND.brown; s.playbackRate.value = .6 + Math.random() * .3;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1100, k); f.frequency.exponentialRampToValueAtTime(110, k + 3.2);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, k); g.gain.linearRampToValueAtTime(1.6 * power, k + .06); g.gain.exponentialRampToValueAtTime(.4 * power, k + .9); g.gain.exponentialRampToValueAtTime(.001, k + 4.2);
        s.connect(f).connect(g).connect(master); s.start(k); s.stop(k + 4.5);
      },
      toggle() { on = !on; try { localStorage.setItem('m002-weather-sound', on ? 'on' : 'off'); } catch {} if (master) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, .1); return on; },
      get on() { return on; }, get running() { return ctx?.state === 'running'; },
    };
  })();

  // ---------- 아이콘 + 조절판 ----------
  const style = document.createElement('style');
  style.textContent = `.weather-btn{position:absolute;right:40px;top:84px;z-index:6;width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--panel);backdrop-filter:blur(14px);font-size:18px;line-height:1;display:grid;place-items:center;padding:0}
.weather-btn[aria-expanded=true]{background:#f1e6d7;color:#293333}
.weather-panel{position:absolute;right:40px;top:132px;z-index:7;width:262px;padding:12px;border:1px solid var(--line);border-radius:10px;background:rgba(18,28,34,.88);backdrop-filter:blur(18px);color:var(--ink);font-size:12px;transform-origin:top right;transition:opacity .18s ease,scale .18s ease}
.weather-panel[hidden]{display:block;opacity:0;scale:.92;pointer-events:none;visibility:hidden}
.weather-panel h3{margin:0 0 10px;font-size:13px;font-weight:550}.wx-kinds{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.wx-kinds button{display:grid;gap:4px;justify-items:center;padding:9px 0 7px;border-radius:7px;background:rgba(255,255,255,.06);font-size:11px}.wx-kinds button span{font-size:20px;line-height:1}
.wx-kinds button[aria-pressed=true]{background:#f1e6d7;color:#293333}
.wx-level{display:flex;align-items:center;gap:8px;margin:12px 0 4px}.wx-level input{flex:1;accent-color:var(--accent)}
.wx-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;color:var(--muted);font-size:11px}.wx-foot button{padding:6px 9px;border-radius:5px;background:rgba(255,255,255,.08);font-size:11px;white-space:nowrap}
@media(max-width:900px){.weather-btn{right:25px;top:70px}.weather-panel{right:25px;top:116px}}
@media(max-width:580px){.weather-btn{right:19px;top:56px;width:36px;height:36px;font-size:16px}.weather-panel{right:12px;top:98px;width:calc(100% - 24px);max-width:300px}}`;
  document.head.append(style);
  const root = document.getElementById('experience') || document.body;
  const button = Object.assign(document.createElement('button'), { className: 'weather-btn', type: 'button', title: '날씨 바꾸기' });
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'weather-panel');
  const panel = document.createElement('section'); panel.className = 'weather-panel'; panel.id = 'weather-panel'; panel.hidden = true; panel.setAttribute('aria-label', '날씨');
  panel.innerHTML = `<h3>날씨 · 방 전체가 같이 봐요</h3><div class="wx-kinds" role="group" aria-label="날씨 종류">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-kind="${k}" aria-pressed="false"><span>${p.icon}</span>${p.name}</button>`).join('')}</div>
<label class="wx-level">세기 <input type="range" min="20" max="100" step="5" value="70" aria-label="날씨 세기"><b>70%</b></label>
<div class="wx-foot"><span class="wx-by"></span><button type="button" class="wx-sound"></button></div>`;
  root.append(button, panel);
  const levelInput = panel.querySelector('input'), levelText = panel.querySelector('.wx-level b'), byText = panel.querySelector('.wx-by'), soundButton = panel.querySelector('.wx-sound');

  function renderUI() {
    const p = PRESETS[state.kind];
    button.textContent = p.icon; button.setAttribute('aria-label', `날씨: ${p.name} (눌러서 바꾸기)`);
    for (const b of panel.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind));
    if (document.activeElement !== levelInput) levelInput.value = Math.round(state.level * 100);
    levelText.textContent = `${Math.round(state.level * 100)}%`; levelInput.disabled = state.kind === 'clear';
    byText.textContent = state.byName ? `${state.byName} 님이 바꿈` : '';
    soundButton.textContent = SOUND.on ? '🔈 소리 켬' : '🔇 소리 끔';
  }
  function choose(kind, level = state.level) {
    const next = { kind, level, byName: '나' };
    if (!send?.(kind, level)) apply(next);   // 방에 연결돼 있으면 서버가 돌려준 값으로 모두 같이 바뀐다
    else { state = { ...state, kind, level }; Object.assign(target, PRESETS[kind]); skyTarget.set(target.sky[0]); cloudTarget.set(target.cloud[1]); renderUI(); }   // 기다리는 동안 내 화면 먼저
  }
  const toggle = (open = panel.hidden) => { panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
  button.addEventListener('click', () => toggle());
  panel.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) choose(b.dataset.kind); });
  let levelTimer = 0;
  levelInput.addEventListener('input', () => { const level = levelInput.value / 100; levelText.textContent = `${levelInput.value}%`; state.level = level; clearTimeout(levelTimer); levelTimer = setTimeout(() => choose(state.kind, level), 160); });
  soundButton.addEventListener('click', () => { SOUND.toggle(); renderUI(); });
  addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) toggle(false); }, { capture: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });

  renderUI(); requestAnimationFrame(frame);
  return { apply, choose, getState: () => ({ ...state, now: { ...now }, sound: SOUND.on, audio: SOUND.running, flash }) };
}
