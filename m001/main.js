import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSoyu } from './dance.js';
import { createMultiplayer } from './multiplayer.js';
import { createAvatarFactory } from './avatars.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const state = { ready:false, action:'idle', actionTime:0, motion:'idle', motionTime:0, mode:'view', view:'tower', heading:-Math.PI, pitch:THREE.MathUtils.degToRad(7), orbit:0, zoom:1, cruise:false, flightTime:0, gait:0, walking:false, stepRemaining:0, stepDirection:1, frames:0, elapsed:0 };
const keys = new Set();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(69,innerWidth/innerHeight,.03,20000);
// 키(2026-11-01 사용자: "리카는 아이고 소유는 어른인데 소유가 더 작아 — 리카 150, 소유 180cm"). v001 리카는 머리 포함 1.786m였다
const RIKA_H=1.50, RIKA_H0=1.786, RIKA_K=RIKA_H/RIKA_H0;
let soyu=null, multiplayer=null; const SOYU_Z=-3.0, SOYU_R=.55, soyuC=new THREE.Vector3();
let profile=null, localAvatar=null, stride=1.25*RIKA_K;
let stageNotice='', stageNoticeUntil=0;
let danceSeeking=false;
let renderer, root, ship, player, character, fit, mixer, walkActions = [], idleTransforms = [], dynamicCameras = [], background, restPlayerY=70.045;
const cruise = new THREE.Group(); scene.add(cruise);
const target = new THREE.Vector3(), desired = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
let previousTime = performance.now();
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (_url,loaded,total) => { $('load-text').textContent=`전망 데크를 준비하고 있어요 · ${loaded} / ${total}`; };
const textureLoader = new THREE.TextureLoader(loadingManager);
const presets = {
 tower:{position:[2.4,1.65,-1],target:[0,15,-100],fov:69.4,kicker:'N SEOUL TOWER',title:'눈앞에 펼쳐진 서울.',description:'유리 난간 너머, 한강과 남산타워를 바라보세요.'},
 yeouido:{position:[.5,1.65,-1.2],target:[-100,2,-1.2],fov:62,kicker:'YEOUIDO',title:'노을 속 금빛 빌딩.',description:'한강 건너 여의도, 63빌딩을 찾아보세요.'},
 hangang:{position:[2.8,1.65,.5],target:[100,.5,-2],fov:59,kicker:'HANGANG',title:'강을 따라 흐르는 오후.',description:'다리를 지나 동쪽으로, 멀리 롯데월드타워까지 이어지는 한강.'},
 overview:{position:[0,5,28],target:[0,7,-10],fov:73.7,kicker:'THE AIRSHIP',title:'우리만의 작은 전망대.',description:'가벼운 부유선이 한강 위에 머뭅니다.'}
};
function fail(error) {
 console.error(error); $('loading').hidden=true; $('join-screen').hidden=true;for(const child of $('experience').children)child.inert=false;$('error').hidden=false;
 $('error-message').textContent=error?.message || 'WebGL을 지원하는 브라우저에서 로컬 실행 주소로 다시 열어주세요.';
}
window.addEventListener('error',e=>{ if(!state.ready) fail(e.error||new Error(e.message)); });
window.addEventListener('unhandledrejection',e=>fail(e.reason));
try {
 renderer = new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
 renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
} catch(error) { fail(new Error('이 브라우저에서 WebGL2를 시작하지 못했어요. Chrome 또는 Safari에서 다시 열어주세요.')); }

const hemi=new THREE.HemisphereLight(0xc9ddf5,0x6c5235,2.4);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffd5a0,3.0);sun.position.set(-25,45,35);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-10,right:10,top:12,bottom:-12,near:1,far:110});sun.shadow.bias=-.0003;sun.shadow.normalBias=.015;scene.add(sun);scene.add(sun.target);
const fill=new THREE.DirectionalLight(0xe1eaff,1.05);fill.position.set(8,12,-18);scene.add(fill);

