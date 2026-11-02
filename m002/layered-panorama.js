import * as THREE from 'three';

// Image-only multi-sphere panorama. Each RGBA layer has its own physical radius;
// translating the camera reveals genuine motion parallax, with no video or AI runtime.
export async function createLayeredPanorama({ manifestURL, loader, renderer }) {
  const url = new URL(manifestURL, location.href);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`입체 파노라마 설정을 읽지 못했어요 (${response.status}).`);
  const config = await response.json();
  const loaded = [];
  // Finish every pending load before cleanup, including when another layer failed.
  const results = await Promise.allSettled(config.layers.map(async layer => {
    const texture = await loader.loadAsync(new URL(layer.image, url).href);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    loaded.push(texture);
    return { ...layer, texture };
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) { loaded.forEach(texture => texture.dispose()); throw failure.reason; }

  const root = new THREE.Group(); root.name = 'LayeredImagePanorama'; root.visible = false;
  const geometry = new THREE.SphereGeometry(1, 128, 64);
  const anchor = new THREE.Vector3(...(config.anchor || [0, 70, 0]));
  const observer = new THREE.Vector3(), displacement = new THREE.Vector3();
  const settings = { amount: 1, clouds: true, preview: false };
  const layers = results.map(({ value: layer }, index) => {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { image: { value: layer.texture }, seam: { value: .045 } },
      vertexShader: `varying vec3 vLocal;
        void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform sampler2D image;uniform float seam;varying vec3 vLocal;
        const float PI=3.141592653589793;
        void main(){
          vec3 d=normalize(vLocal);
          vec2 uv=vec2(fract(.5+atan(d.x,-d.z)/(2.*PI)),.5+asin(clamp(d.y,-1.,1.))/PI);
          // Overlap the two image edges instead of exposing an AI panorama's hard seam.
          float u=uv.x*(1.-seam)+seam;
          vec4 a=texture2D(image,vec2(u,uv.y));
          vec4 b=texture2D(image,vec2(max(0.,u-(1.-seam)),uv.y));
          float blend=smoothstep(1.-seam,1.,u);
          float alpha=mix(a.a,b.a,blend);
          vec3 rgb=mix(a.rgb*a.a,b.rgb*b.a,blend)/max(alpha,.00001);
          if(alpha<.003)discard;
          gl_FragColor=vec4(rgb,alpha);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Panorama-${layer.id}`;
    mesh.scale.setScalar(layer.radius);
    mesh.rotation.y = layer.rotation || 0;
    mesh.renderOrder = -30 + index;
    mesh.frustumCulled = false;
    root.add(mesh);
    return { ...layer, mesh };
  });

  function update(camera, elapsed) {
    if (!root.visible) return;
    camera.getWorldPosition(observer);
    // Bound the virtual viewpoint well inside the nearest sphere, even from overview.
    displacement.copy(observer).sub(anchor);
    if (settings.preview) {
      displacement.x += Math.sin(elapsed * .38) * 12;
      displacement.z += (Math.cos(elapsed * .38) - 1) * 4;
    }
    displacement.clampLength(0, 80);
    for (const layer of layers) {
      const parallax = layer.fixedSky ? 0 : settings.amount;
      layer.mesh.position.copy(observer).addScaledVector(displacement, -parallax);
      layer.mesh.rotation.y = (layer.rotation || 0) +
        (layer.cloud && settings.clouds ? elapsed * (layer.drift || .002) : 0);
      layer.mesh.visible = !layer.cloud || settings.clouds;
    }
  }

  return {
    root,
    environment: layers.find(layer => layer.fixedSky)?.texture || layers[0].texture,
    update,
    configure(next) {
      if (Number.isFinite(next.amount)) settings.amount = THREE.MathUtils.clamp(next.amount, 0, 2);
      if (typeof next.clouds === 'boolean') settings.clouds = next.clouds;
      if (typeof next.preview === 'boolean') settings.preview = next.preview;
    },
    getState: () => ({ ...settings, visible: root.visible, layers: layers.map(layer => ({
      id: layer.id, radius: layer.radius, cloud: !!layer.cloud, fixedSky: !!layer.fixedSky,
      visible: layer.mesh.visible, position: layer.mesh.position.toArray(), rotation: layer.mesh.rotation.y,
    })) }),
    dispose() {
      root.removeFromParent(); geometry.dispose();
      layers.forEach(layer => { layer.texture.dispose(); layer.mesh.material.dispose(); });
    },
  };
}
