import * as THREE from 'three';

// Work on copies: the original Mixamo motion files remain reusable unchanged.
export function prepareTestClip(source, model, { inPlace = false, loopBlend = 0 } = {}) {
  const clip = source.clone();
  if (inPlace) {
    const track = clip.tracks.find(t => /Hips\.position$/.test(t.name));
    const hips = track && model.getObjectByName(track.name.slice(0, -9));
    if (!hips) throw new Error('걷기 동작의 골반 뼈를 찾지 못했습니다.');
    model.updateMatrixWorld(true);
    const rotation = hips.parent.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation.invert());
    const travel = new THREE.Vector3().fromArray(track.values, track.values.length - 3)
      .sub(new THREE.Vector3().fromArray(track.values));
    // Soyu's rig uses local -Z as up. Keep vertical bob and lateral sway.
    travel.addScaledVector(up, -travel.dot(up));
    const p = new THREE.Vector3();
    const start = track.times[0], duration = track.times.at(-1) - start;
    for (let i = 0; i < track.times.length; i++) {
      p.fromArray(track.values, i * 3)
        .addScaledVector(travel, -(track.times[i] - start) / duration)
        .toArray(track.values, i * 3);
    }
  }
  // Raise The Roof has a small mismatch at the cut (up to 2.7 degrees).
  // Blend only its final few frames into the first pose for a clean repeat.
  if (loopBlend > 0) {
    for (const track of clip.tracks) {
      const size = track.getValueSize();
      const end = track.times.at(-1), start = Math.max(track.times[0], end - loopBlend);
      const first = Array.from(track.values.slice(0, size));
      const q = new THREE.Quaternion(), target = new THREE.Quaternion();
      if (track.ValueTypeName === 'quaternion') target.fromArray(first).normalize();
      for (let i = 0; i < track.times.length; i++) {
        if (track.times[i] <= start) continue;
        const t = (track.times[i] - start) / (end - start), weight = t * t * (3 - 2 * t);
        if (track.ValueTypeName === 'quaternion') {
          q.fromArray(track.values, i * size).normalize().slerp(target, weight).toArray(track.values, i * size);
        } else {
          for (let j = 0; j < size; j++) {
            const k = i * size + j;
            track.values[k] = THREE.MathUtils.lerp(track.values[k], first[j], weight);
          }
        }
      }
    }
  }
  return clip;
}