function createBackground(textures) {
 const uniforms={baseMap:{value:textures[0]},eastMap:{value:textures[1]},northMap:{value:textures[2]},westMap:{value:textures[3]},southMap:{value:textures[4]}};
 const material=new THREE.ShaderMaterial({uniforms,side:THREE.BackSide,depthWrite:false,toneMapped:false,
 vertexShader:`varying vec3 vWorld;void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
 fragmentShader:`
 varying vec3 vWorld;uniform sampler2D baseMap,eastMap,northMap,westMap,southMap;
 const float PI=3.141592653589793;const float TAU=6.283185307179586;
 float wrap(float a){return mod(a+PI,TAU)-PI;}
 vec3 panel(sampler2D image,float a,float center,float e,out float weight){float delta=wrap(a-center);vec2 uv=vec2(.5+delta/1.919862177,.5+e/1.396263402);weight=clamp((.5-abs(uv.x-.5))*7.,0.,1.);return texture2D(image,clamp(uv,0.,1.)).rgb;}
 void main(){vec3 d=vWorld-vec3(0.,1.65,0.);float a=atan(d.x,-d.z);float e=atan(d.y,length(d.xz));vec3 base=texture2D(baseMap,vec2(fract(.5+a/TAU),.5+e/PI)).rgb;float w1,w2,w3,w4;vec3 c1=panel(eastMap,a,0.,e,w1);vec3 c2=panel(northMap,a,-PI*.5,e,w2);vec3 c3=panel(westMap,a,PI,e,w3);vec3 c4=panel(southMap,a,PI*.5,e,w4);vec3 detail=(c1*w1+c2*w2+c3*w3+c4*w4)/max(w1+w2+w3+w4,.0001);float v=clamp((.5-abs(e/1.396263402))*16.,0.,1.);gl_FragColor=vec4(mix(base,detail,v),1.);
 #include <colorspace_fragment>
 }`});
 background=new THREE.Mesh(new THREE.CylinderGeometry(1100,1100,12000,256,24,true),material);background.renderOrder=-2;background.frustumCulled=false;scene.add(background);
 const caps=new THREE.Mesh(new THREE.SphereGeometry(9000,32,24),material);caps.renderOrder=-3;scene.add(caps);
}
function woodTexture() {
 const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#b29970';ctx.fillRect(0,0,512,256);
 let seed=912;const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 for(let i=0;i<850;i++){const y=rand()*256;ctx.strokeStyle=`rgba(${rand()>.5?'80,54,28':'235,214,168'},${.015+rand()*.055})`;ctx.lineWidth=.4+rand()*.6;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(150,y+rand()*3,350,y-rand()*3,512,y+rand()*2);ctx.stroke();}
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
}
function setWalking(active) { state.walking=active; }
function setAction(action, showCamera=true) {
 if(!state.ready||!['idle','walk','wave','dance'].includes(action))return;
 stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);
 state.action=action;state.actionTime=0;
 for(const button of document.querySelectorAll('[data-action]'))button.setAttribute('aria-pressed',String(button.dataset.action===action));
 const labels={idle:'이동키로 산책하거나 동작을 골라보세요.',walk:'제자리에서 걷는 중',wave:'손을 흔들어 인사해요',dance:'춤추는 중'};
 $('action-status').textContent=labels[action];
 if(showCamera)setMode('follow');
 localAvatar.animate(action,0);if(showCamera)canvas.focus({preventScroll:true});
}

function buildIdlePose() {
 // Average opposite walking phases in the exported coordinate system, avoiding A/T-pose differences.
 for(const action of walkActions)action.play();mixer.setTime(0);root.updateMatrixWorld(true);
 const nodes=[];root.traverse(o=>{if(o.isBone || o===fit)nodes.push(o);});
 const first=nodes.map(o=>({object:o,position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()}));
 mixer.setTime(.5);root.updateMatrixWorld(true);
 idleTransforms=first.map(t=>({object:t.object,position:t.position.lerp(t.object.position,.5),quaternion:t.quaternion.slerp(t.object.quaternion,.5),scale:t.scale.lerp(t.object.scale,.5)}));
 for(const action of walkActions)action.stop();
 for(const t of idleTransforms){t.object.position.copy(t.position);t.object.quaternion.copy(t.quaternion);t.object.scale.copy(t.scale);}
 root.updateMatrixWorld(true);character.skeleton.update();character.computeBoundingBox();const box=character.boundingBox.clone().applyMatrix4(character.matrixWorld);const lift=.045-box.min.y;
 const fitIdle=idleTransforms.find(t=>t.object===fit);fitIdle.position.y+=lift;fit.position.copy(fitIdle.position);root.updateMatrixWorld(true);
}
function chooseProfile() {
 const screen=$('join-screen'), form=$('join-form'), nameInput=$('join-name');
 for(const child of $('experience').children)if(child!==screen)child.inert=true;
 try {
  const saved=JSON.parse(localStorage.getItem('seoul-profile'));
  if(saved){nameInput.value=saved.name||'';const character=['rika','soyu','ruby'].includes(saved.character)?saved.character:'rika';document.querySelector(`input[name="character"][value="${character}"]`).checked=true;}
 } catch {}
 let composing=false;
 nameInput.addEventListener('compositionstart',()=>{composing=true;});
 nameInput.addEventListener('compositionend',()=>{composing=false;});
 nameInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.preventDefault();});
 return new Promise(resolve=>{
  form.addEventListener('submit',e=>{
   e.preventDefault();if(composing)return;
   const name=nameInput.value.trim();if(!name){nameInput.focus();return;}
   const p={name:name.slice(0,16),character:new FormData(form).get('character')};
   try{localStorage.setItem('seoul-profile',JSON.stringify(p));}catch{}
   screen.hidden=true;for(const child of $('experience').children)child.inert=false;
   resolve(p);
  });
 });
}
async function init() {
 if(!renderer)return;
 profile=await chooseProfile();
 // 원통 배경: 전체(360°) + 앞(남산타워, 0°)·왼쪽(여의도, −90°)·뒤(강남, 180°)·오른쪽(한강 동쪽, +90°) — 셰이더의 east·north·west·south 칸 순서
 const files=['seoul/seoul-panorama.png','seoul/seoul-tower.png','seoul/seoul-yeouido.png','seoul/seoul-gangnam.png','seoul/seoul-hangang.png'];
 const [textures,gltf,soyuWalking,ruby]=await Promise.all([Promise.all(files.map(async name=>{const t=await textureLoader.loadAsync(`./assets/${name}`);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;})),new GLTFLoader(loadingManager).loadAsync('./assets/airship.glb'),new GLTFLoader(loadingManager).loadAsync('./assets/soyu/walking.glb'),new GLTFLoader(loadingManager).loadAsync('./assets/ruby/ruby.glb')]);
 createBackground(textures);
 const pmrem=new THREE.PMREMGenerator(renderer);textures[0].mapping=THREE.EquirectangularReflectionMapping;const env=pmrem.fromEquirectangular(textures[0]);scene.environment=env.texture;scene.environmentIntensity=.6;pmrem.dispose();
 root=gltf.scene;cruise.add(root);player=root.getObjectByName('Player');ship=root.getObjectByName('Airship');fit=root.getObjectByName('CharacterFit');character=root.getObjectByName('Character');
 if(!player || !character || !fit)throw new Error('데크와 걷는 캐릭터를 읽지 못했어요. 모델 파일을 확인해주세요.');
 restPlayerY=player.position.y;player.scale.setScalar(player.scale.x*RIKA_K);player.position.set(0,restPlayerY,.8);player.rotation.y=state.heading+Math.PI;
 const grain=woodTexture();const glass=new THREE.MeshBasicMaterial({color:0xd5e6ea,transparent:true,opacity:.065,side:THREE.DoubleSide,depthWrite:false});
 root.traverse(o=>{if(!o.isMesh)return;o.castShadow=!o.name.startsWith('Clear_glass')&&!o.name.startsWith('Flush_teak');o.receiveShadow=true;
  if(o.material?.name==='ClearGlass' || o.name.startsWith('Clear_glass')){o.material=glass;o.castShadow=false;}
  else if(o.material?.name.includes('Pale natural teak')) {o.material=o.material.clone();o.material.color.set('#ffffff');o.material.map=grain;o.material.roughness=.78;const position=o.geometry.attributes.position;const uvs=new Float32Array(position.count*2);for(let i=0;i<position.count;i++){uvs[i*2]=position.getX(i)*.24;uvs[i*2+1]=position.getZ(i)*3;}o.geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));}
 });
 character.material=character.material.clone();character.material.metalness=0;character.material.roughness=.85;
 // 소유 무대: 데크 앞쪽(남산타워 쪽) 가운데, 꼬마 출발점을 바라본다. 바닥 높이는 데크에 위에서 광선을 쏴서 잰다
 const deck=[];root.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&!o.name.startsWith('Clear_glass'))deck.push(o);});root.updateMatrixWorld(true);
 const probe=player.parent.localToWorld(new THREE.Vector3(0,restPlayerY,SOYU_Z));const hit=new THREE.Raycaster(probe.clone().setY(probe.y+5),new THREE.Vector3(0,-1,0),0,20).intersectObjects(deck,false)[0];
 const floor=player.parent.worldToLocal((hit?hit.point:probe).clone());
 soyu=await createSoyu({parent:player.parent,renderer,manager:loadingManager,position:new THREE.Vector3(0,floor.y,SOYU_Z),facing:0});
 setupDanceUI();
 mixer=new THREE.AnimationMixer(root);walkActions=gltf.animations.map(clip=>mixer.clipAction(clip));if(!walkActions.length)throw new Error('걷기 동작이 모델에 없습니다.');buildIdlePose();
 const avatarFactory=createAvatarFactory({rika:player,soyu,clips:gltf.animations,soyuWalk:soyuWalking.animations[0],ruby});
 const oldPlayer=player,parent=player.parent,position=player.position.clone();
 mixer.stopAllAction();mixer.uncacheRoot(root);oldPlayer.removeFromParent();
 localAvatar=avatarFactory.create(profile.character);player=localAvatar.avatar;parent.add(player);player.position.copy(position);player.rotation.y=state.heading+Math.PI;
 mixer=localAvatar.mixer;walkActions=localAvatar.actions;idleTransforms=localAvatar.pose;stride=localAvatar.stride??1.25*RIKA_K;
 multiplayer=createMultiplayer({player,camera,getMode:()=>state.mode,profile,avatarFactory,status:$('presence'),
  onStage:(stage,clock)=>soyu.syncRoom(stage,clock),
  onStageError:message=>{stageNotice=message;stageNoticeUntil=performance.now()+3000;},
  onViewStage:()=>{soyu.enableAudio();multiplayer.openChat(false);watchSoyu();},
  onConnection:connected=>{soyu.setRoomConnected(connected);$('dance-play').disabled=!connected;$('dance-seek').disabled=!connected;},
  getLocalState:()=>({x:player.position.x,z:player.position.z,heading:state.heading,gait:state.gait,walking:state.walking,action:state.motion,actionTime:state.motionTime}),
  setSpawn:p=>{player.position.x=p.x;player.position.z=p.z;state.heading=p.heading;player.rotation.y=p.heading+Math.PI;}});
 soyu.bindRoom((command,position)=>multiplayer.controlStage(command,position));
 state.ready=true;$('loading').hidden=true;$('avatar-actions').hidden=false;setMode('follow');previousTime=performance.now();renderer.setAnimationLoop(tick);
 window.multiplayer=multiplayer;
 window.spaceView={getState:()=>({ready:state.ready,mode:state.mode,motion:state.motion,motionTime:state.motionTime,rig:localAvatar.motionState(),view:state.view,cruise:state.cruise,walking:state.walking,heading:state.heading,player:[player.position.x,player.position.y-70,player.position.z],flight:cruise.position.toArray(),gait:state.gait,frames:state.frames,elapsed:state.elapsed,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,clips:walkActions.map(a=>a.getClip()).map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),camera:camera.position.toArray(),dance:soyu&&{time:soyu.time,playing:soyu.playing,duration:soyu.duration,center:soyu.center().toArray(),shared:soyu.sharedState}}),dance:()=>soyu,setView,setMode,setAction,reset,step:()=>step(1)};
}
function setView(name) {
 if(!presets[name])return;stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);state.mode='view';state.view=name;state.orbit=0;state.pitch=0;state.zoom=1;
 const p=presets[name];$('view-kicker').textContent=p.kicker;$('view-title').textContent=p.title;$('view-description').textContent=p.description;
 for(const b of document.querySelectorAll('[data-view]')){const active=b.dataset.view===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
 $('first-person').setAttribute('aria-pressed','false');$('follow').setAttribute('aria-pressed','false');$('watch').setAttribute('aria-pressed','false');updateCamera(1,true);
}
function setMode(mode) {
 if(!state.ready)return;if(mode==='first'||mode==='follow')stopAuto();state.mode=mode;state.orbit=0;state.pitch=THREE.MathUtils.degToRad(7);state.zoom=1;
 $('first-person').setAttribute('aria-pressed',String(mode==='first'));$('follow').setAttribute('aria-pressed',String(mode==='follow'));$('watch').setAttribute('aria-pressed',String(mode==='watch'));
 for(const b of document.querySelectorAll('[data-view]')){b.classList.remove('active');b.setAttribute('aria-pressed','false');}
 $('view-kicker').textContent=mode==='first'?'MY WALK':'MY CHARACTER';$('view-title').textContent=mode==='first'?'내 눈으로 걷는 서울.':`${profile.name}의 서울 산책.`;$('view-description').textContent='W / S 또는 ↑ / ↓로 앞뒤 이동 · A / D 또는 ← / →로 방향 전환';updateCamera(1,true);canvas.focus({preventScroll:true});
}
function move(distance) {
 const x0=player.position.x,z0=player.position.z;
 let x=THREE.MathUtils.clamp(x0+Math.sin(state.heading)*distance,-3.55,3.55),z=THREE.MathUtils.clamp(z0+Math.cos(state.heading)*distance,-6.2,6.2);
 if(Math.abs(x)>2.7 && Math.abs(z)>5.4){const cx=Math.sign(x)*2.7,cz=Math.sign(z)*5.4,dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d>1.10){x=cx+dx/d*1.10;z=cz+dz/d*1.10;}}
 if(soyu){soyu.center(soyuC);const dx=x-soyuC.x,dz=z-soyuC.z,d=Math.hypot(dx,dz);if(d<SOYU_R){const k=SOYU_R/Math.max(d,1e-4);x=soyuC.x+dx*k;z=soyuC.z+dz*k;if(d<1e-4){x=soyuC.x;z=soyuC.z+SOYU_R;}}}   // 춤추는 소유를 지나가지 못하게
 player.position.x=x;player.position.z=z;return Math.hypot(x-x0,z-z0);
}
function step(direction) {if(!state.ready)return;if(state.mode==='view'||state.mode==='watch')setMode('follow');if(state.action!=='idle')setAction('idle',false);state.stepRemaining=.45;state.stepDirection=direction;}
function reset() {if(!state.ready)return;setAction('idle',false);stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);state.heading=-Math.PI;state.pitch=THREE.MathUtils.degToRad(7);state.orbit=0;player.position.set(0,restPlayerY,.8);player.rotation.y=state.heading+Math.PI;cruise.position.set(0,0,0);state.flightTime=0;updateCamera(1,true);}
function updateCamera(dt,immediate=false) {
 if(!state.ready)return;root.updateMatrixWorld(true);player.getWorldPosition(target);forward.set(Math.sin(state.heading),0,Math.cos(state.heading));right.set(Math.cos(state.heading),0,-Math.sin(state.heading));
 if(state.mode==='view'){
  const p=presets[state.view];desired.fromArray(p.position).add(cruise.position);const aim=new THREE.Vector3().fromArray(p.target).add(cruise.position);const direction=aim.sub(desired);direction.applyAxisAngle(new THREE.Vector3(0,1,0),state.orbit);direction.y+=direction.length()*Math.tan(state.pitch);target.copy(desired).add(direction);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov)/2)/Math.max(camera.aspect,1.35)))/state.zoom;
 } else if(state.mode==='watch'){   // 관전: 소유를 가운데, 관람 자리(리카) 어깨 너머 오른쪽 뒤에서. 드래그 = 소유 둘레로 돌기
  soyu.center(soyuC);const c=player.parent.localToWorld(soyuC.clone());c.y-=.1;const a=.32+state.orbit,dist=(WATCH_D+2.7)*state.zoom;
  desired.set(c.x+Math.sin(a)*dist,c.y+.38+Math.sin(state.pitch)*2,c.z+Math.cos(a)*dist);target.copy(c);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(46)/2)/Math.max(camera.aspect,1)));
 } else if(state.mode==='first'){
  desired.copy(target).addScaledVector(forward,.36).add(new THREE.Vector3(0,localAvatar.height-.12,0));target.copy(desired).addScaledVector(forward,20);target.y+=20*Math.tan(state.pitch);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(70)/2)/Math.max(camera.aspect,1.35)))/state.zoom;
 } else {
  const followDirection=forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0),state.orbit);desired.copy(target).addScaledVector(followDirection,-4.2*state.zoom).add(new THREE.Vector3(0,localAvatar.height*1.12+.45+Math.sin(state.pitch)*1.5,0));target.y+=localAvatar.height*.62;camera.fov=58;
 }
 camera.position.lerp(desired,immediate?1:1-Math.exp(-dt*12));camera.lookAt(target);camera.updateProjectionMatrix();localAvatar.visual.visible=state.mode!=='first';
}
function tick(now) {
 if(!state.ready)return;const dt=Math.min(Math.max((now-previousTime)/1000,0),.08);previousTime=now;state.elapsed+=dt;state.frames++;
 if(state.cruise){state.flightTime+=dt;const t=state.flightTime;cruise.position.set(16*Math.sin(t/55),.12*Math.sin(t/5),-10*Math.sin(t/70));}
 let turn=Number(keys.has('a')||keys.has('ArrowLeft'))-Number(keys.has('d')||keys.has('ArrowRight'));
 let direction=Number(keys.has('w')||keys.has('ArrowUp'))-Number(keys.has('s')||keys.has('ArrowDown'));
 if((turn||direction||state.stepRemaining>0)&&state.mode==='view')setMode('follow');
 if((turn||direction||state.stepRemaining>0||auto)&&state.action!=='idle'){state.action='idle';state.actionTime=0;for(const b of document.querySelectorAll('[data-action]'))b.setAttribute('aria-pressed',String(b.dataset.action==='idle'));$('action-status').textContent='이동키로 산책하거나 동작을 골라보세요.';}
 if(auto&&(turn||direction))stopAuto();if(state.mode==='watch'&&(turn||direction))setMode('follow');
 let autoDist=0;if(auto){soyu.center(soyuC);[,autoDist]=autoStep(dt);}
 if(turn)state.heading+=turn*dt*1.65;
 player.rotation.y=state.heading+Math.PI;
 let distance=auto?autoDist:direction*(keys.has('Shift')?1.85:1.1)*dt;
 if(state.stepRemaining>0){distance=state.stepDirection*Math.min(1.1*dt,state.stepRemaining);state.stepRemaining=Math.max(0,state.stepRemaining-Math.abs(distance));}
 const moved=Math.abs(distance)>1e-6?move(distance):0;setWalking(moved>1e-5);
 if(moved>1e-5){state.gait=(state.gait+Math.sign(distance)*moved/stride)%1;if(state.gait<0)state.gait+=1;}
 if(state.action!=='idle'){
  state.actionTime+=dt;
  if(state.action==='wave'&&state.actionTime>=localAvatar.durations.wave)setAction('idle',false);
 }
 state.motion=moved>1e-5?'walk':state.action;
 state.motionTime=moved>1e-5?state.gait*localAvatar.durations.walk:state.action==='walk'?state.actionTime%localAvatar.durations.walk:state.action==='dance'?state.actionTime%localAvatar.durations.dance:state.actionTime;
 localAvatar.animate(state.motion,state.motionTime);
 if((moved>1e-5||turn)&&state.mode==='follow')state.orbit*=Math.exp(-dt*6);
 if(soyu){soyu.update();syncDanceUI();}
 multiplayer?.update(dt);
 root.updateMatrixWorld(true);sun.position.set(-25+cruise.position.x,45+cruise.position.y,35+cruise.position.z);sun.target.position.copy(cruise.position);
 updateCamera(dt);$('altitude').textContent=(70+cruise.position.y).toFixed(state.cruise?1:0);renderer.render(scene,camera);
}
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',()=>setAction(b.dataset.action));
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>state.ready&&setView(b.dataset.view));
$('first-person').addEventListener('click',()=>setMode('first'));$('follow').addEventListener('click',()=>setMode('follow'));$('home').addEventListener('click',reset);$('step').addEventListener('click',()=>step(1));
$('cruise').addEventListener('click',()=>{state.cruise=!state.cruise;$('cruise').setAttribute('aria-pressed',String(state.cruise));$('cruise-text').textContent=state.cruise?'비행 잠시 멈춤':'천천히 비행';$('cruise-symbol').textContent=state.cruise?'Ⅱ':'▷';});
$('help-button').addEventListener('click',()=>{$('help').hidden=!$('help').hidden;$('help-button').setAttribute('aria-expanded',String(!$('help').hidden));});$('close-help').addEventListener('click',()=>{$('help').hidden=true;$('help-button').setAttribute('aria-expanded','false');});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('experience').requestFullscreen();}catch{ $('hint').textContent='브라우저 메뉴에서 전체 화면을 선택해주세요.'; }});$('reload').addEventListener('click',()=>location.reload());
const fmt=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function setupDanceUI(){
 const seek=$('dance-seek');seek.max=soyu.duration.toFixed(2);$('dance-total').textContent=fmt(soyu.duration);
 $('dance-play').addEventListener('click',toggleDance);
 seek.addEventListener('input',()=>{danceSeeking=true;});
 seek.addEventListener('change',()=>{danceSeeking=false;multiplayer?.controlStage('seek',+seek.value);});
 for(const event of ['blur','pointercancel'])seek.addEventListener(event,()=>{danceSeeking=false;});
 $('stage-sound').addEventListener('click',()=>soyu.enableAudio());
 soyu.audio.addEventListener('ended',()=>syncDanceUI());
 $('watch').addEventListener('click',watchSoyu);
 $('dance').hidden=false;
}
function toggleDance(){
 if(!soyu||!multiplayer||$('dance-play').disabled)return;
 if(!soyu.playing)soyu.enableAudio();
 multiplayer.controlStage(soyu.playing?'pause':'play');
}
function syncDanceUI(){
 const p=soyu.playing;$('dance-play').setAttribute('aria-pressed',String(p));$('dance-play').setAttribute('aria-label',p?'소유 일시정지':'소유 플레이');$('dance-play-symbol').textContent=p?'Ⅱ':'▶';$('dance-play-label').textContent=p?'소유 일시정지':'소유 플레이';
 const seek=$('dance-seek');if(!danceSeeking)seek.value=soyu.time.toFixed(2);$('dance-time').textContent=fmt(soyu.time);
 const shared=soyu.sharedState;const text=performance.now()<stageNoticeUntil?stageNotice:!shared?.connected?'방에 연결하는 중…':p?'방 전체 함께 재생 중':soyu.time>=soyu.duration?'공연 끝 · 다시 재생해요':'방 전체 재생·일시정지 공유';
 $('dance-status').textContent=text;$('dance-status').title=shared?.byName?`${shared.byName} 님이 마지막으로 조작했어요`:text;
 $('stage-sound').hidden=!soyu.needsAudioTap;
}
// 관전 모드(2026-11-01 사용자: "관전 모드 누르면 리카는 소유를 바라보는 지정된 자리로 자동 이동"): 소유 앞 WATCH_D m 자리까지 걸어가서 소유를 바라보고 선다.
// 소유 뒤·옆에 있으면 옆으로 돌아서 간다. 방향키를 누르면 자동 이동을 멈춘다.
const WATCH_D=2.4;let auto=null;
function watchSoyu(){
 if(!state.ready||!soyu)return;keys.clear();state.stepRemaining=0;setMode('watch');state.pitch=0;
 soyu.center(soyuC);const px=player.position.x,pz=player.position.z,s=Math.sign(px-soyuC.x)||1,side=soyuC.x+s*1.3,spot=new THREE.Vector2(0,SOYU_Z+WATCH_D);
 const path=pz<soyuC.z+.8?[new THREE.Vector2(side,Math.min(pz,soyuC.z)),new THREE.Vector2(side,soyuC.z+1.3),spot]:[spot];
 auto={path};setWatchUI(true);$('view-kicker').textContent='SPECTATOR';$('view-title').textContent='소유의 무대 앞으로.';$('view-description').textContent='리카가 관람 자리로 걸어가요. ▶를 누르면 소유가 춤춰요.';
}
function stopAuto(){if(!auto)return;auto=null;setWatchUI(false);}
function setWatchUI(){}
function autoStep(dt){   // [회전량, 이동 거리] — 다음 경유점을 향해 돌고 걷는다
 const wp=auto.path[0],dx=wp.x-player.position.x,dz=wp.y-player.position.z,d=Math.hypot(dx,dz);
 let want=Math.atan2(dx,dz),last=auto.path.length===1;
 if(d<.06){if(!last){auto.path.shift();return [0,0];}want=Math.atan2(soyuC.x-player.position.x,soyuC.z-player.position.z);}   // 도착: 소유 쪽으로
 const diff=Math.atan2(Math.sin(want-state.heading),Math.cos(want-state.heading)),turn=THREE.MathUtils.clamp(diff,-2.6*dt,2.6*dt);
 if(d<.06){state.heading+=turn;if(Math.abs(diff)<.02){auto=null;$('view-description').textContent='▶를 누르면 소유가 춤춰요. 드래그하면 둘러볼 수 있어요.';}return [0,0];}
 state.heading+=turn;return [0,Math.abs(diff)<.5?Math.min(1.1*dt,d):0];
}
const controlKeys=new Set(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift']);
 $('chat-input').addEventListener('focus',()=>{keys.clear();state.stepRemaining=0;setWalking(false);stopAuto();});
 addEventListener('keydown',e=>{if(state.ready&&e.key==='Enter'&&!e.isComposing&&!(e.target instanceof Element&&e.target.matches('input,textarea,select,button'))){e.preventDefault();multiplayer.openChat(true,true);}});
addEventListener('keydown',e=>{if(e.target instanceof Element && e.target.matches('input,textarea,select'))return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(controlKeys.has(key)){e.preventDefault();keys.add(key);}if(key===' '&&!(e.target instanceof Element&&e.target.matches('button'))){e.preventDefault();toggleDance();}if(key==='Escape'){keys.clear();state.stepRemaining=0;setWalking(false);}});
addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));addEventListener('blur',()=>{keys.clear();state.stepRemaining=0;setWalking(false);});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();state.stepRemaining=0;setWalking(false);}});
for(const b of document.querySelectorAll('[data-key]')){
 b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>keys.delete(b.dataset.key));
}
let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};if(state.mode==='first')state.heading-=dx*.004;else state.orbit-=dx*.004;state.pitch=THREE.MathUtils.clamp(state.pitch+dy*.003,-.48,.6);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=THREE.MathUtils.clamp(state.zoom*Math.exp(-e.deltaY*.0006),.7,1.6);},{passive:false});
addEventListener('resize',()=>{if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
init().catch(fail);
