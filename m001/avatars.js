import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { prepareTestClip } from './assets/ruby/prepare-motion.js';

const boneKey = name => name.replaceAll(':', '');
function poseNodes(object) {
  const poses = [];
  object.traverse(o => { if (o.isBone || o.name === 'CharacterFit') poses.push({name:o.name, position:o.position.clone(), quaternion:o.quaternion.clone(), scale:o.scale.clone()}); });
  return poses;
}
function bindQuaternions(object) {
  const copy = clone(object), result = new Map();
  copy.updateMatrixWorld(true);
  copy.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); });
  copy.traverse(o => {
    if (!o.isBone) return;
    const q = o.quaternion.clone();
    // Skeleton.pose leaves root-bone transforms in bind-world coordinates.
    // Convert through its actual non-bone parent (rig rotation / Player yaw).
    if (o.parent && !o.parent.isBone) {
      const local = new THREE.Matrix4().copy(o.parent.matrixWorld).invert().multiply(o.matrixWorld);
      local.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    }
    result.set(boneKey(o.name), q);
  });
  return result;
}

function danceClip(template, bind, sourceBind, data, heightRatio) {
  const tracks = [], names = new Map();
  template.traverse(o => { if (o.isBone) names.set(boneKey(o.name), o); });
  const times = Float32Array.from({length:data.frames}, (_, i) => i / data.fps);
  for (let k = 0; k < data.boneNames.length; k++) {
    const key = boneKey(data.boneNames[k]), bone = names.get(key);
    if (!bone || !bind.has(key) || !sourceBind.has(key)) continue;
    const correction = bind.get(key).clone().multiply(sourceBind.get(key).clone().invert());
    const values = new Float32Array(data.frames * 4), q = new THREE.Quaternion();
    for (let i = 0; i < data.frames; i++) q.fromArray(data.q[i], 4*k).premultiply(correction).normalize().toArray(values, 4*i);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }
  const hips = names.get(boneKey(data.boneNames[0])), positions = data.p[data.bones[0]];
  if (hips && positions) {
    const values = new Float32Array(data.frames * 3);
    for (let i = 0; i < data.frames; i++) {
      values[3*i] = hips.position.x + (positions[3*i] - positions[0]) * heightRatio;
      values[3*i+1] = hips.position.y + (positions[3*i+1] - positions[1]) * heightRatio;
      values[3*i+2] = hips.position.z + (positions[3*i+2] - positions[2]) * heightRatio;
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, values));
  }
  return new THREE.AnimationClip('AvatarDance', data.frames / data.fps, tracks);
}

function waveClip(template) {
  const copy = clone(template), bones = new Map(), rest = poseNodes(copy);
  copy.traverse(o => { if(o.isBone) bones.set(boneKey(o.name), o); });
  copy.updateMatrixWorld(true);
  const aim = (name, childName, direction) => {
    const bone = bones.get(name), child = bones.get(childName);
    if (!bone || !child) return;
    const a = bone.getWorldPosition(new THREE.Vector3()), b = child.getWorldPosition(new THREE.Vector3());
    const desired = direction.clone().normalize().applyQuaternion(copy.getWorldQuaternion(new THREE.Quaternion()));
    const delta = new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), desired);
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    copy.updateMatrixWorld(true);
  };
  // The two exported rigs face opposite directions inside their Player groups.
  // Raise outward from the actual shoulder rather than assuming a fixed X sign.
  const shoulder = bones.get('mixamorigRightArm').getWorldPosition(new THREE.Vector3());
  const hips = bones.get('mixamorigHips').getWorldPosition(new THREE.Vector3());
  const side = Math.sign(shoulder.sub(hips).applyQuaternion(copy.getWorldQuaternion(new THREE.Quaternion()).invert()).x) || 1;
  aim('mixamorigRightArm', 'mixamorigRightForeArm', new THREE.Vector3(side*.65,.76,0));
  aim('mixamorigRightForeArm', 'mixamorigRightHand', new THREE.Vector3(side*.08,1,0));
  const times = [0,.4,.7,1,1.3,1.6,1.9,2.2,2.5,2.9,3.2];
  const tracks = rest.map(p => {
    const bone = copy.getObjectByName(p.name), values = [];
    for (let i = 0; i < times.length; i++) {
      const q = (i === 0 || i === times.length-1) ? p.quaternion.clone() : bone.quaternion.clone();
      if (boneKey(p.name) === 'mixamorigRightHand' && i > 1 && i < times.length-2) {
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), i%2 ? .48 : -.48));
      }
      q.toArray(values, i*4);
    }
    return new THREE.QuaternionKeyframeTrack(`${p.name}.quaternion`, times, values);
  });
  return new THREE.AnimationClip('AvatarWave', 3.2, tracks);
}

