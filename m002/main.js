import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSoyu } from './dance.js';
import { createMultiplayer } from './multiplayer.js';
import { askBigDownload } from './download-guard.js';
import { noServer } from './solo-room.js';
import { createDock } from './ui-dock.js';
import { createAvatarFactory } from './avatars.js';
import { createVoice } from './voice.js';
import { createTvZoom } from './tv-zoom.js';
import { createWeather } from './weather.js';
import { createGallery } from './gallery.js';
import { createLayeredPanorama } from './layered-panorama.js';
import './ui-motion.js';   // 화면 정리: 숨길 때 가장자리로 물결처럼 빠지는 움직임 + 모바일 숨기기/보이기 버튼

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const state = { ready:false, action:'idle', actionTime:0, actionStartedAt:0, motion:'idle', motionTime:0, mode:'view', view:'tower', heading:-Math.PI, pitch:THREE.MathUtils.degToRad(7), orbit:0, zoom:1, cruise:false, flightTime:0, gait:0, walking:false, stepRemaining:0, stepDirection:1, frames:0, elapsed:0 };
const keys = new Set();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(69,innerWidth/innerHeight,.03,20000);
// 키(2026-11-01 사용자: "리카는 아이고 소유는 어른인데 소유가 더 작아 — 리카 150, 소유 180cm"). v001 리카는 머리 포함 1.786m였다
const RIKA_H=1.50, RIKA_H0=1.786, RIKA_K=RIKA_H/RIKA_H0;
let soyu=null, multiplayer=null; const SOYU_Z=-3.0, SOYU_R=.55, soyuC=new THREE.Vector3();
let profile=null, localAvatar=null, stride=1.25*RIKA_K;
let stageNotice='', stageNoticeUntil=0, povNotice='', povNoticeUntil=0;
let danceSeeking=false, povSeeking=false;
let renderer, root, ship, player, deckMeshes = [], character, fit, mixer, walkActions = [], idleTransforms = [], dynamicCameras = [], background, restPlayerY=70.045;
const cruise = new THREE.Group(); scene.add(cruise);
const target = new THREE.Vector3(), desired = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
let previousTime = performance.now();
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (_url,loaded,total) => { $('load-text').textContent=`전망 데크를 준비하고 있어요 · ${loaded} / ${total}`; };
const textureLoader = new THREE.TextureLoader(loadingManager);
// 전망 카메라 자리: 앞(−z, 소유 무대 쪽)·왼쪽(−x)·오른쪽(+x)·전체. 글은 배경마다 BACKGROUNDS[].views에서 채운다
const presets = {
 tower:{position:[2.4,1.65,-1],target:[0,2,-100],fov:69.4},
 yeouido:{position:[.5,1.65,-1.2],target:[-100,2,-1.2],fov:62},
 hangang:{position:[2.8,1.65,.5],target:[100,.5,-2],fov:59},
 overview:{position:[0,5,28],target:[0,7,-10],fov:73.7}
};
// 배경 목록. 서울 = m001 원통 그림(전체·앞·왼쪽·뒤·오른쪽 순), 나머지 = 360° 영상(Wikimedia Commons, CC BY 3.0).
// frontU = 정면(−z)에 둘 영상 가로 위치(0~1). views = [버튼, 작은 제목, 제목, 설명]. sun = 햇빛 색
const BACKGROUNDS = {
 alpine_layers:{short:'입체 산맥',name:'구름 위 산맥',eyebrow:'ALPINE DAWN · LAYERED IMAGE PANORAMA',tagline:'그림 사이를 흐르는 바람, 걸을 때 달라지는 풍경.',sun:0xffdfb4,
  layersManifest:'./assets/layered-alpine/manifest.json',
  credit:'배경: 이 공간용 AI 생성 파노라마 3장 + 벡터 안개 · 하늘·먼 산·구름·가까운 능선의 4겹 시차',
  views:{tower:['산맥과 계곡','LAYERED MOUNTAINS','그림 사이에 깊이가 생겨요.','산책하거나 천천히 비행하면 가까운 능선과 먼 산이 서로 다르게 움직여요.'],
   yeouido:['아침빛','GOLDEN DAWN','구름 위로 번지는 아침.','서로 다른 거리의 이미지가 하나의 풍경으로 겹쳐집니다.'],
   hangang:['가까운 능선','NEAR RIDGE','손에 닿을 듯한 능선.','미디어 & 배경 센터에서 입체 강도를 바꾸고 정지 화면과 비교해 보세요.'],
   overview:['부유선 전체','THE AIRSHIP','산맥 사이의 작은 전망대.','천천히 비행을 켜면 층마다 다른 움직임을 더 쉽게 느낄 수 있어요.']}},
 paris:{short:'파리',name:'파리 상공',eyebrow:'PARIS · EIFFEL TOWER 360°',tagline:'세느강 위, 에펠탑과 파리 시내를 내려다보는 시간.',sun:0xffe4b5,
  files:['paris/paris-panorama-reference.png','paris/paris-eiffel.png','paris/paris-montmartre.png','paris/paris-west.png','paris/paris-river.png'],
  credit:'배경 그림: 파리 상공 파노라마 5분할 고해상도 원통 쉐이더 (m001/v002)',
  views:{tower:['에펠탑','EIFFEL TOWER','파리의 상징 에펠탑.','유리 난간 너머, 센강과 장엄한 에펠탑을 바라보세요.'],
   yeouido:['몽마르트르','MONTMARTRE','언덕 위 사크레쾨르.','하얀 돔 성당이 파리 북쪽 하늘에 우뚝 서 있어요.'],
   hangang:['센강','SEINE RIVER','파리를 가로지르는 강.','유려하게 굽이치는 센강과 고풍스러운 오스만 지붕들.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 파리 하늘 위에 고요히 머뭅니다.']}},
  seoul:{short:'서울',name:'서울 상공',eyebrow:'ABOVE THE HAN RIVER',tagline:'조금 천천히, 도시를 바라보는 시간.',sun:0xffd5a0,
  files:['seoul/seoul-panorama.png','seoul/seoul-tower.png','seoul/seoul-yeouido.png','seoul/seoul-gangnam.png','seoul/seoul-hangang.png'],
  credit:'배경 그림: 서울 원통 파노라마(m001, ChatGPT로 그림)',
  views:{tower:['남산타워','N SEOUL TOWER','눈앞에 펼쳐진 서울.','유리 난간 너머, 한강과 남산타워를 바라보세요.'],
   yeouido:['여의도','YEOUIDO','노을 속 금빛 빌딩.','한강 건너 여의도, 63빌딩을 찾아보세요.'],
   hangang:['한강','HANGANG','강을 따라 흐르는 오후.','다리를 지나 동쪽으로, 멀리 롯데월드타워까지 이어지는 한강.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','가벼운 부유선이 한강 위에 머뭅니다.']}},
 bled:{short:'블레드',name:'블레드 호수',eyebrow:'LAKE BLED · 360° VIDEO',tagline:'조금 천천히, 호수를 바라보는 시간.',sun:0xfff2dc,video:'./assets/bled/bled-lake-360.webm',poster:'./assets/bled/bled-poster.jpg',frontU:.95,
  credit:['Video 360°. Timelapse. Bled Lake in Slovenia','Fabio Casati','https://commons.wikimedia.org/wiki/File:Video_360%C2%B0._Timelapse._Bled_Lake_in_Slovenia..webm'],
  views:{tower:['호수와 섬','BLED ISLAND','호수 위의 작은 섬.','유리 난간 너머, 블레드 호수와 섬 위 성당을 바라보세요.'],
   yeouido:['호숫가','LAKESIDE','나무 그늘 아래 호숫가.','자전거가 쉬어 가는 물가, 잎 사이로 햇살이 내려요.'],
   hangang:['숲길','FOREST PATH','숲길을 걷는 사람들.','호수를 따라 이어지는 산책로, 앞쪽 언덕 위에 블레드 성이 보여요.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','가벼운 부유선이 블레드 호숫가에 머뭅니다.']}},
 // 패러글라이더 조종사와 날개가 영상 가로 0.65~0.95에 늘 붙어 있어 정면을 반대쪽 설산(0.3)으로 둔다 — 조종사는 데크 뒤쪽에 보인다
 tolmin:{short:'톨민 하늘',name:'톨민 상공',eyebrow:'TOLMIN · PARAGLIDING 360°',tagline:'패러글라이더와 함께 산 위를 나는 시간.',sun:0xfff2dc,video:'./assets/tolmin/tolmin-paragliding-360.webm',poster:'./assets/tolmin/tolmin-poster.jpg',frontU:.3,
  credit:['2021 06 12 PARA 360 Tolmin SokoleONE 2 - UP Kangri','Sokole ONE','https://commons.wikimedia.org/wiki/File:2021_06_12_PARA_360_Tolmin_SokoleONE_2_-_UP_Kangri.webm'],
  views:{tower:['설산','SNOWY PEAKS','눈 남은 봉우리 위로.','난간 너머, 눈이 남은 바위 봉우리를 내려다보세요.'],
   yeouido:['능선','RIDGE','구름에 걸린 능선.','바위 능선 위로 구름이 흘러가요.'],
   hangang:['계곡','GREEN VALLEY','멀리 열린 초록 계곡.','산 사이로 길게 이어지는 계곡과 지평선.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','가벼운 부유선이 패러글라이더와 나란히 산 위를 날아요.']}},
 haor:{short:'하오르',name:'하오르 밤하늘',eyebrow:'HAOR · DARK SKY 360°',tagline:'어두운 밤, 호수 위에 별이 뜨는 시간.',sun:0x7090b8,poster:'./assets/haor/dark-sky-planet.jpg',frontU:.5,
  credit:['#littleplanet #littleworld #haor #dark #sky','Nasir Khan Saikat','https://commons.wikimedia.org/wiki/File:-littleplanet_-littleworld_-haor_-dark_-sky_(38077258122).jpg'],
  views:{tower:['밤하늘','DARK SKY','별빛 아래 고요한 호수.','유리 난간 너머, 깊은 밤하늘과 수면을 바라보세요.'],
   yeouido:['물가','LAKESIDE','어둠 속에 잠긴 수평선.','고요한 습지 위로 번지는 은은한 빛.'],
   hangang:['은하수','STARRY NIGHT','밤하늘을 가로지르는 별들.','먼 지평선 위로 펼쳐지는 밤의 파노라마.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','가벼운 부유선이 밤하늘 아래 고요히 머뭅니다.']}},
 kloofendal:{short:'클루펜달',name:'클루펜달 언덕',eyebrow:'KLOOFENDAL 48D PARTLY CLOUDY · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xfff0dd,poster:'./assets/panoramas/kloofendal.jpg',frontU:.5,
  credit:['Kloofendal 48d Partly Cloudy','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 sunflowers:{short:'해바라기',name:'해바라기 들판',eyebrow:'SUNFLOWERS FIELD · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xffeed5,poster:'./assets/panoramas/sunflowers.jpg',frontU:.5,
  credit:['Sunflowers Field','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 cape_hill:{short:'케이프 ',name:'케이프 해안 언덕',eyebrow:'CAPE HILL OCEAN VIEW · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xfff6eb,poster:'./assets/panoramas/cape_hill.jpg',frontU:.5,
  credit:['Cape Hill Ocean View','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 kiara_dawn:{short:'키아라 ',name:'키아라 산맥 일출',eyebrow:'KIARA 1 DAWN · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xffcf99,poster:'./assets/panoramas/kiara_dawn.jpg',frontU:.5,
  credit:['Kiara 1 Dawn','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 spruit_sunrise:{short:'스프루이',name:'스프루이트 강변 일출',eyebrow:'SPRUIT SUNRISE RIVER · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xffd7aa,poster:'./assets/panoramas/spruit_sunrise.jpg',frontU:.5,
  credit:['Spruit Sunrise River','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 rural_landscape:{short:'평화로운',name:'평화로운 시골 전원',eyebrow:'RURAL LANDSCAPE · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xfff0dc,poster:'./assets/panoramas/rural_landscape.jpg',frontU:.5,
  credit:['Rural Landscape','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 satara_night:{short:'사타라 ',name:'사타라 은하수 밤하늘',eyebrow:'SATARA NIGHT MILKY WAY · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0x5878a8,poster:'./assets/panoramas/satara_night.jpg',frontU:.5,
  credit:['Satara Night Milky Way','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 syferfontein:{short:'자이퍼폰',name:'자이퍼폰테인 맑은 하늘',eyebrow:'SYFERFONTEIN CLEAR SKY · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xfff8ee,poster:'./assets/panoramas/syferfontein.jpg',frontU:.5,
  credit:['Syferfontein Clear Sky','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 green_sanctuary:{short:'초록 숲',name:'초록 숲속 성역',eyebrow:'GREEN SANCTUARY FOREST · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xd5f0c8,poster:'./assets/panoramas/green_sanctuary.jpg',frontU:.5,
  credit:['Green Sanctuary Forest','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
 autumn_field:{short:'가을빛 ',name:'가을빛 들판',eyebrow:'AUTUMN FIELD · 360°',tagline:'자연의 빛과 공기가 머무는 파노라마.',sun:0xffe2b8,poster:'./assets/panoramas/autumn_field.jpg',frontU:.5,
  credit:['Autumn Field','Poly Haven','https://polyhaven.com/hdris'],
  views:{tower:['전망','PANORAMA','탁 트인 풍경.','유리 난간 너머 자연의 숨결을 느껴보세요.'],
   yeouido:['지평선','HORIZON','끝없이 펼쳐진 수평선.','바람과 햇살이 머무는 곳.'],
   hangang:['하늘','SKYSCAPE','빛나는 자연의 빛.','구름과 하늘의 아름다운 조화.'],
   overview:['부유선 전체','THE AIRSHIP','우리만의 작은 전망대.','부유선이 평화로운 풍경 위를 부드럽게 유영합니다.']}},
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
const sun=new THREE.DirectionalLight(0xfff2dc,3.0);sun.position.set(-25,45,35);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-10,right:10,top:12,bottom:-12,near:1,far:110});sun.shadow.bias=-.0003;sun.shadow.normalBias=.015;scene.add(sun);scene.add(sun.target);
const fill=new THREE.DirectionalLight(0xe1eaff,1.05);fill.position.set(8,12,-18);scene.add(fill);

// 360° 영상 배경(2026-11-01 사용자: "유투브 입체 영상 이 공간에서 플레이 가능해?" → 1번 "360 영상 파일을 배경에"): 2:1 equirectangular 영상을 카메라를 감싼 공 안쪽에 입힌다.
// 공은 매 프레임 카메라 위치로 옮겨 무한히 먼 배경처럼 보이게 한다. 배경 버튼으로 BACKGROUNDS 사이를 바꾼다(각자 화면만, 공유하지 않음)
let backgroundKey=null, backgroundVideo=null, backgroundEnv=null, backgroundLoading=false, seoulSky=null, cylinderSkyMap={};
const layeredSkies = new Map();
let panoramaSettings={amount:1,clouds:true,preview:false};
try {
 const saved=JSON.parse(localStorage.getItem('m002-panorama-settings'));
 if(saved&&Number.isFinite(saved.amount))panoramaSettings.amount=THREE.MathUtils.clamp(saved.amount,0,2);
 if(typeof saved?.clouds==='boolean')panoramaSettings.clouds=saved.clouds;
}catch{}
function syncPanoramaControls(){
 $('panorama-controls').hidden=!BACKGROUNDS[backgroundKey]?.layersManifest;
 $('panorama-amount').value=panoramaSettings.amount;
 $('panorama-amount-value').value=panoramaSettings.amount===0?'정지':`${panoramaSettings.amount.toFixed(1)}배`;
 $('panorama-flat').setAttribute('aria-pressed',String(panoramaSettings.amount===0));
 $('panorama-depth').setAttribute('aria-pressed',String(panoramaSettings.amount>0));
 $('panorama-clouds').checked=panoramaSettings.clouds;
 $('panorama-preview').checked=panoramaSettings.preview;
 for(const panorama of layeredSkies.values())panorama.configure(panoramaSettings);
 try{localStorage.setItem('m002-panorama-settings',JSON.stringify({amount:panoramaSettings.amount,clouds:panoramaSettings.clouds}));}catch{}
}
function loadVideo(src) {
 if(!src) return Promise.resolve(null);
 const video=document.createElement('video');Object.assign(video,{src,loop:true,muted:true,playsInline:true,preload:'auto'});video.setAttribute('playsinline','');
 return new Promise(resolve=>{video.addEventListener('loadeddata',()=>resolve(video),{once:true});video.addEventListener('error',()=>{console.warn('영상을 읽지 못했어요.',src,video.error);resolve(null);},{once:true});});
}
function createBackground() {
 const geometry=new THREE.SphereGeometry(1000,96,48);geometry.scale(-1,1,1);   // 안쪽에서 볼 때 좌우가 뒤집히지 않게
 background=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({depthWrite:false,toneMapped:false}));
 background.renderOrder=-2;background.frustumCulled=false;scene.add(background);
}
function createSeoulSky(textures) {   // m001 원통 배경 그대로
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
 const group=new THREE.Group();
 const wall=new THREE.Mesh(new THREE.CylinderGeometry(1100,1100,12000,256,24,true),material);wall.renderOrder=-2;wall.frustumCulled=false;
 const caps=new THREE.Mesh(new THREE.SphereGeometry(9000,32,24),material);caps.renderOrder=-3;group.add(wall,caps);scene.add(group);return group;
}
function setEnvironment(texture) {
 const envMap=texture.clone();envMap.mapping=THREE.EquirectangularReflectionMapping;const pmrem=new THREE.PMREMGenerator(renderer);const env=pmrem.fromEquirectangular(envMap);pmrem.dispose();envMap.dispose();
 backgroundEnv?.dispose();backgroundEnv=env.texture;scene.environment=env.texture;scene.environmentIntensity=.6;
}
async function useBackground(key) {
 const bg=BACKGROUNDS[key];if(!bg||backgroundLoading||key===backgroundKey)return;backgroundLoading=true;$('bg-switch').disabled=true;
 try {
  const old=background.material.map;
  if(bg.layersManifest){
   let panorama=layeredSkies.get(key);
   if(!panorama){
    panorama=await createLayeredPanorama({manifestURL:bg.layersManifest,loader:textureLoader,renderer});
    scene.add(panorama.root);layeredSkies.set(key,panorama);
   }
   setEnvironment(panorama.environment);
   for(const item of layeredSkies.values())item.root.visible=item===panorama;
   for(const item of Object.values(cylinderSkyMap))item.sky.visible=false;
   background.visible=false;background.material.map=null;
   backgroundVideo?.pause();backgroundVideo?.removeAttribute('src');backgroundVideo?.load();backgroundVideo=null;
  } else if(bg.files){
   if(!cylinderSkyMap[key]){
    const textures=await Promise.all(bg.files.map(async name=>{const t=await textureLoader.loadAsync(`./assets/${name}`);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}));
    cylinderSkyMap[key]={sky:createSeoulSky(textures),envTex:textures[0]};
   }
   for(const panorama of layeredSkies.values())panorama.root.visible=false;
   for(const k of Object.keys(cylinderSkyMap)){cylinderSkyMap[k].sky.visible=(k===key);}
   background.visible=false;background.material.map=null;
   backgroundVideo?.pause();backgroundVideo?.removeAttribute('src');backgroundVideo?.load();backgroundVideo=null;setEnvironment(cylinderSkyMap[key].envTex);
  } else {
   const [poster,video]=await Promise.all([textureLoader.loadAsync(bg.poster),askBigDownload(bg.video,bg.name).then(ok=>ok?loadVideo(bg.video):null)]);poster.colorSpace=THREE.SRGBColorSpace;   // 정지 그림 = 조명 반사용, 영상을 못 읽으면 배경으로도 쓴다
   const map=video?new THREE.VideoTexture(video):poster;map.colorSpace=THREE.SRGBColorSpace;
   background.material.map=map;background.visible=true;background.rotation.y=Math.PI*2*(bg.frontU-.75);for(const k of Object.keys(cylinderSkyMap)){cylinderSkyMap[k].sky.visible=false;}
   for(const panorama of layeredSkies.values())panorama.root.visible=false;
   backgroundVideo?.pause();backgroundVideo?.removeAttribute('src');backgroundVideo?.load();backgroundVideo=video;video?.play().catch(()=>{});
   setEnvironment(poster);if(map!==poster)poster.dispose();
  }
  background.material.needsUpdate=true;if(old&&old!==background.material.map)old.dispose();sun.color.set(bg.sun);
  backgroundKey=key;try{localStorage.setItem('m002-background',key);}catch{}
  syncPanoramaControls();
  const identity=document.querySelector('.identity');identity.querySelector('.eyebrow').textContent=bg.eyebrow;identity.querySelector('h1').textContent=bg.name;identity.querySelector('p').textContent=bg.tagline;document.title=`${bg.name} · 소유의 춤`;
  for(const [name,[label,kicker,title,description]] of Object.entries(bg.views)){Object.assign(presets[name],{kicker,title,description});document.querySelector(`[data-view="${name}"]`).textContent=label;}
  if(typeof bg.credit==='string')$('bg-credit').textContent=bg.credit;
  else{const [title,author,url]=bg.credit;$('bg-credit').replaceChildren('배경 영상: ',Object.assign(document.createElement('a'),{href:url,target:'_blank',rel:'noopener',textContent:title}),` · ${author} · `,Object.assign(document.createElement('a'),{href:'https://creativecommons.org/licenses/by/3.0/',target:'_blank',rel:'noopener',textContent:'CC BY 3.0'}));}
  $('bg-switch').textContent=`${bg.short} ⇄`;
  document.querySelectorAll('.tv-bg-btn').forEach(b=>b.classList.toggle('active',b.dataset.bgId===key));
  if(state.mode==='view'){const p=presets[state.view];$('view-kicker').textContent=p.kicker;$('view-title').textContent=p.title;$('view-description').textContent=p.description;}
  else if(state.ready&&state.mode!=='watch')$('view-title').textContent=walkTitle(state.mode);
 } finally {backgroundLoading=false;$('bg-switch').disabled=false;}
}
// TV 화면 시스템 (반대편 +z 배치 & 방 공용 POV/TV 플레이어):
// - POV 영상: 곡면 돔 TV (가로 DOME.width°, 16:9, 반대편 +z)
// - 일반 영상(dancer 등): 평면 스크린 TV (16:9 대형 디스플레이)
// - 360° 영상(bled, tolmin 등): 360° VR 파노라마 구체
const MEDIA_CATALOG={
 odyssey:{id:'odyssey',title:'화면 조정 시험 영상',type:'pov',sources:['./assets/dome/test-pattern.mp4'],desc:'POV 곡면 돔 TV (16:9)',duration:12},
 dancer:{id:'dancer',title:'평면 TV 시험 영상',type:'flat',sources:['./assets/dome/test-pattern.mp4'],desc:'평면 스크린 TV (16:9)',duration:12},
 bled:{id:'bled',title:'블레드 호수 타임랩스',type:'360',sources:['./assets/bled/bled-lake-360.webm'],desc:'360° VR 파노라마',duration:8.5},
 tolmin:{id:'tolmin',title:'톨민 패러글라이딩',type:'360',sources:['./assets/tolmin/tolmin-paragliding-360.webm'],desc:'360° VR 파노라마',duration:50.6}
};
const DOME={radius:80,width:100,elevation:5};   // 2026-11-02 사용자: "티브이 너무 높아" → 가운데 높이 14°→5°
let currentMediaId='odyssey',currentMediaType='pov',tvSkipped=false;
let dome=null,domeMeshGroup=null,domeScreenMesh=null;
let flatMeshGroup=null,flatScreenMesh=null;
let pano360Mesh=null;
let domeVideo=null,domePlaceholder=null,mediaLoadEpoch=0;
const povState={localProgress:0,localReady:false,duration:127.561,src:'',size:[3840,2160]};
let povShared=null,povServerNow=()=>performance.now()/1000,povConnected=false,povAudioBlocked=false,povPending=false,povEpoch=0;

function drawDomePlaceholder(text,mediaId=currentMediaId){
 const meta=MEDIA_CATALOG[mediaId]||MEDIA_CATALOG.odyssey;
 if(!domePlaceholder){
  const c=document.createElement('canvas');c.width=1280;c.height=720;
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  domePlaceholder={canvas:c,ctx:c.getContext('2d'),texture:tex};
 }
 const {canvas:c,ctx,texture}=domePlaceholder;
 ctx.fillStyle='#101a22';ctx.fillRect(0,0,c.width,c.height);
 ctx.fillStyle='#e4c99b';ctx.font='600 38px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.fillText(`${meta.title} · ${meta.desc}`,c.width/2,c.height/2-36);
 ctx.fillStyle='#dbd9d1';ctx.font='28px sans-serif';
 ctx.fillText(text,c.width/2,c.height/2+32);
 texture.needsUpdate=true;
 return texture;
}

function updateTvMeshVisibility(mediaType=currentMediaType){
 currentMediaType=mediaType;
 const on=dome?.visible??true;
 if(!on){
  if(domeMeshGroup)domeMeshGroup.visible=false;
  if(flatMeshGroup)flatMeshGroup.visible=false;
  if(pano360Mesh)pano360Mesh.visible=false;
  return;
 }
 if(domeMeshGroup)domeMeshGroup.visible=(mediaType==='pov');
 if(flatMeshGroup)flatMeshGroup.visible=(mediaType==='flat');
 if(pano360Mesh)pano360Mesh.visible=(mediaType==='360');
}

function downloadVideoWithProgress(src,onProgress){
 return new Promise(resolve=>{
  const xhr=new XMLHttpRequest();
  xhr.open('GET',src,true);
  xhr.responseType='blob';
  let lastPct=-1;
  xhr.onprogress=e=>{
   if(e.lengthComputable&&e.total>0){
    const pct=Math.min(99,Math.floor((e.loaded/e.total)*100));
    if(pct!==lastPct){lastPct=pct;onProgress(pct);}
   }
  };
  xhr.onload=()=>{
   if(xhr.status>=200&&xhr.status<300&&xhr.response){
    const blobUrl=URL.createObjectURL(xhr.response);
    const video=document.createElement('video');
    Object.assign(video,{src:blobUrl,loop:false,muted:false,playsInline:true,preload:'auto'});
    video.setAttribute('playsinline','');
    video.dataset.sourceUrl=new URL(src,location.href).href;
    video.addEventListener('loadeddata',()=>resolve(video),{once:true});
    video.addEventListener('error',()=>{URL.revokeObjectURL(blobUrl);resolve(null);},{once:true});
   } else resolve(null);
  };
  xhr.onerror=()=>resolve(null);
  xhr.send();
 });
}

async function loadTvMedia(mediaId){
 const meta=MEDIA_CATALOG[mediaId];
 if(!meta)return;
 currentMediaId=mediaId;
 currentMediaType=meta.type;
 const myEpoch=++mediaLoadEpoch;

 if(domeVideo)domeVideo.pause();

 povState.localProgress=0;
 povState.localReady=false;
 povState.duration=meta.duration;
 $('pov-seek').max=meta.duration.toFixed(2);
 $('pov-total').textContent=fmt(meta.duration);
 drawDomePlaceholder(`${meta.title} 다운로드 준비 중… 0%`,mediaId);
 updateTvMeshVisibility(meta.type);
 syncPovUI();

 let lastSent=0;
 const onProgress=pct=>{
  if(myEpoch!==mediaLoadEpoch)return;
  povState.localProgress=pct;
  povState.localReady=false;
  drawDomePlaceholder(`${meta.title} 다운로드 중… ${pct}%`,mediaId);
  syncPovUI();
  const now=performance.now();
  if(now-lastSent>120||pct===0||pct>=99){
   lastSent=now;
   multiplayer?.reportPovProgress(pct,false);
  }
 };

 let loadedVideo=null;tvSkipped=false;
 for(const src of meta.sources){
  if(myEpoch!==mediaLoadEpoch)return;
  if(!await askBigDownload(src,meta.title)){tvSkipped=true;continue;}   // 큰 영상은 먼저 묻는다(download-guard.js). 안 받으면 다음 후보(시험 영상)로
  if(myEpoch!==mediaLoadEpoch)return;
  const v=await downloadVideoWithProgress(src,onProgress);
  if(v){loadedVideo=v;break;}
 }

 if(myEpoch!==mediaLoadEpoch)return;
 if(!loadedVideo){
  drawDomePlaceholder(tvSkipped?`${meta.title} · 받지 않았어요 (TV 패널에서 다시 고르면 받아요)`:'영상을 불러오지 못했어요',mediaId);
  return;
 }

 domeVideo=loadedVideo;
 povState.src=domeVideo.dataset.sourceUrl||domeVideo.currentSrc;
 povState.size=[domeVideo.videoWidth||1920,domeVideo.videoHeight||1080];
 if(Number.isFinite(domeVideo.duration)&&domeVideo.duration>0){
  povState.duration=domeVideo.duration;
  $('pov-seek').max=povState.duration.toFixed(2);
  $('pov-total').textContent=fmt(povState.duration);
 }

 const map=new THREE.VideoTexture(domeVideo);
 map.colorSpace=THREE.SRGBColorSpace;
 if(domeScreenMesh){domeScreenMesh.material.map=map;domeScreenMesh.material.needsUpdate=true;}
 if(flatScreenMesh){flatScreenMesh.material.map=map;flatScreenMesh.material.needsUpdate=true;}
 if(pano360Mesh){pano360Mesh.material.map=map;pano360Mesh.material.needsUpdate=true;}

 domeVideo.addEventListener('ended',()=>syncPovUI());
 povState.localProgress=100;
 povState.localReady=true;
 multiplayer?.reportPovProgress(100,true,povState.duration);
 updateTvMeshVisibility(meta.type);
 syncPovVideo(true);
 syncPovUI();
}

async function createDome() {
 const W=THREE.MathUtils.degToRad(DOME.width),H=W*9/16,top=Math.PI/2-THREE.MathUtils.degToRad(DOME.elevation)-H/2;
 const patch=(r,pad)=>{const g=new THREE.SphereGeometry(r,128,64,.5*Math.PI-W/2-pad,W+pad*2,top-pad,H+pad*2);g.scale(-1,1,1);return g;};
 const placeholderTex=drawDomePlaceholder('영상 다운로드 준비 중… 0%',currentMediaId);

 dome=new THREE.Group();dome.name='TvSystem';dome.position.set(0,1.65,0);

 // 1. 곡면 돔 TV (POV 모드)
 domeMeshGroup=new THREE.Group();
 domeScreenMesh=new THREE.Mesh(patch(DOME.radius,0),new THREE.MeshBasicMaterial({map:placeholderTex,side:THREE.DoubleSide,toneMapped:false}));
 const domeFrame=new THREE.Mesh(patch(DOME.radius+.6,THREE.MathUtils.degToRad(.8)),new THREE.MeshBasicMaterial({color:0x14181c,side:THREE.DoubleSide}));
 domeMeshGroup.add(domeScreenMesh,domeFrame);
 dome.add(domeMeshGroup);

 // 2. 평면 스크린 TV (일반 영상 모드: 데크 반대편 +z 방향, 16:9 평면 TV)
 flatMeshGroup=new THREE.Group();
 flatMeshGroup.position.set(0,5.2,16.0);   // "티브이 너무 높아": 가운데 7.0m→5.2m(아래 끝이 데크 위 약 0.7m)
 flatScreenMesh=new THREE.Mesh(new THREE.PlaneGeometry(16,9),new THREE.MeshBasicMaterial({map:placeholderTex,side:THREE.DoubleSide,toneMapped:false}));
 flatScreenMesh.rotation.y=Math.PI; // 데크 안쪽(-z)을 바라보도록 회전
 const flatFrame=new THREE.Mesh(new THREE.PlaneGeometry(16.6,9.6),new THREE.MeshBasicMaterial({color:0x14181c,side:THREE.DoubleSide}));
 flatFrame.position.z=0.05;
 flatFrame.rotation.y=Math.PI;
 flatMeshGroup.add(flatFrame,flatScreenMesh);
 dome.add(flatMeshGroup);

 // 3. 360° VR 파노라마 구체
 const panoGeom=new THREE.SphereGeometry(140,64,32);
 panoGeom.scale(-1,1,1);
 pano360Mesh=new THREE.Mesh(panoGeom,new THREE.MeshBasicMaterial({map:placeholderTex,side:THREE.DoubleSide,toneMapped:false}));
 dome.add(pano360Mesh);

 cruise.add(dome);

 let on=true;try{on=localStorage.getItem('m002-dome')!=='off';}catch{}
 setDome(on);
 updateTvMeshVisibility('pov');

 // 초기 미디어(odyssey) 다운로드 및 로드 시작
 loadTvMedia('odyssey');
}
function povTimeline() {
 if(!povShared)return domeVideo?Math.min(domeVideo.currentTime,povState.duration):0;
 return THREE.MathUtils.clamp(povShared.position+(povShared.playing?Math.max(0,povServerNow()-povShared.serverTime):0),0,povState.duration);
}
function povIsPlaying() {
 return povShared?povConnected&&povShared.playing&&!povShared.waiting&&povTimeline()<povState.duration:Boolean(domeVideo&&!domeVideo.paused);
}
function startPovVideo() {
 if(!domeVideo||povPending||!dome?.visible)return;
 povPending=true;const epoch=povEpoch;
 domeVideo.play().then(()=>{if(epoch===povEpoch)povAudioBlocked=false;}).catch(error=>{
  if(epoch!==povEpoch||!povIsPlaying()||error.name==='AbortError')return;
  // 소리 자동 재생이 막힌 경우 음소거로 즉시 영상을 재생하고 '소리 켜기' 버튼을 노출한다.
  domeVideo.muted=true;povAudioBlocked=true;
  domeVideo.play().catch(()=>{});
 }).finally(()=>{povPending=false;});
}
function syncPovVideo(force=false) {
 if(!domeVideo||!povState.localReady||!povShared)return;
 const t=povTimeline(),playing=povIsPlaying();
 if((playing||povShared.waiting)&&dome&&!dome.visible)setDome(true);
 if(!playing){
  if(!domeVideo.paused)domeVideo.pause();
  domeVideo.playbackRate=1;
  if(force||Math.abs(t-domeVideo.currentTime)>.08)domeVideo.currentTime=Math.min(t,Math.max(0,povState.duration-.001));
  return;
 }
 const drift=t-domeVideo.currentTime;
 if(force||Math.abs(drift)>.24){domeVideo.currentTime=Math.min(t,Math.max(0,povState.duration-.001));domeVideo.playbackRate=1;}
 else if(!domeVideo.paused)domeVideo.playbackRate=THREE.MathUtils.clamp(1+drift*.12,.96,1.04);
 if(domeVideo.paused)startPovVideo();
}
function enablePovAudio() {
 if(!domeVideo)return;
 povAudioBlocked=false;domeVideo.muted=false;
 if(povIsPlaying()){
  domeVideo.currentTime=povTimeline()>=povState.duration-.05?0:povTimeline();
  domeVideo.play().catch(error=>{if(error.name!=='AbortError'){domeVideo.muted=true;povAudioBlocked=true;domeVideo.play().catch(()=>{});}});
 }
 syncPovUI();
}
function showGallery(on) {   // 드론 갤러리가 켜지고 꺼질 때(방 전체, gallery.js)
 if(on)setDome(true);
 const btn=$('gallery-toggle');btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));
 btn.querySelector('b').textContent=on?'🛸 드론 갤러리 · 켜짐':'🛸 드론 갤러리';
 btn.querySelector('small').textContent=on?'누르면 드론이 그림을 들고 돌아가요':'TV를 켜고 발표 모드로 · 드론이 그림을 들고 둘러싸요';
}
function setDome(on) {
 if(!dome)return;
 dome.visible=on;
 updateTvMeshVisibility();
 if(domeVideo){if(on&&povIsPlaying())startPovVideo();else if(!on)domeVideo.pause();}
 $('dome-toggle')?.setAttribute('aria-pressed',String(on));
 const powerBtn=$('tv-power-btn');if(powerBtn)powerBtn.textContent=on?'TV 끄기':'TV 켜기';
 try{localStorage.setItem('m002-dome',on?'on':'off');}catch{}
}
function woodTexture() {
 const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#b29970';ctx.fillRect(0,0,512,256);
 let seed=912;const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 for(let i=0;i<850;i++){const y=rand()*256;ctx.strokeStyle=`rgba(${rand()>.5?'80,54,28':'235,214,168'},${.015+rand()*.055})`;ctx.lineWidth=.4+rand()*.6;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(150,y+rand()*3,350,y-rand()*3,512,y+rand()*2);ctx.stroke();}
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
}
function setWalking(active) { state.walking=active; }
function updateActionButtons(action) {
 for(const button of document.querySelectorAll('[data-action]'))button.setAttribute('aria-pressed',String(button.dataset.action===action));
 const labels={idle:'이동키로 산책하거나 동작을 골라보세요.',walk:'제자리에서 걷는 중',wave:'손을 흔들어 인사해요',dance:'춤추는 중'};
 $('action-status').textContent=labels[action]||labels.idle;
}
function syncLocalMotion(nowSec=performance.now()/1000) {
 if(!localAvatar)return;
 if(state.walking){
  state.motion='walk';
  state.motionTime=state.gait*localAvatar.durations.walk;
  return;
 }
 if(state.action!=='idle'){
  const elapsed=Math.max(0,nowSec-state.actionStartedAt);
  state.actionTime=elapsed;
  if(state.action==='wave'&&elapsed>=localAvatar.durations.wave){
   state.action='idle';state.actionTime=0;state.motion='idle';state.motionTime=0;
   updateActionButtons('idle');
   return;
  }
  state.motion=state.action;
  state.motionTime=state.action==='walk'?elapsed%localAvatar.durations.walk:state.action==='dance'?elapsed%localAvatar.durations.dance:elapsed;
 } else {
  state.motion='idle';
  state.motionTime=0;
 }
}
function setAction(action, showCamera=true) {
 if(!state.ready||!['idle','walk','wave','dance'].includes(action))return;
 stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);
 state.action=action;state.actionTime=0;state.actionStartedAt=performance.now()/1000;
 state.motion=action;state.motionTime=0;
 updateActionButtons(action);
 if(showCamera&&(state.mode==='view'||state.mode==='first'))setMode('follow');
 localAvatar.animate(action,0);
 multiplayer?.sendNow();
 if(showCamera)canvas.focus({preventScroll:true});
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
  if(saved){nameInput.value=saved.name||'';const c=['rika','soyu','ruby'].includes(saved.character)?saved.character:'rika';document.querySelector(`input[name="character"][value="${c}"]`).checked=true;}
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
 // 배경: 주소 ?bg=tolmin > 이 브라우저의 마지막 선택 > 서울. 반대편(+z)에는 POV 돔 화면
 let saved=null;try{saved=localStorage.getItem('m002-background');}catch{}
 const firstBackground=[new URLSearchParams(location.search).get('bg'),saved].find(k=>BACKGROUNDS[k])||'seoul';
 createBackground();
 const [gltf,soyuWalking,rubyGltf]=await Promise.all([new GLTFLoader(loadingManager).loadAsync('./assets/airship.glb'),new GLTFLoader(loadingManager).loadAsync('./assets/soyu/walking.glb'),new GLTFLoader(loadingManager).loadAsync('./assets/ruby/ruby.glb'),useBackground(firstBackground),createDome()]);
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
 const deck=[];root.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&!o.name.startsWith('Clear_glass'))deck.push(o);});deckMeshes=deck;root.updateMatrixWorld(true);
 const probe=player.parent.localToWorld(new THREE.Vector3(0,restPlayerY,SOYU_Z));const hit=new THREE.Raycaster(probe.clone().setY(probe.y+5),new THREE.Vector3(0,-1,0),0,20).intersectObjects(deck,false)[0];
 const floor=player.parent.worldToLocal((hit?hit.point:probe).clone());
 soyu=await createSoyu({parent:player.parent,renderer,manager:loadingManager,position:new THREE.Vector3(0,floor.y,SOYU_Z),facing:0});
 setupDanceUI();
 setupPovUI();
 setupTvUI();
 setupShareUI();
 mixer=new THREE.AnimationMixer(root);walkActions=gltf.animations.map(clip=>mixer.clipAction(clip));if(!walkActions.length)throw new Error('걷기 동작이 모델에 없습니다.');buildIdlePose();
 const avatarFactory=createAvatarFactory({rika:player,soyu,clips:gltf.animations,soyuWalk:soyuWalking.animations[0],ruby:rubyGltf});
 const oldPlayer=player,parent=player.parent,position=player.position.clone();
 mixer.stopAllAction();mixer.uncacheRoot(root);oldPlayer.removeFromParent();
 localAvatar=avatarFactory.create(profile.character);player=localAvatar.avatar;parent.add(player);player.position.copy(position);player.rotation.y=state.heading+Math.PI;
 mixer=localAvatar.mixer;walkActions=localAvatar.actions;idleTransforms=localAvatar.pose;stride=localAvatar.stride??1.25*RIKA_K;
 multiplayer=createMultiplayer({player,camera,getMode:()=>state.mode,profile,avatarFactory,status:$('presence'),
  onStage:(stage,clock)=>soyu.syncRoom(stage,clock),
  onStageError:message=>{stageNotice=message;stageNoticeUntil=performance.now()+3000;},
  onViewStage:()=>{soyu.enableAudio();multiplayer.openChat(false);watchSoyu();},
  onPov:(pov,clock)=>{
   const changed=!povShared||povShared.revision!==pov.revision;
   if(changed)povEpoch++;
   povShared={...pov};povServerNow=clock;
   if(pov.mediaId){
    document.querySelectorAll('.tv-media-btn').forEach(btn=>{
     btn.classList.toggle('active',btn.dataset.mediaId===pov.mediaId);
    });
    if(pov.mediaId!==currentMediaId){
     loadTvMedia(pov.mediaId);
    } else if(pov.mediaType&&pov.mediaType!==currentMediaType){
     updateTvMeshVisibility(pov.mediaType);
    }
   }
   if(Number.isFinite(pov.duration)&&pov.duration>0){
    povState.duration=pov.duration;
    $('pov-seek').max=povState.duration.toFixed(2);
    $('pov-total').textContent=fmt(povState.duration);
   }
   syncPovVideo(changed);syncPovUI();
  },
  onPovError:message=>{povNotice=message;povNoticeUntil=performance.now()+3000;},
  onViewPov:(autoTriggered=false)=>{if(!autoTriggered)enablePovAudio();multiplayer.openChat(false);watchPov(autoTriggered);},
  getLocalPovProgress:()=>({progress:povState.localProgress,ready:povState.localReady,duration:povState.duration}),
  getMedia:id=>MEDIA_CATALOG[id],defaultMedia:currentMediaId,
  onConnection:connected=>{
   soyu.setRoomConnected(connected);povConnected=connected;
   if(!connected&&povShared){povShared={...povShared,position:povTimeline(),playing:false,waiting:false,serverTime:povServerNow()};povEpoch++;domeVideo?.pause();}
   $('dance-play').disabled=!connected;$('dance-seek').disabled=!connected;
   $('pov-play').disabled=!connected;$('pov-seek').disabled=!connected;
   syncPovUI();
  },
  getLocalState:()=>{
   syncLocalMotion();
   return {x:player.position.x,z:player.position.z,heading:state.heading,gait:state.gait,walking:state.walking,action:state.motion,actionTime:state.motionTime};
  },
  setSpawn:p=>{player.position.x=p.x;player.position.z=p.z;state.heading=p.heading;player.rotation.y=p.heading+Math.PI;}});
 soyu.bindRoom((command,position)=>multiplayer.controlStage(command,position));
 state.ready=true;$('loading').hidden=true;$('avatar-actions').hidden=false;setMode('follow');previousTime=performance.now();renderer.setAnimationLoop(tick);
 window.multiplayer=multiplayer;
 const tvScreens=()=>({dome:domeScreenMesh,flat:flatScreenMesh,type:currentMediaType,on:dome?.visible??true});
 window.weather=createWeather({scene,camera,getShip:()=>cruise,send:(kind,level)=>window.voice?.sendWeather(kind,level)});   // 방 전체 날씨(weather.js)
 window.gallery=createGallery({getPlayer:()=>player,getScreens:tvScreens,send:(action,count)=>window.voice?.sendGallery(action,count),getMyId:()=>window.voice?.myId(),onShow:showGallery});   // 드론 그림 전시·발표(gallery.js)
 // TV 패널 → 📺 TV 화면 → 기타 → 드론 갤러리(2026-11-02 사용자: "티브이 키고 발표 모드로 바꾸는거야"). 켜면 TV가 켜지고 상영 중인 영상은 멈춘다(그림이 TV 앞에 온다)
 $('gallery-toggle').addEventListener('click',()=>{const on=!window.gallery.isOn();window.gallery.setOn(on);if(on&&povIsPlaying())multiplayer?.controlPov('pause');});
 window.voice=createVoice({scene,camera,getSelf:()=>multiplayer.getState(),getPlayer:()=>player,getScreens:tvScreens,onWeather:w=>window.weather.apply(w),onGallery:(g,id)=>window.gallery.apply(g,id)});   // 한 명만 말하기·화면 공유(voice.js)
 window.tvZoom=createTvZoom({camera,canvas,getScreens:tvScreens,getShare:()=>window.voice.getShareView(),getExtra:()=>window.gallery.zoomTargets()});   // TV·그림 두 번 눌러 크게 보기(tv-zoom.js)
 window.dock=createDock({camera,canvas,getPlayer:()=>player,soyu,gallery:window.gallery});   // 화면 정리: 오른쪽 아이콘 줄·소유/강단 메뉴(ui-dock.js)
 const domeCenter=()=>{
  if(!domeScreenMesh)return [0,0,0];
  domeScreenMesh.geometry.computeBoundingSphere();
  return domeScreenMesh.localToWorld(domeScreenMesh.geometry.boundingSphere.center.clone()).toArray();
 };
 window.spaceView={
  getState:()=>({
   ready:state.ready,mode:state.mode,motion:state.motion,motionTime:state.motionTime,rig:localAvatar.motionState(),
   view:state.view,cruise:state.cruise,walking:state.walking,heading:state.heading,
   player:[player.position.x,player.position.y-70,player.position.z],flight:cruise.position.toArray(),
   gait:state.gait,frames:state.frames,elapsed:state.elapsed,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,
   clips:walkActions.map(a=>a.getClip()).map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),
   camera:camera.position.toArray(),
   dome:dome&&{
    visible:dome.visible,side:'opposite (+z)',center:domeCenter(),
    src:povState.src||(domeVideo?.currentSrc??''),
    time:povTimeline(),paused:!povIsPlaying(),playing:povIsPlaying(),waiting:Boolean(povShared?.waiting),
    progress:povState.localProgress,ready:povState.localReady,duration:povState.duration,
    size:povState.size,shared:povShared,
   },
   dance:soyu&&{time:soyu.time,playing:soyu.playing,duration:soyu.duration,center:soyu.center().toArray(),shared:soyu.sharedState},
   video:backgroundVideo&&{src:backgroundVideo.currentSrc,time:backgroundVideo.currentTime,paused:backgroundVideo.paused,size:[backgroundVideo.videoWidth,backgroundVideo.videoHeight]},
   panorama:layeredSkies.get(backgroundKey)?.getState()??null,
  }),
  dance:()=>soyu,
  pov:()=>({
   play:()=>multiplayer?.controlPov('play'),
   pause:()=>multiplayer?.controlPov('pause'),
   seek:t=>multiplayer?.controlPov('seek',t),
   watch:()=>watchPov(false),
   setDownloadProgress:(progress,ready)=>{
    povState.localProgress=Math.max(0,Math.min(100,Math.floor(progress)));
    povState.localReady=Boolean(ready);
    multiplayer?.reportPovProgress(povState.localProgress,povState.localReady,povState.duration);
    syncPovVideo(true);syncPovUI();
   },
  }),
  setView,setMode,togglePerspective,setAction,watchPov,reset,step:()=>step(1),toggleLookMode,getLookMode:()=>lookMode,
  useBackground,
 };
}
function setView(name) {
 if(!presets[name])return;stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);state.mode='view';state.view=name;state.orbit=0;state.pitch=0;state.zoom=1;
 const p=presets[name];$('view-kicker').textContent=p.kicker;$('view-title').textContent=p.title;$('view-description').textContent=p.description;
 for(const b of document.querySelectorAll('[data-view]')){const active=b.dataset.view===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
 $('first-person').setAttribute('aria-pressed','false');$('follow').setAttribute('aria-pressed','false');$('watch').setAttribute('aria-pressed','false');updateCamera(1,true);
}
function walkTitle(mode) { const place=BACKGROUNDS[backgroundKey]?.short??''; return mode==='first'?`내 눈으로 걷는 ${place}.`:`${profile.name}의 ${place} 산책.`; }
function togglePerspective() {
 if(!state.ready)return;
 if(state.mode==='first') setMode('follow');
 else setMode('first');
}
function setMode(mode) {
 if(!state.ready)return;if(mode==='first'||mode==='follow')stopAuto();state.mode=mode;state.orbit=0;state.pitch=THREE.MathUtils.degToRad(7);state.zoom=1;
 $('first-person').setAttribute('aria-pressed',String(mode==='first'));$('follow').setAttribute('aria-pressed',String(mode==='follow'));$('watch').setAttribute('aria-pressed',String(mode==='watch'));$('btn-v')?.setAttribute('aria-pressed',String(mode==='first'));$('btn-v')?.classList.toggle('active',mode==='first');
 for(const b of document.querySelectorAll('[data-view]')){b.classList.remove('active');b.setAttribute('aria-pressed','false');}
 if(mode!=='pov'){
  $('view-kicker').textContent=mode==='first'?'MY WALK':'MY CHARACTER';$('view-title').textContent=walkTitle(mode);$('view-description').textContent='W / S 또는 ↑ / ↓로 앞뒤 이동 · A / D 또는 ← / →로 방향 전환';
 }
 updateCamera(1,true);canvas.focus({preventScroll:true});
}
function move(distance) {
 const x0=player.position.x,z0=player.position.z;
 let x=THREE.MathUtils.clamp(x0+Math.sin(state.heading)*distance,-3.55,3.55),z=THREE.MathUtils.clamp(z0+Math.cos(state.heading)*distance,-6.2,6.2);
 if(Math.abs(x)>2.7 && Math.abs(z)>5.4){const cx=Math.sign(x)*2.7,cz=Math.sign(z)*5.4,dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d>1.10){x=cx+dx/d*1.10;z=cz+dz/d*1.10;}}
 if(soyu){soyu.center(soyuC);const dx=x-soyuC.x,dz=z-soyuC.z,d=Math.hypot(dx,dz);if(d<SOYU_R){const k=SOYU_R/Math.max(d,1e-4);x=soyuC.x+dx*k;z=soyuC.z+dz*k;if(d<1e-4){x=soyuC.x;z=soyuC.z+SOYU_R;}}}   // 춤추는 소유를 지나가지 못하게
 player.position.x=x;player.position.z=z;return Math.hypot(x-x0,z-z0);
}
let lookMode=false;
function toggleLookMode(forcedState){
 lookMode=forcedState!==undefined?forcedState:!lookMode;
 const stepBtn=$('step');
 const nav=document.querySelector('.navigation');
 if(stepBtn){
  stepBtn.setAttribute('aria-pressed',String(lookMode));
  stepBtn.classList.toggle('active',lookMode);
  stepBtn.textContent=lookMode?'둘러보기':'한 걸음';
  stepBtn.setAttribute('aria-label',lookMode?'시선 둘러보기 모드 · 다시 누르면 걷기 모드':'클릭하면 방향키로 시선 위아래·양옆 둘러보기');
 }
 if(nav){
  nav.classList.toggle('look-mode',lookMode);
  nav.setAttribute('aria-label',lookMode?'방향키로 시선 둘러보기':'클릭으로 걷기');
 }
 const upBtn=document.querySelector('.navigation button[data-key="ArrowUp"]');
 const downBtn=document.querySelector('.navigation button[data-key="ArrowDown"]');
 const leftBtn=document.querySelector('.navigation button[data-key="ArrowLeft"]');
 const rightBtn=document.querySelector('.navigation button[data-key="ArrowRight"]');
 if(upBtn){upBtn.textContent=lookMode?'▲':'↑';upBtn.setAttribute('aria-label',lookMode?'위로 올려다보기':'앞으로 걷기');}
 if(downBtn){downBtn.textContent=lookMode?'▼':'↓';downBtn.setAttribute('aria-label',lookMode?'아래로 내려다보기':'뒤로 걷기');}
 if(leftBtn){leftBtn.textContent=lookMode?'◀':'←';leftBtn.setAttribute('aria-label',lookMode?'왼쪽 둘러보기':'왼쪽으로 돌기');}
 if(rightBtn){rightBtn.textContent=lookMode?'▶':'→';rightBtn.setAttribute('aria-label',lookMode?'오른쪽 둘러보기':'오른쪽으로 돌기');}
 const hint=$('hint');
 if(hint){
  hint.textContent=lookMode?'방향키(↑↓←→)로 시선을 위아래·양옆으로 둘러보세요 · 둘러보기 버튼으로 걷기 복귀':'드래그하여 둘러보기 · WASD 산책';
 }
}
function step(direction) {if(!state.ready)return;if(state.mode==='view'||state.mode==='watch'||state.mode==='pov')setMode('follow');if(state.action!=='idle')setAction('idle',false);state.stepRemaining=.45;state.stepDirection=direction;}
function reset() {if(!state.ready)return;toggleLookMode(false);setAction('idle',false);stopAuto();keys.clear();state.stepRemaining=0;setWalking(false);state.heading=-Math.PI;state.pitch=THREE.MathUtils.degToRad(7);state.orbit=0;player.position.set(0,restPlayerY,.8);player.rotation.y=state.heading+Math.PI;cruise.position.set(0,0,0);state.flightTime=0;updateCamera(1,true);}
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
  // 주인공 따라가기 모드 (기본 산책 및 POV 감상)
  // 방향과 관계없이 항상 일관된 높이를 유지하여 회전 시 시선이 출렁거리거나 하늘을 보지 않는다.
  // 화면 드래그(state.pitch)를 통해 위/아래를 편안하게 둘러볼 수 있다.
  const followDirection=forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0),state.orbit);
  desired.copy(target).addScaledVector(followDirection,-4.2*state.zoom).add(new THREE.Vector3(0,localAvatar.height*1.12+.45+Math.sin(state.pitch)*1.5,0));
  target.y+=localAvatar.height*.62 + Math.sin(state.pitch)*2.0;
  camera.fov=58;
 }
 camera.position.lerp(desired,immediate?1:1-Math.exp(-dt*12));camera.lookAt(target);camera.updateProjectionMatrix();localAvatar.visual.visible=state.mode!=='first';
}
function tick(now) {
 if(!state.ready)return;const dt=Math.min(Math.max((now-previousTime)/1000,0),.08);previousTime=now;state.elapsed+=dt;state.frames++;
 if(state.cruise){state.flightTime+=dt;const t=state.flightTime;cruise.position.set(16*Math.sin(t/55),.12*Math.sin(t/5),-10*Math.sin(t/70));}
 
 const upKey=keys.has('w')||keys.has('ArrowUp');
 const downKey=keys.has('s')||keys.has('ArrowDown');
 const leftKey=keys.has('a')||keys.has('ArrowLeft');
 const rightKey=keys.has('d')||keys.has('ArrowRight');

 if(lookMode){
  // 시선 둘러보기 모드: 방향키로 시선을 위아래·양옆으로 쳐다본다 (캐릭터 이동 및 몸체 회전 안 함)
  const pitchInput=Number(upKey)-Number(downKey);
  const orbitInput=Number(leftKey)-Number(rightKey);
  if(pitchInput){
   state.pitch=THREE.MathUtils.clamp(state.pitch+pitchInput*dt*1.1,-.45,.85);
  }
  if(orbitInput){
   if(state.mode==='first'){
    state.heading+=orbitInput*dt*1.65;
    player.rotation.y=state.heading+Math.PI;
   } else {
    state.orbit+=orbitInput*dt*2.0;
   }
  }
  setWalking(false);
 } else {
  // 원래 걷기 및 몸체 회전 모드
  let turn=Number(leftKey)-Number(rightKey);
  let direction=Number(upKey)-Number(downKey);
  if((turn||direction||state.stepRemaining>0)&&state.mode==='view')setMode('follow');
  if((turn||direction||state.stepRemaining>0||auto)&&state.action!=='idle'){state.action='idle';state.actionTime=0;updateActionButtons('idle');}
  if(auto&&(turn||direction))stopAuto();if((state.mode==='watch'||state.mode==='pov')&&(turn||direction))setMode('follow');
  let autoDist=0;if(auto){soyu.center(soyuC);[,autoDist]=autoStep(dt);}
  if(turn)state.heading+=turn*dt*1.65;
  player.rotation.y=state.heading+Math.PI;
  let distance=auto?autoDist:direction*(keys.has('Shift')?1.85:1.1)*dt;
  if(state.stepRemaining>0){distance=state.stepDirection*Math.min(1.1*dt,state.stepRemaining);state.stepRemaining=Math.max(0,state.stepRemaining-Math.abs(distance));}
  const moved=Math.abs(distance)>1e-6?move(distance):0;setWalking(moved>1e-5);
  if(moved>1e-5){state.gait=(state.gait+Math.sign(distance)*moved/stride)%1;if(state.gait<0)state.gait+=1;}
  if((moved>1e-5||turn)&&state.mode==='follow')state.orbit*=Math.exp(-dt*6);
 }

 syncLocalMotion(now/1000);
 localAvatar.animate(state.motion,state.motionTime);
 if(soyu){soyu.update();syncDanceUI();}
 syncPovVideo();syncPovUI();
 multiplayer?.update(dt);
 root.updateMatrixWorld(true);sun.position.set(-25+cruise.position.x,45+cruise.position.y,35+cruise.position.z);sun.target.position.copy(cruise.position);
 updateCamera(dt);background.position.copy(camera.position);
 for(const panorama of layeredSkies.values())panorama.update(camera,state.elapsed);
 $('altitude').textContent=(70+cruise.position.y).toFixed(state.cruise?1:0);renderer.render(scene,camera);
}
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',()=>setAction(b.dataset.action));
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>state.ready&&setView(b.dataset.view));
$('dome-toggle').addEventListener('click',()=>setDome(!dome?.visible));
$('bg-switch').addEventListener('click',()=>{const names=Object.keys(BACKGROUNDS);useBackground(names[(names.indexOf(backgroundKey)+1)%names.length]).catch(error=>console.warn('배경을 바꾸지 못했어요.',error));});
$('first-person').addEventListener('click',()=>setMode('first'));$('follow').addEventListener('click',()=>setMode('follow'));$('home').addEventListener('click',reset);$('step').addEventListener('click',()=>toggleLookMode());$('btn-v')?.addEventListener('click',togglePerspective);$('ui-toggle')?.addEventListener('click',()=>toggleUI());$('ui-restore-btn')?.addEventListener('click',()=>toggleUI(false));
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
function setupPovUI(){
 const seek=$('pov-seek');seek.max=povState.duration.toFixed(2);$('pov-total').textContent=fmt(povState.duration);
 $('pov-play').addEventListener('click',togglePov);
 seek.addEventListener('input',()=>{povSeeking=true;});
 seek.addEventListener('change',()=>{povSeeking=false;setDome(true);multiplayer?.controlPov('seek',+seek.value);});
 for(const event of ['blur','pointercancel'])seek.addEventListener(event,()=>{povSeeking=false;});
 $('pov-sound').addEventListener('click',enablePovAudio);
 $('pov').hidden=false;
 syncPovUI();
}
function setupTvUI(){
 $('panorama-flat').addEventListener('click',()=>{panoramaSettings.amount=0;syncPanoramaControls();});
 $('panorama-depth').addEventListener('click',()=>{panoramaSettings.amount=1;syncPanoramaControls();});
 $('panorama-amount').addEventListener('input',event=>{panoramaSettings.amount=+event.target.value;syncPanoramaControls();});
 $('panorama-clouds').addEventListener('change',event=>{panoramaSettings.clouds=event.target.checked;syncPanoramaControls();});
 $('panorama-preview').addEventListener('change',event=>{panoramaSettings.preview=event.target.checked;syncPanoramaControls();});
 const tvToggle=$('tv-toggle');
 const tvPanel=$('tv-panel');
 const tvPowerBtn=$('tv-power-btn');
 const tvClose=$('tv-close');
 tvToggle?.addEventListener('click',()=>{
  const isHidden=tvPanel.hidden;
  tvPanel.hidden=!isHidden;
  tvToggle.setAttribute('aria-expanded',String(isHidden));
 });
 tvClose?.addEventListener('click',()=>{
  tvPanel.hidden=true;
  tvToggle?.setAttribute('aria-expanded','false');
 });
 document.querySelectorAll('.tv-tab-btn').forEach(tab=>{
  tab.addEventListener('click',()=>{
   const targetPaneId=tab.dataset.tab;
   document.querySelectorAll('.tv-tab-btn').forEach(t=>{
    const isActive=(t===tab);
    t.classList.toggle('active',isActive);
    t.setAttribute('aria-selected',String(isActive));
   });
   document.querySelectorAll('.tv-tab-pane').forEach(pane=>{
    pane.hidden=(pane.id!==targetPaneId);
    pane.classList.toggle('active',pane.id===targetPaneId);
   });
  });
 });
 tvPowerBtn?.addEventListener('click',()=>{
  setDome(!dome?.visible);
 });
 document.querySelectorAll('.tv-media-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
   const id=btn.dataset.mediaId;
   if(id&&multiplayer){
    if(id===currentMediaId&&tvSkipped){loadTvMedia(id);return;}   // 크기 묻는 창에서 "나중에"를 눌렀던 영상을 다시 고르면 다시 묻는다
    multiplayer.controlPov('select',id);
   }
  });
 });
 document.querySelectorAll('.tv-bg-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
   const id=btn.dataset.bgId;
   if(id) useBackground(id).catch(e=>console.warn('배경 변경 실패:',e));
  });
 });
}
function setupShareUI(){
 const shareToggle=$('share-toggle');
 const sharePanel=$('share-panel');
 const shareClose=$('share-close');
 const lanInput=$('share-lan-url');
 const pubInput=$('share-pub-url');
 const lanCopy=$('share-lan-copy');
 const pubCopy=$('share-pub-copy');
 const guideLan=$('guide-lan-ip');

 async function loadNetworkInfo(){
  try {
   const res=await fetch('./api/network-info');
   if(!res.ok) throw new Error();
   const data=await res.json();
   if(lanInput) lanInput.value=data.lanUrl || `http://${data.lanIp}:${data.port}/`;
   if(pubInput) pubInput.value=data.publicUrl || (data.publicIp!=='확인 불가'?`http://${data.publicIp}:${data.port}/`:'공인 IP를 가져오지 못했어요');
   if(guideLan && data.lanIp) guideLan.textContent=data.lanIp;
  } catch {
   if(await noServer()){   // 서버 없는 공개 페이지(GitHub Pages): 이 페이지 주소 자체가 공유 주소
    if(lanInput) lanInput.value='로컬 서버(serve.py)로 열 때만 나와요';
    if(pubInput) pubInput.value=location.href.split('#')[0];
    return;
   }
   const port=location.port||'4400';
   const host=location.hostname;
   if(lanInput) lanInput.value=`http://${host}:${port}/`;
   if(pubInput) pubInput.value='확인 중…';
  }
 }

 shareToggle?.addEventListener('click',()=>{
  const isHidden=sharePanel.hidden;
  sharePanel.hidden=!isHidden;
  shareToggle.setAttribute('aria-expanded',String(isHidden));
  if(isHidden) loadNetworkInfo();
 });
 shareClose?.addEventListener('click',()=>{
  sharePanel.hidden=true;
  shareToggle?.setAttribute('aria-expanded','false');
 });

 function copyText(btn, input){
  if(!input || !input.value || input.value.includes('불러오는')) return;
  navigator.clipboard.writeText(input.value).then(()=>{
   const old=btn.textContent;
   btn.textContent='복사됨!';
   setTimeout(()=>{ btn.textContent=old; }, 1800);
  }).catch(()=>{
   input.select();
   document.execCommand('copy');
   btn.textContent='복사됨!';
   setTimeout(()=>{ btn.textContent='복사'; }, 1800);
  });
 }

 lanCopy?.addEventListener('click',()=>copyText(lanCopy, lanInput));
 pubCopy?.addEventListener('click',()=>copyText(pubCopy, pubInput));
}
function togglePov(){
 if(!multiplayer||$('pov-play').disabled)return;
 setDome(true);
 const active=povIsPlaying()||Boolean(povShared?.waiting);
 if(!active){enablePovAudio();watchPov(false);}
 multiplayer.controlPov(active?'pause':'play');
}
function syncPovUI(){
 const p=povIsPlaying(),waiting=Boolean(povShared?.waiting),active=p||waiting;
 const dl=povShared?.downloading||[];
 const minPct=dl.length?povShared.minProgress:povState.localProgress;
 const meta=MEDIA_CATALOG[currentMediaId]||MEDIA_CATALOG.odyssey;
 const labelName=meta.type==='pov'?'POV':meta.type==='flat'?'TV':'360';
 $('pov-play').setAttribute('aria-pressed',String(active));
 $('pov-play').setAttribute('aria-label',p?`${labelName} 일시정지`:waiting?`${labelName} 다운로드 대기 (${minPct}%)`:`${labelName} 플레이`);
 $('pov-play-symbol').textContent=p?'Ⅱ':waiting?'⏳':'▶';
 $('pov-play-label').textContent=p?`${labelName} 일시정지`:waiting?`대기 중 ${minPct}%`:`${labelName} 플레이`;
 const seek=$('pov-seek'),t=povTimeline();
 if(!povSeeking)seek.value=t.toFixed(2);
 $('pov-time').textContent=fmt(t);
 const bar=$('pov-progress');
 const showProgress=!povState.localReady||waiting||dl.length>0;
 bar.hidden=!showProgress;
 if(showProgress)bar.value=minPct;
 const dlSummary=dl.length?dl.map(d=>`${d.name} ${d.progress}%`).join(', '):`내 화면 ${povState.localProgress}%`;
 const text=performance.now()<povNoticeUntil?povNotice
  :!povConnected?'방에 연결하는 중…'
  :waiting?`다운로드 중 (${dlSummary}) · 다 받으면 함께 재생`
  :!povState.localReady?`${labelName} 다운로드 ${povState.localProgress}%…`
  :dl.length?`다운로드 중 (${dlSummary}) · 완료 후 함께 보기`
  :p?'방 전체 함께 감상 중'
  :t>=povState.duration-.05?'영상 끝 · 다시 재생해요'
  :'방 전체 재생·일시정지 공유';
 if($('pov-status').textContent!==text)$('pov-status').textContent=text;
 $('pov-status').title=povShared?.byName?`${povShared.byName} 님이 마지막으로 조작했어요`:text;
 $('pov-sound').hidden=!(p&&povAudioBlocked);
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
function watchPov(autoTriggered=false){
 if(!state.ready)return;
 setDome(true);
 if(autoTriggered&&keys.size>0)return;
 keys.clear();state.stepRemaining=0;setMode('follow');
 state.heading=0; // +z (반대편 POV 돔 화면 방향)를 바라봄
 state.pitch=THREE.MathUtils.degToRad(10); // 적절하고 안정적인 시선 각도
 state.orbit=0;
 const spotX=THREE.MathUtils.clamp(player.position.x,-1.8,1.8),spotZ=0.4;
 const spot=new THREE.Vector2(spotX,spotZ);
 auto={path:[spot],facing:0,pitch:THREE.MathUtils.degToRad(10),mode:'pov'};
 $('view-kicker').textContent='POV DOME SCREEN';
 $('view-title').textContent='반대편 POV 화면 앞으로.';
 $('view-description').textContent='주인공 따라가기 시점으로 POV 돔 화면을 바라봅니다. 드래그하여 둘러볼 수 있어요.';
}

function walkToPoint(targetX, targetZ) {
 if(!state.ready || !player) return;
 const cx = THREE.MathUtils.clamp(targetX, -3.4, 3.4);
 const cz = THREE.MathUtils.clamp(targetZ, -6.0, 6.0);
 stopAuto();
 keys.clear();
 state.stepRemaining = 0;
 if(state.mode === "view" || state.mode === "watch" || state.mode === "pov") {
  setMode("follow");
 }
 const spot = new THREE.Vector2(cx, cz);
 auto = { path: [spot], mode: "touch" };
 setWalking(true);
}
function stopAuto(){if(!auto)return;auto=null;setWatchUI(false);}
function setWatchUI(){}
function autoStep(dt){   // [회전량, 이동 거리] — 다음 경유점을 향해 돌고 걷는다
 const wp=auto.path[0],dx=wp.x-player.position.x,dz=wp.y-player.position.z,d=Math.hypot(dx,dz);
 let want=Math.atan2(dx,dz),last=auto.path.length===1;
 if(d<.06){if(!last){auto.path.shift();return [0,0];}want=auto.facing!==undefined?auto.facing:Math.atan2(soyuC.x-player.position.x,soyuC.z-player.position.z);}
 const diff=Math.atan2(Math.sin(want-state.heading),Math.cos(want-state.heading)),turn=THREE.MathUtils.clamp(diff,-2.6*dt,2.6*dt);
 if(d<.06){
  state.heading+=turn;
  if(Math.abs(diff)<.02){
   const wasPov=auto.mode==='pov';
   auto=null;
   $('view-description').textContent=wasPov?'▶ POV 플레이로 모두 함께 감상해요. 드래그하면 둘러볼 수 있어요.':'▶를 누르면 소유가 춤춰요. 드래그하면 둘러볼 수 있어요.';
  }
  return [0,0];
 }
 state.heading+=turn;return [0,Math.abs(diff)<.5?Math.min(1.1*dt,d):0];
}
const controlKeys=new Set(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift']);
 $('chat-input').addEventListener('focus',()=>{keys.clear();state.stepRemaining=0;setWalking(false);stopAuto();});
 addEventListener('keydown',e=>{if(state.ready&&e.key==='Enter'&&!e.isComposing&&!(e.target instanceof Element&&e.target.matches('input,textarea,select,button'))){e.preventDefault();multiplayer.openChat(true,true);}});
addEventListener('keydown',e=>{if(e.target instanceof Element && e.target.matches('input,textarea,select'))return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(controlKeys.has(key)){e.preventDefault();keys.add(key);}if(key==='v'||key==='V'){e.preventDefault();togglePerspective();}if(key==='h'||key==='H'){e.preventDefault();toggleUI();}if(key===' '&&!(e.target instanceof Element&&e.target.matches('button'))){e.preventDefault();toggleDance();}if(key==='Escape'){keys.clear();state.stepRemaining=0;setWalking(false);}});
addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));addEventListener('blur',()=>{keys.clear();state.stepRemaining=0;setWalking(false);});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();state.stepRemaining=0;setWalking(false);}});
for(const b of document.querySelectorAll('[data-key]')){
 b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>keys.delete(b.dataset.key));
}

