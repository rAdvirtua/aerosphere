window.initAeroSpherePlanet = function () {
  console.log("[AeroSphere] Initializing Three.js planet...");

  // ── ADAPTIVE QUALITY TIER DETECTION ──────────────────────────────────────
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                 || window.innerWidth <= 768;
  console.log(`[AeroSphere] Device: ${isMobile ? "Mobile (low-quality tier)" : "Desktop (high-quality tier)"}`);

  const canvas = document.getElementById('aerosphere-planet-canvas');
  if (!canvas) { console.error("[AeroSphere] Canvas element not found!"); return; }

  // ── RENDERER ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,             // AA is very expensive on mobile, skip it
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Pixel ratio is the single biggest GPU fill-rate lever.
  // A 3× DPR phone at 1× still looks sharp enough; 2× would 9× the pixel count.
  renderer.setPixelRatio(
    isMobile ? Math.min(window.devicePixelRatio, 1.0)
             : Math.min(window.devicePixelRatio, 2.0)
  );
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  window.__aero_scene = scene;

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.z = 6;

  // ── VERTEX SHADER (unchanged) ─────────────────────────────────────────────
  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vUv = uv;
      vPosition = position;
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  // ── FRAGMENT SHADER ───────────────────────────────────────────────────────
  // Quality defines (injected via ShaderMaterial.defines at compile time):
  //
  //   FBM_OCTAVES      — 4 (desktop)  or 2 (mobile)
  //   SIMPLE_TERRAIN   — defined on mobile: 1 fbm3 call vs 7 (domain-warp)
  //   SKIP_CITY_LIGHTS — defined on mobile: skip city-lights AND lightning fbm3
  //
  // Desktop:  ~13 fbm3 calls × 4 octaves = ~52 noise samples per pixel
  // Mobile:   ~ 6 fbm3 calls × 2 octaves = ~12 noise samples per pixel  (4× fewer)
  const fragmentShader = `
    uniform vec3  colorCenter;
    uniform vec3  colorEdge;
    uniform float time;
    uniform float cloudDensity;
    uniform float stormIntensity;
    uniform float lavaIntensity;
    uniform float iceCoverage;
    uniform float vegetation;
    uniform float oceanLevel;
    uniform float landMass;
    uniform float techLevel;
    uniform vec3  sunDirection;
    uniform float shockwave;

    varying vec2  vUv;
    varying vec3  vPosition;
    varying vec3  vNormal;
    varying vec3  vViewPosition;

    float random3(vec3 p) {
      return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453123);
    }

    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(random3(i+vec3(0,0,0)), random3(i+vec3(1,0,0)), u.x),
            mix(random3(i+vec3(0,1,0)), random3(i+vec3(1,1,0)), u.x), u.y),
        mix(mix(random3(i+vec3(0,0,1)), random3(i+vec3(1,0,1)), u.x),
            mix(random3(i+vec3(0,1,1)), random3(i+vec3(1,1,1)), u.x), u.y), u.z);
    }

    // FBM_OCTAVES is injected by ShaderMaterial.defines — zero runtime branching
    float fbm3(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < FBM_OCTAVES; i++) {
        v += a * noise3(p);
        p *= 2.0; a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 pNormal = normalize(vPosition);

      // ── Terrain ──────────────────────────────────────────────────────
      float terrain;
#ifdef SIMPLE_TERRAIN
      // Mobile fast path: 1 fbm3 call (vs 7 for domain-warped version)
      terrain = clamp(fbm3(pNormal * 5.0) + landMass * 0.35, 0.0, 1.0);
#else
      // Desktop: full domain-warping for organic continent shapes (7 fbm3 calls)
      vec3 q;
      q.x = fbm3(pNormal * 5.0 + vec3(time * 0.010));
      q.y = fbm3(pNormal * 5.0 + vec3(time * 0.012));
      q.z = fbm3(pNormal * 5.0 + vec3(time * 0.015));
      vec3 r;
      r.x = fbm3(pNormal * 8.0 + 1.0*q + vec3(1.7, 9.2, 3.1));
      r.y = fbm3(pNormal * 8.0 + 1.0*q + vec3(8.3, 2.8, 7.4));
      r.z = fbm3(pNormal * 8.0 + 1.0*q + vec3(4.1, 6.5, 2.9));
      terrain = clamp(fbm3(pNormal * 5.0 + r) + landMass * 0.35, 0.0, 1.0);
#endif

      vec3 landColor = mix(colorCenter, colorEdge, clamp(terrain * 1.5, 0.0, 1.0));

#ifndef SIMPLE_TERRAIN
      // Extra dirt detail — one high-frequency fbm3 at pNormal*20 (desktop only)
      vec3  dirtColor = vec3(0.35, 0.35, 0.38);
      float dirtNoise = fbm3(pNormal * 20.0);
      float dirtMask  = smoothstep(0.3, 0.7, dirtNoise) * clamp(landMass * 1.2, 0.0, 1.0);
      landColor = mix(landColor, dirtColor, dirtMask);
#endif

      // ── Ocean ────────────────────────────────────────────────────────
      float oceanMask = 0.0;
      if (oceanLevel > 0.001)
        oceanMask = 1.0 - smoothstep(oceanLevel - 0.05, oceanLevel + 0.05, terrain);
      vec3 finalColor = mix(landColor, vec3(0.05, 0.15, 0.25), oceanMask);

      // ── Ice ──────────────────────────────────────────────────────────
      if (iceCoverage > 0.001) {
        float iceNoise = fbm3(pNormal * 18.0 + vec3(1.0, 1.0, time * 0.005));
        float iceMask  = smoothstep(1.0 - iceCoverage*0.8, 1.0 - iceCoverage*0.4, terrain)
                       * smoothstep(0.3, 0.7, iceNoise);
        finalColor = mix(finalColor, vec3(0.85, 0.95, 1.0),
                         clamp(iceMask, 0.0, 1.0) * min(iceCoverage * 2.0, 1.0));
      }

      // ── Vegetation ───────────────────────────────────────────────────
      if (vegetation > 0.001) {
        float vegNoise = fbm3(pNormal * 25.0);
        float vegMask  = smoothstep(max(0.0, oceanLevel - 0.01), oceanLevel + 0.3, terrain)
                       * (1.0 - smoothstep(0.6, 1.0, terrain))
                       * smoothstep(0.4, 0.6, vegNoise);
        finalColor = mix(finalColor, vec3(0.1, 0.4, 0.15), vegMask * vegetation);
      }

      // ── Lava cracks ──────────────────────────────────────────────────
      float crackMask = 0.0;
      if (lavaIntensity > 0.001) {
        float magmaNoise = fbm3(pNormal * 12.0 + vec3(time * 0.01));
        float ridge      = abs(magmaNoise - 0.5) * 2.0;
        crackMask = (1.0 - smoothstep(0.0, 0.15, ridge)) * (1.0 - oceanMask);
      }

      // ── Day / Night lighting ─────────────────────────────────────────
      vec3  normal   = normalize(vNormal);
      float diffuse  = max(dot(normal, normalize(sunDirection)), 0.0);
      float ambient  = clamp(0.05 + techLevel * 0.05, 0.0, 1.0);
      float dayLight = diffuse * 1.2 + ambient;
      finalColor *= dayLight;

      // ── City lights (desktop only — expensive high-freq fbm3 at *150) ─
#ifndef SKIP_CITY_LIGHTS
      if (techLevel > 0.001 && oceanMask < 0.1) {
        float cityNoise = clamp(pow(fbm3(pNormal * 150.0), 10.0) * 30.0, 0.0, 1.0);
        float nightMask = smoothstep(0.1, -0.1, diffuse);
        finalColor += vec3(1.0, 0.6, 0.2) * cityNoise * nightMask * techLevel * 2.0;
      }
#endif

      // ── Lava emissive ────────────────────────────────────────────────
      vec3 lavaCol = vec3(1.0, 0.3, 0.0) * (1.2 + sin(time * 5.0) * 0.3);
      finalColor = mix(finalColor, finalColor + lavaCol, crackMask * lavaIntensity);

      // ── Clouds ───────────────────────────────────────────────────────
      float cMask = 0.0;
      if (cloudDensity > 0.001) {
        float cloudNoise = fbm3(pNormal * 6.0 + vec3(time*0.02, time*0.03, time*0.01));
        cMask = smoothstep(0.8 - cloudDensity*0.6, 1.0 - cloudDensity*0.2, cloudNoise)
              * smoothstep(0.01, 0.05, cloudDensity);
      }

      // ── Lightning (desktop only — extra fbm3 per pixel inside cMask) ─
      float lightning = 0.0;
#ifndef SKIP_CITY_LIGHTS
      if (stormIntensity > 0.01 && cloudDensity > 0.01 && cMask > 0.0) {
        float flash = pow(max(sin(time*5.0 + fbm3(pNormal*15.0)*8.0), 0.0), 50.0);
        lightning = flash * stormIntensity * cMask;
      }
#endif

      vec3 cloudCol = mix(vec3(0.95,0.95,1.0), vec3(0.4,0.45,0.55), stormIntensity);
      cloudCol *= mix(1.0, dayLight * 1.2, 0.8);
      cloudCol += vec3(0.9, 0.95, 1.0) * lightning * 3.0;
      finalColor  = mix(finalColor, finalColor * 0.4, cMask * cloudDensity * 0.5);
      finalColor  = mix(finalColor, cloudCol, clamp(cMask, 0.0, 1.0) * cloudDensity);

      // ── Rim glow ─────────────────────────────────────────────────────
      vec3  viewDir = normalize(vViewPosition);
      float rim     = smoothstep(0.4, 1.0, 1.0 - max(dot(viewDir, normal), 0.0));
      finalColor += colorEdge * rim * (1.0 + lavaIntensity);

      // ── Shockwave ────────────────────────────────────────────────────
      if (shockwave > 0.001) {
        float ring     = sin(pNormal.y * 20.0 - (1.0 - shockwave) * 10.0);
        float ringMask = smoothstep(0.9, 1.0, ring) * shockwave;
        finalColor += vec3(0.5, 0.9, 0.7) * (ringMask * 2.0 + shockwave * 0.5);
      }

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  // ── PLANET MESH ───────────────────────────────────────────────────────────
  // 128×128 = 16 384 vertices (original) → 32×32 = 1 024 on mobile (16× fewer)
  const segs = isMobile ? 32 : 96;

  // Build defines object — presence of key = feature active (GLSL #ifdef/#ifndef)
  const shaderDefines = { FBM_OCTAVES: isMobile ? 2 : 4 };
  if (isMobile) {
    shaderDefines.SIMPLE_TERRAIN   = 1;   // single-pass terrain
    shaderDefines.SKIP_CITY_LIGHTS = 1;   // also skips lightning
  }

  const planetMat = new THREE.ShaderMaterial({
    defines: shaderDefines,
    uniforms: {
      colorCenter:    { value: new THREE.Color(0xff1e00) },
      colorEdge:      { value: new THREE.Color(0xff4400) },
      time:           { value: 0.0 },
      cloudDensity:   { value: 0.9 },
      stormIntensity: { value: 0.8 },
      lavaIntensity:  { value: 1.0 },
      iceCoverage:    { value: 0.0 },
      vegetation:     { value: 0.0 },
      oceanLevel:     { value: 0.0 },
      landMass:       { value: 0.0 },
      techLevel:      { value: 0.0 },
      sunDirection:   { value: new THREE.Vector3(1, 0, 0) },
      shockwave:      { value: 0.0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    opacity: 0.95,
  });

  const planet = new THREE.Mesh(new THREE.SphereGeometry(1.6, segs, segs), planetMat);
  scene.add(planet);

  window.__aero_planetMat = planetMat;
  window.__aero_uniformTargets = {
    cloudDensity:   0.9,  stormIntensity: 0.8,
    lavaIntensity:  1.0,  iceCoverage:    0.0,
    vegetation:     0.0,  oceanLevel:     0.0,
    landMass:       0.0,  techLevel:      0.0,
    colorCenter:    new THREE.Color(0xff1e00),
    colorEdge:      new THREE.Color(0xff4400),
  };

  if (window.__aero_lastStateJSON) window.updatePlanet(window.__aero_lastStateJSON);

  window.triggerShockwave = function () {
    if (planetMat?.uniforms) planetMat.uniforms.shockwave.value = 1.0;
  };

  // ── ATMOSPHERE LAYERS ─────────────────────────────────────────────────────
  // Reduce segment counts; skip the outermost haze sphere on mobile
  // (large semi-transparent sphere, minimal visual gain, extra draw call)
  const atmoSegs = isMobile ? 32 : 64;

  const innerAtmoMat = new THREE.MeshBasicMaterial({
    color: 0x40d0a0, transparent: true, opacity: 0.06, side: THREE.FrontSide,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.63, atmoSegs, atmoSegs), innerAtmoMat));
  window.__aero_innerAtmoMat = innerAtmoMat;

  const atmosphereMat = new THREE.MeshBasicMaterial({
    color: 0x50c0a0, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
  });
  const atmosphere = new THREE.Mesh(new THREE.RingGeometry(1.62, 1.9, atmoSegs), atmosphereMat);
  scene.add(atmosphere);
  window.__aero_atmoBaseMat = atmosphereMat;

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x40b090, transparent: true, opacity: 0.09, side: THREE.BackSide,
  });
  const glowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.78, isMobile ? 16 : 32, isMobile ? 16 : 32), glowMat
  );
  scene.add(glowMesh);
  window.__aero_glowMat = glowMat;

  // Outermost haze — large overdraw area, skip on mobile
  let hazeMesh = null;
  if (!isMobile) {
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0x2a8070, transparent: true, opacity: 0.04, side: THREE.BackSide,
    });
    hazeMesh = new THREE.Mesh(new THREE.SphereGeometry(2.1, 32, 32), hazeMat);
    scene.add(hazeMesh);
  }

  // ── LIGHTING ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x304860, 1.0));

  const dirLight = new THREE.DirectionalLight(0x60c0a0, 1.3);
  dirLight.position.set(3, 2, 4);
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x4090b0, 0.6);
  rimLight.position.set(-3, -1, -2);
  scene.add(rimLight);

  // Third fill light is subtle — skip on mobile to save one light calculation
  if (!isMobile) {
    const topFill = new THREE.DirectionalLight(0x305060, 0.35);
    topFill.position.set(0, 4, 1);
    scene.add(topFill);
  }

  // ── STARFIELD ─────────────────────────────────────────────────────────────
  function makeStars(count, size, color, opacity, spread) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3]   = (Math.random() - 0.5) * spread;
      pos[i*3+1] = (Math.random() - 0.5) * spread;
      pos[i*3+2] = (Math.random() - 0.5) * spread;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity }));
  }

  // 1400 → 600 main stars, 120 → 50 bright stars on mobile
  const stars       = makeStars(isMobile ? 600 : 1400, 0.04, 0x8899aa, 0.75, 50);
  const brightStars = makeStars(isMobile ?  50 :  120, 0.07, 0xccddee, 0.90, 45);
  scene.add(stars, brightStars);

  // ── ORBIT CONTROLS ────────────────────────────────────────────────────────
  const clock    = new THREE.Clock();
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan     = false;
  controls.minDistance   = 2.0;
  controls.maxDistance   = 15.0;

  window.__aero_viewMode = 'ORBIT';
  window.setCameraMode = function (mode) {
    window.__aero_viewMode = mode;
    controls.enabled = (mode === 'ORBIT');
  };

  // ── ANIMATION LOOP ────────────────────────────────────────────────────────
  // Frame limiter: 30 fps cap on mobile halves the number of shader executions
  // vs uncapped 60 fps. clock.getDelta() is always called first (even on skipped
  // frames) so the clock drains correctly — prevents a delta spike on the next
  // rendered frame after a run of skipped ones.
  const targetInterval = isMobile ? 1000 / 30 : 0; // 0 = uncapped on desktop
  let lastFrameTime    = 0;
  let frameCount       = 0;

  function animate(now) {
    requestAnimationFrame(animate);
    const delta = clock.getDelta(); // always drain, even on skipped frames

    if (isMobile && (now - lastFrameTime) < targetInterval) return;
    lastFrameTime = now;
    frameCount++;

    if (controls.enabled) controls.update();

    // ── Camera modes ──────────────────────────────────────────────────
    if (window.__aero_viewMode === 'DESCENDING') {
      const target = new THREE.Vector3(0, 0, 1.8);
      camera.position.lerp(target, delta * 0.4);
      camera.lookAt(0, 0, 0);
      if (camera.position.distanceTo(target) < 0.05) {
        window.__aero_viewMode = 'SURFACE';
        const svgLayer = document.getElementById('svg-lifeform-layer');
        if (svgLayer) svgLayer.style.display = 'block';
        const ascBtn = document.getElementById('aerosphere-ascend-btn');
        if (ascBtn) ascBtn.style.display = 'block';
      }
    } else if (window.__aero_viewMode === 'ASCENDING') {
      const target = new THREE.Vector3(0, 0, 6.0);
      camera.position.lerp(target, delta * 3.0);
      camera.lookAt(0, 0, 0);
      if (camera.position.distanceTo(target) < 0.1) {
        window.__aero_viewMode = 'ORBIT';
        controls.enabled = true;
        const svgLayer = document.getElementById('svg-lifeform-layer');
        if (svgLayer) svgLayer.style.display = 'none';
        const ascBtn = document.getElementById('aerosphere-ascend-btn');
        if (ascBtn) ascBtn.style.display = 'none';
      }
    }

    // ── Uniform updates ───────────────────────────────────────────────
    if (planetMat.uniforms) {
      planetMat.uniforms.time.value += delta;

      if (planetMat.uniforms.shockwave.value > 0.0) {
        planetMat.uniforms.shockwave.value = Math.max(0.0,
          planetMat.uniforms.shockwave.value - delta * 0.8
        );
      }

      // Upload lerp targets every frame on desktop; every 2nd frame on mobile
      // (lerp transitions are slow enough that one skipped upload is imperceptible)
      if (window.__aero_uniformTargets && (!isMobile || frameCount % 2 === 0)) {
        const ls = delta * 1.5;
        const t  = window.__aero_uniformTargets;
        const u  = planetMat.uniforms;

        u.cloudDensity.value   += (t.cloudDensity   - u.cloudDensity.value)   * ls;
        u.stormIntensity.value += (t.stormIntensity  - u.stormIntensity.value) * ls;
        u.lavaIntensity.value  += (t.lavaIntensity   - u.lavaIntensity.value)  * ls;
        u.iceCoverage.value    += (t.iceCoverage     - u.iceCoverage.value)    * ls;
        u.vegetation.value     += (t.vegetation      - u.vegetation.value)     * ls;
        u.oceanLevel.value     += (t.oceanLevel      - u.oceanLevel.value)     * ls;
        u.landMass.value       += (t.landMass        - u.landMass.value)       * ls;
        u.techLevel.value      += (t.techLevel       - u.techLevel.value)      * ls;

        const sunAngle = u.time.value * 0.25;
        u.sunDirection.value.set(Math.cos(sunAngle), 0.2, Math.sin(sunAngle)).normalize();

        u.colorCenter.value.lerp(t.colorCenter, ls);
        u.colorEdge.value.lerp(t.colorEdge, ls);
        if (window.__aero_atmoBaseMat)  window.__aero_atmoBaseMat.color.lerp(t.colorEdge, ls);
        if (window.__aero_innerAtmoMat) window.__aero_innerAtmoMat.color.lerp(t.colorEdge, ls);
        if (window.__aero_glowMat)      window.__aero_glowMat.color.lerp(t.colorEdge, ls);
      }
    }

    // ── Object rotations ──────────────────────────────────────────────
    planet.rotation.y     += 0.0012;
    planet.rotation.x     += 0.0003;
    atmosphere.rotation.z -= 0.0008;
    glowMesh.rotation.y   -= 0.0005;
    if (hazeMesh) hazeMesh.rotation.y += 0.0003;

    // ── Entity orbits ─────────────────────────────────────────────────
    if (window.__aero_entities) {
      window.__aero_entities.forEach(mesh => {
        if (mesh.userData?.orbitAxis) {
          mesh.position.applyAxisAngle(mesh.userData.orbitAxis, mesh.userData.speed);
          mesh.rotation.x += mesh.userData.speed;
          mesh.rotation.y += mesh.userData.speed;
        }
      });
    }

    stars.rotation.y       += 0.00015;
    brightStars.rotation.y -= 0.0001;

    // SVG lifeform projection — per-entity camera project + DOM write per frame.
    // Not used in mobile HUD, skip entirely to avoid unnecessary per-frame work.
    if (!isMobile && window.__aero_activeLifeforms?.length > 0) {
      const p    = new THREE.Vector3();
      const rect = canvas.getBoundingClientRect();
      window.__aero_activeLifeforms.forEach(lf => {
        const lat = lf.lat * Math.PI / 180;
        const lon = lf.lon * Math.PI / 180;
        p.set(
          1.7 * Math.cos(lat) * Math.sin(lon),
          1.7 * Math.sin(lat),
          1.7 * Math.cos(lat) * Math.cos(lon)
        );
        p.applyMatrix4(planet.matrixWorld).project(camera);
        if (p.z > 1) {
          lf.element.style.display = 'none';
        } else {
          const x = ( p.x * 0.5 + 0.5) * rect.width;
          const y = (-p.y * 0.5 + 0.5) * rect.height;
          lf.element.style.display   = 'flex';
          lf.element.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
          lf.element.style.zIndex    = Math.round((1 - p.z) * 100);
        }
      });
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate); // kick off via rAF to get proper timestamp

  // ── RESIZE (debounced) ────────────────────────────────────────────────────
  // Raw resize fires dozens of times during a drag or orientation change;
  // debouncing prevents thrashing renderer.setSize() on every micro-step.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, 150);
  });

  // ── INTERACTION RAYCASTER ─────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();
  window.addEventListener('click', (event) => {
    mouse.x =  (event.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    if (window.__aero_entities) {
      const hits = raycaster.intersectObjects(window.__aero_entities);
      if (hits.length > 0) {
        const entity = hits[0].object;
        entity.material.emissive.setHex(0xffffff);
        setTimeout(() => entity.material.emissive.setHex(entity.material.color.getHex()), 200);
        const promptTarget = document.querySelector('#hidden_interact_payload textarea');
        const btnTarget    = document.querySelector('#hidden_interact_btn');
        if (promptTarget && btnTarget) {
          promptTarget.value = `[INTERVENTION] The User physically interacted with the ${entity.userData.name} orbiting the planet. Generate a highly consequential narrative and evolve the physical terrain heavily!`;
          promptTarget.dispatchEvent(new Event('input'));
          btnTarget.click();
        }
      }
    }
  });

  // ── SVG LIFEFORM LAYER ────────────────────────────────────────────────────
  const svgLayer = document.createElement('div');
  svgLayer.id = 'svg-lifeform-layer';
  svgLayer.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;overflow:hidden;z-index:50;display:none;';
  document.body.appendChild(svgLayer);
  window.__aero_activeLifeforms = [];

  console.log('[AeroSphere] Planet initialized successfully.');
};

// =========================================================
// Global API — must stay outside initAeroSpherePlanet
// =========================================================
window.updatePlanet = function (stateJSON) {
  if (typeof THREE === "undefined" || !window.THREE) return;
  if (!stateJSON) return;

  if (typeof stateJSON === 'string') {
    try { stateJSON = JSON.parse(stateJSON); }
    catch (e) { console.warn("Invalid payload:", e); return; }
  }

  window.__aero_lastStateJSON = stateJSON;
  console.log("[AeroSphere] Updating planet:", stateJSON);

  if (stateJSON.planet_color_hex && window.__aero_uniformTargets) {
    window.__aero_uniformTargets.colorCenter.set(stateJSON.planet_color_hex);
    let base = new THREE.Color(stateJSON.planet_color_hex);
    let hsl  = {};
    base.getHSL(hsl);
    base.setHSL(hsl.h, hsl.s * 0.5, hsl.l * 0.25);
    window.__aero_uniformTargets.colorEdge.set(base);
  }

  if (window.__aero_uniformTargets) {
    const t  = window.__aero_uniformTargets;
    const sj = stateJSON;
    if (sj.cloud_density   !== undefined) t.cloudDensity   = sj.cloud_density;
    if (sj.storm_intensity !== undefined) t.stormIntensity = sj.storm_intensity;
    if (sj.lava_intensity  !== undefined) t.lavaIntensity  = sj.lava_intensity;
    if (sj.ice_coverage    !== undefined) t.iceCoverage    = sj.ice_coverage;
    if (sj.vegetation      !== undefined) t.vegetation     = sj.vegetation;
    if (sj.ocean_level     !== undefined) t.oceanLevel     = sj.ocean_level;
    if (sj.land_mass       !== undefined) t.landMass       = sj.land_mass;
    if (sj.tech_level      !== undefined) t.techLevel      = sj.tech_level;
  }

  // Procedural entity generation (unchanged from original)
  if (window.__aero_scene) {
    if (window.__aero_entities) {
      window.__aero_entities.forEach(m => {
        window.__aero_scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
    }
    window.__aero_entities = [];

    const tech = stateJSON.tech_level || 0.0;
    const veg  = stateJSON.vegetation  || 0.0;
    const era  = stateJSON.current_era || "";

    if (veg > 0.1) {
      const count = Math.floor(veg * 50);
      const geo   = new THREE.DodecahedronGeometry(0.04, 0);
      const mat   = new THREE.MeshBasicMaterial({ color: 0x11aa44, transparent: true, opacity: 0.8 });
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geo, mat);
        const phi   = Math.acos(Math.random() * 2 - 1);
        const theta = Math.random() * Math.PI * 2;
        m.position.setFromSphericalCoords(1.01, phi, theta);
        window.__aero_scene.add(m);
        window.__aero_entities.push(m);
      }
    }

    if (tech > 0.1) {
      const numCities = Math.floor(tech * 60);
      const geo       = new THREE.CylinderGeometry(0.01, 0.02, 0.05, 4);
      const mat       = new THREE.MeshBasicMaterial({ color: 0xffdd44, wireframe: tech > 0.5 });
      for (let i = 0; i < numCities; i++) {
        const m     = new THREE.Mesh(geo, mat);
        const phi   = Math.acos(Math.random() * 2 - 1);
        const theta = Math.random() * Math.PI * 2;
        m.position.setFromSphericalCoords(1.0, phi, theta);
        m.lookAt(new THREE.Vector3(0, 0, 0));
        m.rotateX(Math.PI / 2);
        window.__aero_scene.add(m);
        window.__aero_entities.push(m);
      }
    }

    if (era.includes("ADVANCED") || tech > 0.8) {
      const geo  = new THREE.TorusGeometry(1.2, 0.005, 8, 50);
      const mat  = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 3;
      window.__aero_scene.add(ring);
      window.__aero_entities.push(ring);
    }
  }

  if (stateJSON.atmosphere_color_hex && window.__aero_uniformTargets) {
    window.__aero_uniformTargets.colorEdge.set(stateJSON.atmosphere_color_hex);
  }
};

// ── Draggable panels ──────────────────────────────────────────────────────
function makeDraggable(panel) {
  panel.style.cursor = 'grab';
  let isDragging = false, offsetX = 0, offsetY = 0;

  panel.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button,input,textarea,a,select,summary,.aerosphere-range-slider') || e.button !== 0) return;
    let rect = panel.getBoundingClientRect();
    if (!panel.dataset.detached) {
      panel.style.width    = rect.width  + 'px';
      panel.style.height   = rect.height + 'px';
      panel.style.position = 'fixed';
      panel.style.left     = rect.left   + 'px';
      panel.style.top      = rect.top    + 'px';
      panel.style.right    = panel.style.bottom = panel.style.transform = panel.style.margin = 'unset';
      panel.dataset.detached = 'true';
    } else {
      rect = panel.getBoundingClientRect();
    }
    isDragging = true;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.style.cursor = 'grabbing';
    let maxZ = 1000;
    document.querySelectorAll('.aerosphere-glass-panel').forEach(p => {
      const z = parseInt(window.getComputedStyle(p).zIndex) || 10;
      if (z > maxZ) maxZ = z;
    });
    panel.style.zIndex = maxZ + 1;
    document.body.style.userSelect = 'none';
  });

  const onUp = () => { if (isDragging) { isDragging = false; panel.style.cursor = 'grab'; document.body.style.userSelect = ''; } };
  window.addEventListener('pointermove', e => { if (isDragging) { panel.style.left = (e.clientX - offsetX) + 'px'; panel.style.top = (e.clientY - offsetY) + 'px'; } });
  window.addEventListener('pointerup',     onUp);
  window.addEventListener('pointercancel', onUp);
}

const uiObserver = new MutationObserver(() => {
  document.querySelectorAll('.aerosphere-glass-panel:not(.draggable-initialized)').forEach(p => {
    p.classList.add('draggable-initialized');
    makeDraggable(p);
  });
});
uiObserver.observe(document.body, { childList: true, subtree: true });

// ── HUD helpers (unchanged) ───────────────────────────────────────────────
window.handleAction = function (type) {
  const el = document.getElementById('action-status');
  if (!el) return;
  const msgs = {
    stabilize: ['⟐ Core stabilization in progress...', 'rgba(100,200,180,0.6)', '✓ Core stabilized — nominal'],
    extract:   ['⟐ Extracting luminescent field...',   'rgba(200,180,100,0.6)', '✓ Luminescence captured — 340 lux'],
    submit:    ['⟐ Processing command...',             'rgba(160,185,200,0.6)', null],
  };
  const [start, color, end] = msgs[type] || msgs.submit;
  el.textContent = start; el.style.color = color;
  setTimeout(() => {
    if (end) { el.textContent = end; }
    setTimeout(() => { el.textContent = 'Awaiting directive'; el.style.color = 'rgba(100,200,180,0.35)'; }, 3000);
  }, type === 'extract' ? 2500 : 2000);
};

function initTelemetrySlider() {
  const checkExist = setInterval(() => {
    const slider = document.querySelector('.aerosphere-range-slider input[type="range"]');
    if (!slider) return;
    clearInterval(checkExist);
    const valueDisplay = document.getElementById('telemetry-value');
    const telemetryBar = document.getElementById('telemetry-bar');
    const update = () => {
      const val = slider.value;
      if (valueDisplay) {
        valueDisplay.textContent = val;
        valueDisplay.style.color = val < 30 ? 'rgba(220,120,80,0.85)' : val > 80 ? 'rgba(100,220,200,0.95)' : 'rgba(140,210,220,0.85)';
      }
      if (telemetryBar) telemetryBar.style.width = val + '%';
    };
    slider.addEventListener('input',  update);
    slider.addEventListener('change', update);
    update();
  }, 500);
}

function updateTimestamp() {
  const el = document.getElementById('narrative-timestamp');
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  el.textContent = `◆ Timestamp: 2387.04.11 · ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} UTC · Cipher: OMICRON-7`;
}
setInterval(updateTimestamp, 1000);

function fluctuateStatus() {
  const hullEl   = document.getElementById('status-hull');
  const shieldEl = document.getElementById('status-shields');
  if (hullEl)   hullEl.textContent   = (97 + Math.random() * 2).toFixed(1) + '%';
  if (shieldEl) {
    const val = (68 + Math.random() * 8).toFixed(1);
    shieldEl.textContent = val + '%';
    shieldEl.classList.toggle('warning', parseFloat(val) < 72);
  }
  const slider = document.querySelector('.aerosphere-range-slider input[type="range"]');
  const tv     = document.getElementById('telemetry-value');
  const tb     = document.getElementById('telemetry-bar');
  if (slider && tv && tv.textContent !== slider.value) {
    tv.textContent = slider.value;
    const val = parseInt(slider.value, 10);
    tv.style.color = val < 30 ? 'rgba(220,120,80,0.85)' : val > 80 ? 'rgba(100,220,200,0.95)' : 'rgba(140,210,220,0.85)';
    if (tb) tb.style.width = slider.value + '%';
  }
}
setInterval(fluctuateStatus, 3000);

initTelemetrySlider();