function inPlaceWalk(source, model, name = 'SoyuWalk') {
  const clip = source.clone();
  clip.name = name;
  const track = clip.tracks.find(t => boneKey(t.name) === 'mixamorigHips.position');
  const hips = model.getObjectByName(track?.name.slice(0, -9));
  if (!track || !hips) throw new Error('소유 걷기의 골반 동작을 찾지 못했어요.');
  model.updateMatrixWorld(true);
  // IdolRig rotates local -Z into world up. Remove only forward root travel,
  // measured in the rig's ground plane, preserving hip sway and vertical bob.
  const parentRotation = hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(parentRotation.clone().invert());
  const drift = new THREE.Vector3().fromArray(track.values, track.values.length - 3)
    .sub(new THREE.Vector3().fromArray(track.values));
  drift.addScaledVector(up, -drift.dot(up));
  const stride = drift.clone().multiply(hips.parent.getWorldScale(new THREE.Vector3())).length();
  const position = new THREE.Vector3();
  const start = track.times[0], duration = track.times.at(-1) - start;
  for (let i = 0; i < track.times.length; i++) {
    position.fromArray(track.values, i * 3)
      .addScaledVector(drift, -(track.times[i] - start) / duration)
      .toArray(track.values, i * 3);
  }
  return {clip, stride};
}