let uiHidden = false;
function toggleUI(forcedState) {
 uiHidden = forcedState !== undefined ? forcedState : !uiHidden;
 document.body.classList.toggle("ui-hidden", uiHidden);
 const restoreBtn = $("ui-restore-btn");
 if(restoreBtn) restoreBtn.hidden = !uiHidden;
 const uiToggle = $("ui-toggle");
 if(uiToggle) {
  uiToggle.setAttribute("aria-pressed", String(uiHidden));
  uiToggle.textContent = uiHidden ? "👁" : "👁";
 }
}

const tapRaycaster = new THREE.Raycaster();
const tapMouse = new THREE.Vector2();
function handleCanvasTap(clientX, clientY) {
 if(!state.ready || !camera || !deckMeshes || !deckMeshes.length || !player) return;
 tapMouse.x = (clientX / window.innerWidth) * 2 - 1;
 tapMouse.y = -(clientY / window.innerHeight) * 2 + 1;
 tapRaycaster.setFromCamera(tapMouse, camera);
 const hits = tapRaycaster.intersectObjects(deckMeshes, false);
 if(hits.length > 0) {
  const localHit = player.parent.worldToLocal(hits[0].point.clone());
  walkToPoint(localHit.x, localHit.z);
 }
}

let drag=null;
let pointerDownPos = null;
let pointerDownTime = 0;

canvas.addEventListener('pointerdown',e=>{
 drag={x:e.clientX,y:e.clientY};
 pointerDownPos={x:e.clientX,y:e.clientY};
 pointerDownTime=performance.now();
 canvas.setPointerCapture(e.pointerId);
 canvas.focus({preventScroll:true});
});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;
 const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 drag={x:e.clientX,y:e.clientY};
 if(state.mode==='first')state.heading-=dx*.004;
 else state.orbit-=dx*.004;
 state.pitch=THREE.MathUtils.clamp(state.pitch+dy*.003,-.48,.85);
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
 if(drag && pointerDownPos && event==='pointerup'){
  const dist=Math.hypot(e.clientX-pointerDownPos.x,e.clientY-pointerDownPos.y);
  const elapsed=performance.now()-pointerDownTime;
  if(dist < 8 && elapsed < 350){
   handleCanvasTap(e.clientX, e.clientY);
  }
 }
 drag=null;
 pointerDownPos=null;
});
canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=THREE.MathUtils.clamp(state.zoom*Math.exp(-e.deltaY*.0006),.7,1.6);},{passive:false});
addEventListener('resize',()=>{if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
init().catch(fail);