// Soyu uses her original Mixamo clip, identical to m003's basic motion test.
// Rika keeps the walk exported with her airship model.
export function createAvatarFactory({ rika, soyu, clips, soyuWalk, ruby }) {
  const rikaTemplate = clone(rika);
  rikaTemplate.getObjectByName('Character').visible = true;
  const sourceBind = bindQuaternions(rikaTemplate);
  const soyuTemplate = new THREE.Group();
  soyuTemplate.name = 'SoyuAvatar';
  const model = clone(soyu.model);
  for (const p of soyu.restPose) {
    const b = model.getObjectByName(p.name);
    b.position.copy(p.position); b.quaternion.copy(p.quaternion); b.scale.copy(p.scale);
  }
  soyuTemplate.add(model);
  const targetBind = bindQuaternions(model);
  const walk = inPlaceWalk(soyuWalk, model);
  const soyuClips = [walk.clip];
  model.rotation.y += Math.PI;
  // Average opposite gait phases for a neutral standing pose, as for Rika.
  const mixer = new THREE.AnimationMixer(soyuTemplate);
  const actions = soyuClips.map(c => mixer.clipAction(c));
  actions.forEach(a => a.play()); mixer.setTime(0);
  const first = poseNodes(soyuTemplate); mixer.setTime(walk.clip.duration / 2);
  for (const p of first) {
    const b = soyuTemplate.getObjectByName(p.name);
    p.position.lerp(b.position, .5);
    p.quaternion.slerp(b.quaternion, .5);
    p.scale.lerp(b.scale, .5);
  }
  actions.forEach(a => a.stop());
  for (const p of first) {
    const b = soyuTemplate.getObjectByName(p.name);
    b.position.copy(p.position); b.quaternion.copy(p.quaternion); b.scale.copy(p.scale);
  }
  soyuTemplate.updateMatrixWorld(true);
  model.traverse(o => { if (o.isSkinnedMesh) {o.skeleton.update();o.computeBoundingBox();} });
  const bounds = new THREE.Box3().setFromObject(soyuTemplate);
  model.position.y -= bounds.min.y;
  mixer.uncacheRoot(soyuTemplate);
  const templates = { rika:rikaTemplate, soyu:soyuTemplate };
  const poses = { rika:poseNodes(rikaTemplate), soyu:poseNodes(soyuTemplate) };
  const walks = { rika:clips, soyu:soyuClips };
  const strides = { soyu:walk.stride };
  const extras = {};
  for (const kind of ['rika','soyu']) extras[kind] = {
    wave:waveClip(templates[kind]),
    dance:danceClip(templates[kind], kind === 'rika' ? sourceBind : targetBind, targetBind, soyu.motionData, kind === 'rika' ? 1.786/1.8 : 1),
  };
  if (ruby) {
    const template = new THREE.Group(); template.name = 'RubyAvatar';
    const visual = clone(ruby.scene); template.add(visual);
    visual.rotation.y += Math.PI;
    visual.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        material.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = dot(normal, vViewPosition) < 0.0 ? -normal : normal;'); };
        material.needsUpdate = true;
      }
    });
    const sourceWalk = ruby.animations.find(c => c.name === 'walking');
    const hiphop = ruby.animations.find(c => c.name === 'raise-roof');
    if (!sourceWalk || !hiphop) throw new Error('루비의 걷기·힙합 동작이 없습니다.');
    const nativeWalk = inPlaceWalk(sourceWalk, visual, 'RubyWalk');
    const preview = new THREE.AnimationMixer(template);
    preview.clipAction(nativeWalk.clip).play(); preview.setTime(0);
    const neutral = poseNodes(template); preview.setTime(nativeWalk.clip.duration / 2);
    for (const p of neutral) {
      const node = template.getObjectByName(p.name);
      p.position.lerp(node.position, .5); p.quaternion.slerp(node.quaternion, .5); p.scale.lerp(node.scale, .5);
    }
    preview.stopAllAction();
    for (const p of neutral) {
      const node = template.getObjectByName(p.name);
      node.position.copy(p.position); node.quaternion.copy(p.quaternion); node.scale.copy(p.scale);
    }
    template.updateMatrixWorld(true);
    visual.traverse(o => { if (o.isSkinnedMesh) {o.skeleton.update();o.computeBoundingBox();} });
    visual.position.y -= new THREE.Box3().setFromObject(template).min.y;
    preview.uncacheRoot(template);
    templates.ruby = template; poses.ruby = poseNodes(template);
    walks.ruby = [nativeWalk.clip]; strides.ruby = nativeWalk.stride;
    extras.ruby = {wave:waveClip(template), dance:prepareTestClip(hiphop,visual,{loopBlend:.18})};
  }
  return {
    create(kind = 'rika') {
      kind = Object.hasOwn(templates, kind) ? kind : 'rika';
      const avatar = clone(templates[kind]);
      const visual = kind === 'rika' ? avatar.getObjectByName('Character') : avatar.children[0];
      const mixer = new THREE.AnimationMixer(avatar);
      const actions = walks[kind].map(c => mixer.clipAction(c));
      const pose = poses[kind].map(p => ({...p, object:avatar.getObjectByName(p.name)}));
      const height = kind === 'rika' ? 1.5 : 1.8;
      const motionActions = {walk:actions, wave:[mixer.clipAction(extras[kind].wave)], dance:[mixer.clipAction(extras[kind].dance)]};
      let current = 'idle';
      function animate(motion = 'idle', time = 0) {
        if (!Object.hasOwn(motionActions, motion)) motion = 'idle';
        if (current !== motion) {
          mixer.stopAllAction();
          for (const p of pose) {p.object.position.copy(p.position);p.object.quaternion.copy(p.quaternion);p.object.scale.copy(p.scale);}
          for (const action of motionActions[motion] || []) action.play();
          current = motion;
        }
        if (motion !== 'idle') mixer.setTime(time);
      }
      return {avatar, visual, mixer, actions, pose, height, kind, animate,
        stride:strides[kind] ?? null,
        durations:{walk:Math.max(...actions.map(a => a.getClip().duration)), wave:3.2, dance:extras[kind].dance.duration},
        motionState:()=>({action:current,rightHand:avatar.getObjectByName('mixamorigRightHand')?.getWorldPosition(new THREE.Vector3()).toArray()})};
    },
  };
}
