window.initAeroSpherePlanet = function () {
  console.log("[AeroSphere] Initializing Three.js planet...");

  const canvas = document.getElementById('aerosphere-planet-canvas');
  if (!canvas) {
    console.error("[AeroSphere] Canvas element not found!");
    return;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  window.__aero_scene = scene; // Export scene to allow dynamic entity injection

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.z = 6;

  // --- Planet geometry (smooth high-res sphere) ---
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

  const fragmentShader = `
    uniform vec3 colorCenter;
    uniform vec3 colorEdge;
    uniform float time;
    
    uniform float cloudDensity;
    uniform float stormIntensity;
    uniform float lavaIntensity;
    uniform float iceCoverage;
    uniform float vegetation;
    uniform float oceanLevel;
    uniform float landMass;
    uniform float techLevel;
    uniform vec3 sunDirection;
    uniform float shockwave;

    
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    // 3D Procedural Noise to fix Spherical UV pinching
    float random3(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453123);
    }

    float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(random3(i + vec3(0.0, 0.0, 0.0)), random3(i + vec3(1.0, 0.0, 0.0)), u.x),
                       mix(random3(i + vec3(0.0, 1.0, 0.0)), random3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
                   mix(mix(random3(i + vec3(0.0, 0.0, 1.0)), random3(i + vec3(1.0, 0.0, 1.0)), u.x),
                       mix(random3(i + vec3(0.0, 1.0, 1.0)), random3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
    }

    float fbm3(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
            value += amplitude * noise3(p);
            p *= 2.0;
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        // Use vPosition (Object Space) instead of vNormal (View Space) 
        // to ensure the procedural terrain texture stays locked to the rotating geometry
        vec3 pNormal = normalize(vPosition);
        
        vec3 q = vec3(0.);
        q.x = fbm3( pNormal * 5.0 + vec3(time * 0.01) );
        q.y = fbm3( pNormal * 5.0 + vec3(time * 0.012) );
        q.z = fbm3( pNormal * 5.0 + vec3(time * 0.015) );

        vec3 r = vec3(0.);
        r.x = fbm3( pNormal * 8.0 + 1.0*q + vec3(1.7,9.2,3.1) );
        r.y = fbm3( pNormal * 8.0 + 1.0*q + vec3(8.3,2.8,7.4) );
        r.z = fbm3( pNormal * 8.0 + 1.0*q + vec3(4.1,6.5,2.9) );

        // Land Mass modifier directly boosts the fractal terrain map over time
        float terrain = clamp(fbm3(pNormal * 5.0 + r) + (landMass * 0.35), 0.0, 1.0);
        
        vec3 landColor = mix(colorCenter, colorEdge, clamp(terrain * 1.5, 0.0, 1.0));
        vec3 dirtColor = vec3(0.35, 0.35, 0.38); // Cool neutral rock grey, completely void of orange!
        float dirtNoise = fbm3(pNormal * 20.0);
        float dirtMask = smoothstep(0.3, 0.7, dirtNoise) * clamp(landMass * 1.2, 0.0, 1.0);
        landColor = mix(landColor, dirtColor, dirtMask);
        
        
        
        float oceanMask = 0.0;
        if (oceanLevel > 0.001) {
            oceanMask = 1.0 - smoothstep(oceanLevel - 0.05, oceanLevel + 0.05, terrain);
        }
        
        vec3 oceanCol = vec3(0.05, 0.15, 0.25);
        vec3 finalColor = mix(landColor, oceanCol, oceanMask);
        
        // Fractured Patchy Vegetation
        float vegNoise = fbm3(pNormal * 25.0);
        float vegMask = 0.0;
        if (vegetation > 0.001) {
            vegMask = smoothstep(max(0.0, oceanLevel - 0.01), oceanLevel + 0.3, terrain) * (1.0 - smoothstep(0.6, 1.0, terrain));
            vegMask *= smoothstep(0.4, 0.6, vegNoise); // Scatters the jungle into organic patches
        }
        vec3 vegCol = vec3(0.1, 0.4, 0.15);
        finalColor = mix(finalColor, vegCol, vegMask * vegetation);
        
        // Fractured Patchy Ice
        float iceNoise = fbm3(pNormal * 18.0 + vec3(1.0, 1.0, time * 0.005));
        float iceMask = 0.0;
        if (iceCoverage > 0.001) {
            iceMask = smoothstep(1.0 - iceCoverage * 0.8, 1.0 - iceCoverage * 0.4, terrain);
            iceMask *= smoothstep(0.3, 0.7, iceNoise);
        }
        vec3 iceCol = vec3(0.85, 0.95, 1.0);
        // Slightly boost ice opacity so it doesn't look fully transparent
        finalColor = mix(finalColor, iceCol, clamp(iceMask, 0.0, 1.0) * min(iceCoverage * 2.0, 1.0));
        
        // Lava: sharp glowing ridges instead of blobs
        // Glow from lava should ignore day/night so we compute it early, but apply it later
        float magmaNoise = fbm3(pNormal * 12.0 + vec3(time * 0.01));
        float ridge = abs(magmaNoise - 0.5) * 2.0; 
        float crackMask = 0.0;
        if (lavaIntensity > 0.001) {
            crackMask = 1.0 - smoothstep(0.0, 0.15, ridge);
            crackMask *= (1.0 - oceanMask); // No lava underwater
        }
        
        // --- Day/Night Lighting Base ---
        vec3 normal = normalize(vNormal);
        float diffuse = max(dot(normal, normalize(sunDirection)), 0.0);
        float ambient = clamp(0.05 + (techLevel * 0.05), 0.0, 1.0);
        float dayLight = diffuse * 1.2 + ambient;
        
        // Darken terrain depending on time of day
        finalColor *= dayLight;
        
        // --- Emissive Additions (Self-Illuminating) ---
        // City Lights (Only appear at night on landmasses)
        if (techLevel > 0.001 && oceanMask < 0.1) {
            // High frequency, sharp dots threshold mapping for glowing pinpoints
            float cityNoise = clamp(pow(fbm3(pNormal * 150.0), 10.0) * 30.0, 0.0, 1.0);
            float nightMask = smoothstep(0.1, -0.1, diffuse); // Harder cutoff to only be strictly at night
            vec3 cityColor = vec3(1.0, 0.6, 0.2) * cityNoise * nightMask * techLevel;
            finalColor += cityColor * 2.0; // Boost only the dots
        }

        // Lava is emissive
        vec3 lavaCol = vec3(1.0, 0.3, 0.0) * (1.2 + sin(time * 5.0) * 0.3);
        finalColor = mix(finalColor, finalColor + lavaCol, crackMask * lavaIntensity);
        
        // --- Restore Clouds: realistic mapping ---
        float cloudNoise = fbm3(pNormal * 6.0 + vec3(time * 0.02, time * 0.03, time * 0.01));
        float cMask = 0.0;
        if (cloudDensity > 0.001) {
            cMask = smoothstep(0.8 - cloudDensity * 0.6, 1.0 - cloudDensity * 0.2, cloudNoise);
            cMask *= smoothstep(0.01, 0.05, cloudDensity); // Hard cull at 1% density
        }
        
        // Lightning is emissive
        float lightning = 0.0;
        if (stormIntensity > 0.01 && cloudDensity > 0.01) {
            float flash = pow(max(sin(time * 5.0 + fbm3(pNormal * 15.0) * 8.0), 0.0), 50.0);
            lightning = flash * stormIntensity * cMask;
        }
        
        vec3 cloudCol = mix(vec3(0.95, 0.95, 1.0), vec3(0.4, 0.45, 0.55), stormIntensity);
        // Fade clouds at night if unlit
        cloudCol *= mix(1.0, dayLight * 1.2, 0.8);
        cloudCol += vec3(0.9, 0.95, 1.0) * lightning * 3.0;
        
        // Add subtle cloud shadow
        finalColor = mix(finalColor, finalColor * 0.4, cMask * cloudDensity * 0.5);
        
        // Overlay clouds
        finalColor = mix(finalColor, cloudCol, clamp(cMask, 0.0, 1.0) * cloudDensity);

        vec3 viewDir = normalize(vViewPosition);
        float rim = 1.0 - max(dot(viewDir, normal), 0.0);
        rim = smoothstep(0.4, 1.0, rim);
        
        finalColor += colorEdge * rim * (1.0 + lavaIntensity);
        
        if (shockwave > 0.001) {
            float ring = sin(pNormal.y * 20.0 - (1.0 - shockwave) * 10.0);
            float ringMask = smoothstep(0.9, 1.0, ring) * shockwave;
            finalColor += vec3(0.5, 0.9, 0.7) * ringMask * 2.0;
            finalColor += vec3(0.5, 0.9, 0.7) * shockwave * 0.5; // Global flash
        }

        gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  const planetGeo = new THREE.SphereGeometry(1.6, 128, 128);
  const planetMat = new THREE.ShaderMaterial({
    uniforms: {
      colorCenter: { value: new THREE.Color(0xff1e00) },
      colorEdge: { value: new THREE.Color(0xff4400) },
      time: { value: 0.0 },
      cloudDensity: { value: 0.9 },
      stormIntensity: { value: 0.8 },
      lavaIntensity: { value: 1.0 },
      iceCoverage: { value: 0.0 },
      vegetation: { value: 0.0 },
      oceanLevel: { value: 0.0 },
      landMass: { value: 0.0 },
      techLevel: { value: 0.0 },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      shockwave: { value: 0.0 }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    opacity: 0.95
  });

  const planet = new THREE.Mesh(planetGeo, planetMat);
  scene.add(planet);

  // Expose materials to window for dynamic updating
  window.__aero_planetMat = planetMat;
  window.__aero_uniformTargets = {
    cloudDensity: 0.9,
    stormIntensity: 0.8,
    lavaIntensity: 1.0,
    iceCoverage: 0.0,
    vegetation: 0.0,
    oceanLevel: 0.0,
    landMass: 0.0,
    techLevel: 0.0,
    colorCenter: new THREE.Color(0xff1e00),
    colorEdge: new THREE.Color(0xff4400)
  };

  // Re-apply latest state explicitly so it isn't completely missed on default initialization hooks
  if (window.__aero_lastStateJSON) {
    window.updatePlanet(window.__aero_lastStateJSON);
  }

  window.triggerShockwave = function () {
    if (planetMat && planetMat.uniforms) {
      planetMat.uniforms.shockwave.value = 1.0;
    }
  };

  // --- Thin inner atmosphere shell (Fresnel-like edge glow) ---
  const innerAtmoGeo = new THREE.SphereGeometry(1.63, 64, 64);
  const innerAtmoMat = new THREE.MeshBasicMaterial({
    color: 0x40d0a0,
    transparent: true,
    opacity: 0.06,
    side: THREE.FrontSide,
  });
  const innerAtmo = new THREE.Mesh(innerAtmoGeo, innerAtmoMat);
  scene.add(innerAtmo);

  // --- Atmosphere glow ring ---
  const atmosphereGeo = new THREE.RingGeometry(1.62, 1.9, 64);
  const atmosphereMat = new THREE.MeshBasicMaterial({
    color: 0x50c0a0,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
  scene.add(atmosphere);

  window.__aero_atmoBaseMat = atmosphereMat;
  window.__aero_innerAtmoMat = innerAtmoMat;

  // --- Outer glow sphere (primary) ---
  const glowGeo = new THREE.SphereGeometry(1.78, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x40b090,
    transparent: true,
    opacity: 0.09,
    side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glow);

  window.__aero_glowMat = glowMat;

  // --- Secondary outer haze ---
  const hazeGeo = new THREE.SphereGeometry(2.1, 32, 32);
  const hazeMat = new THREE.MeshBasicMaterial({
    color: 0x2a8070,
    transparent: true,
    opacity: 0.04,
    side: THREE.BackSide,
  });
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  scene.add(haze);

  // --- Lighting ---
  const ambientLight = new THREE.AmbientLight(0x304860, 1.0);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0x60c0a0, 1.3);
  dirLight.position.set(3, 2, 4);
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x4090b0, 0.6);
  rimLight.position.set(-3, -1, -2);
  scene.add(rimLight);

  const topFill = new THREE.DirectionalLight(0x305060, 0.35);
  topFill.position.set(0, 4, 1);
  scene.add(topFill);

  // --- Starfield particles (dense layer) ---
  const starCount = 1400;
  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 50;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 50;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x8899aa,
    size: 0.04,
    transparent: true,
    opacity: 0.75,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // --- Bright accent stars ---
  const brightStarCount = 120;
  const brightGeo = new THREE.BufferGeometry();
  const brightPos = new Float32Array(brightStarCount * 3);
  for (let i = 0; i < brightStarCount; i++) {
    brightPos[i * 3] = (Math.random() - 0.5) * 45;
    brightPos[i * 3 + 1] = (Math.random() - 0.5) * 45;
    brightPos[i * 3 + 2] = (Math.random() - 0.5) * 45;
  }
  brightGeo.setAttribute('position', new THREE.BufferAttribute(brightPos, 3));
  const brightMat = new THREE.PointsMaterial({
    color: 0xccddee,
    size: 0.07,
    transparent: true,
    opacity: 0.9,
  });
  const brightStars = new THREE.Points(brightGeo, brightMat);
  scene.add(brightStars);

  // --- Animation loop ---
  const clock = new THREE.Clock();

  // --- Orbit Controls ---
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.minDistance = 2.0;
  controls.maxDistance = 15.0;

  window.__aero_viewMode = 'ORBIT';
  window.setCameraMode = function (mode) {
    window.__aero_viewMode = mode;
    if (mode === 'DESCENDING' || mode === 'ASCENDING') {
      controls.enabled = false;
    } else if (mode === 'ORBIT') {
      controls.enabled = true;
    }
  };

  function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    if (controls.enabled) {
      controls.update();
    }

    if (window.__aero_viewMode === 'DESCENDING') {
      const target = new THREE.Vector3(0, 0, 1.8);
      // CINEMATIC DESCENT: Slowed down to mask the 10-second Modal LLM generation latency!
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

    if (planetMat.uniforms) {
      planetMat.uniforms.time.value += delta;

      if (planetMat.uniforms.shockwave.value > 0.0) {
        planetMat.uniforms.shockwave.value -= delta * 0.8;
        if (planetMat.uniforms.shockwave.value < 0.0) planetMat.uniforms.shockwave.value = 0.0;
      }

      if (window.__aero_uniformTargets) {
        const lerpSpeed = delta * 1.5;
        const t = window.__aero_uniformTargets;
        const u = planetMat.uniforms;

        u.cloudDensity.value += (t.cloudDensity - u.cloudDensity.value) * lerpSpeed;
        u.stormIntensity.value += (t.stormIntensity - u.stormIntensity.value) * lerpSpeed;
        u.lavaIntensity.value += (t.lavaIntensity - u.lavaIntensity.value) * lerpSpeed;
        u.iceCoverage.value += (t.iceCoverage - u.iceCoverage.value) * lerpSpeed;
        u.vegetation.value += (t.vegetation - u.vegetation.value) * lerpSpeed;
        u.oceanLevel.value += (t.oceanLevel - u.oceanLevel.value) * lerpSpeed;
        u.landMass.value += (t.landMass - u.landMass.value) * lerpSpeed;
        u.techLevel.value += (t.techLevel - u.techLevel.value) * lerpSpeed;

        // Animate the sun direction vector deterministically via time
        const sunAngle = u.time.value * 0.25;
        u.sunDirection.value.set(Math.cos(sunAngle), 0.2, Math.sin(sunAngle)).normalize();

        u.colorCenter.value.lerp(t.colorCenter, lerpSpeed);
        u.colorEdge.value.lerp(t.colorEdge, lerpSpeed);

        if (window.__aero_atmoBaseMat) window.__aero_atmoBaseMat.color.lerp(t.colorEdge, lerpSpeed);
        if (window.__aero_innerAtmoMat) window.__aero_innerAtmoMat.color.lerp(t.colorEdge, lerpSpeed);
        if (window.__aero_glowMat) window.__aero_glowMat.color.lerp(t.colorEdge, lerpSpeed);
      }
    }

    planet.rotation.y += 0.0012;
    planet.rotation.x += 0.0003;
    atmosphere.rotation.z -= 0.0008;
    glow.rotation.y -= 0.0005;
    haze.rotation.y += 0.0003;

    if (window.__aero_entities) {
      window.__aero_entities.forEach(mesh => {
        if (mesh.userData && mesh.userData.orbitAxis) {
          mesh.position.applyAxisAngle(mesh.userData.orbitAxis, mesh.userData.speed);
          mesh.rotation.x += mesh.userData.speed;
          mesh.rotation.y += mesh.userData.speed;
        }
      });
    }
    stars.rotation.y += 0.00015;

    // --- Update Dynamic Vector SVGs Screen Positions ---
    if (window.__aero_activeLifeforms) {
      const p = new THREE.Vector3();
      window.__aero_activeLifeforms.forEach(lf => {
        // Lat/Lon to cartesian mapping (assuming local scale)
        const lat = lf.lat * (Math.PI / 180);
        const lon = lf.lon * (Math.PI / 180);
        // Radius is 1.7 based on sphere geometry scale
        p.set(
          1.7 * Math.cos(lat) * Math.sin(lon),
          1.7 * Math.sin(lat),
          1.7 * Math.cos(lat) * Math.cos(lon)
        );

        // Apply planet's current world matrix exactly so they rotate with it!
        p.applyMatrix4(planet.matrixWorld);

        // Project Vector3 to normalized screen space
        p.project(camera);

        // Check if behind the planet (z > 1 implies occluded loosely)
        if (p.z > 1) {
          lf.element.style.display = 'none';
        } else {
          lf.element.style.display = 'flex';
          // Map strictly to px coordinates on canvas bounding rect
          const rect = canvas.getBoundingClientRect();
          const x = (p.x * 0.5 + 0.5) * rect.width;
          const y = (-(p.y * 0.5) + 0.5) * rect.height;
          lf.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
          lf.element.style.zIndex = Math.round((1 - p.z) * 100);
        }
      });
    }
    brightStars.rotation.y -= 0.0001;
    renderer.render(scene, camera);
  }
  animate();

  // --- Resize handler ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Interaction Raycaster for Interventions ---
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  window.addEventListener('click', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    if (window.__aero_entities) {
      const intersects = raycaster.intersectObjects(window.__aero_entities);
      if (intersects.length > 0) {
        const entity = intersects[0].object;
        entity.material.emissive.setHex(0xffffff);
        setTimeout(() => entity.material.emissive.setHex(entity.material.color.getHex()), 200);

        const promptTarget = document.querySelector("#hidden_interact_payload textarea");
        const btnTarget = document.querySelector("#hidden_interact_btn");
        if (promptTarget && btnTarget) {
          promptTarget.value = `[INTERVENTION] The User physically interacted with the ${entity.userData.name} orbiting the planet. Generate a highly consequential narrative and evolve the physical terrain heavily!`;
          promptTarget.dispatchEvent(new Event("input"));
          btnTarget.click();
        }
      }
    }
  });

  // Inject the SVG Render Core layer securely over the Canvas
  const svgLayer = document.createElement('div');
  svgLayer.id = 'svg-lifeform-layer';
  svgLayer.style.position = 'fixed';
  svgLayer.style.top = '0';
  svgLayer.style.left = '0';
  svgLayer.style.width = '100vw';
  svgLayer.style.height = '100vh';
  svgLayer.style.pointerEvents = 'none'; // Canvas needs to trap mouse controls underneath
  svgLayer.style.overflow = 'hidden';
  svgLayer.style.zIndex = '50';
  document.body.appendChild(svgLayer); // append directly to body avoiding Gradio class misses

  window.__aero_activeLifeforms = [];

  console.log("[AeroSphere] Planet initialized successfully.");
};

// =========================================================
// The global API called by Gradio's .change() hook
// This MUST be outside initAeroSpherePlanet so it's
// available before the planet loads (Gradio wires it early)
// =========================================================
window.updatePlanet = function (stateJSON) {
  if (typeof THREE === "undefined" || !window.THREE) return;
  if (!stateJSON) return;

  if (typeof stateJSON === 'string') {
    try {
      stateJSON = JSON.parse(stateJSON);
    } catch (e) {
      console.warn("Invalid payload received from Python bridge:", e);
      return;
    }
  }

  window.__aero_lastStateJSON = stateJSON; // store for bootstrap persistence

  console.log("[AeroSphere] Updating planet with parsed state:", stateJSON);

  if (stateJSON.planet_color_hex && window.__aero_uniformTargets) {
    window.__aero_uniformTargets.colorCenter.set(stateJSON.planet_color_hex);

    // Create a beautifully darkened gradient edge automatically to suppress muddy artifact mixing
    let baseColor = new THREE.Color(stateJSON.planet_color_hex);

    // Extract HSL manually and drop lightness massively to simulate dramatic edge lighting / occlusion
    let hsl = {};
    baseColor.getHSL(hsl);
    baseColor.setHSL(hsl.h, hsl.s * 0.5, hsl.l * 0.25);

    window.__aero_uniformTargets.colorEdge.set(baseColor);
  }

  if (window.__aero_uniformTargets) {
    if (stateJSON.cloud_density !== undefined) window.__aero_uniformTargets.cloudDensity = stateJSON.cloud_density;
    if (stateJSON.storm_intensity !== undefined) window.__aero_uniformTargets.stormIntensity = stateJSON.storm_intensity;
    if (stateJSON.lava_intensity !== undefined) window.__aero_uniformTargets.lavaIntensity = stateJSON.lava_intensity;
    if (stateJSON.ice_coverage !== undefined) window.__aero_uniformTargets.iceCoverage = stateJSON.ice_coverage;
    if (stateJSON.vegetation !== undefined) window.__aero_uniformTargets.vegetation = stateJSON.vegetation;
    if (stateJSON.ocean_level !== undefined) window.__aero_uniformTargets.oceanLevel = stateJSON.ocean_level;
    if (stateJSON.land_mass !== undefined) window.__aero_uniformTargets.landMass = stateJSON.land_mass;
    if (stateJSON.tech_level !== undefined) window.__aero_uniformTargets.techLevel = stateJSON.tech_level;
  }

  // Procedural WebGL Native Evolution Generation (Zero Latency!)
  if (window.__aero_scene) {
    if (window.__aero_entities) {
      window.__aero_entities.forEach(m => { window.__aero_scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
    }
    window.__aero_entities = [];

    let tech = stateJSON.tech_level || 0.0;
    let veg = stateJSON.vegetation || 0.0;
    let era = stateJSON.current_era || "";

    // 1. Spawning Oceans/Forests (Microbial/Flora phase)
    if (veg > 0.1) {
      let count = Math.floor(veg * 50);
      let geo = new THREE.DodecahedronGeometry(0.04, 0);
      let mat = new THREE.MeshBasicMaterial({ color: 0x11aa44, transparent: true, opacity: 0.8 });
      for (let i = 0; i < count; i++) {
        let m = new THREE.Mesh(geo, mat);
        let phi = Math.acos(Math.random() * 2 - 1);
        let theta = Math.random() * Math.PI * 2;
        let p = new THREE.Vector3().setFromSphericalCoords(1.01, phi, theta);
        m.position.copy(p);
        window.__aero_scene.add(m);
        window.__aero_entities.push(m);
      }
    }

    // 2. Spawning Cities / Architecture
    if (tech > 0.1) {
      let numCities = Math.floor(tech * 60);
      let geo = new THREE.CylinderGeometry(0.01, 0.02, 0.05, 4);
      let mat = new THREE.MeshBasicMaterial({ color: 0xffdd44, wireframe: tech > 0.5 });
      for (let i = 0; i < numCities; i++) {
        let m = new THREE.Mesh(geo, mat);
        let phi = Math.acos(Math.random() * 2 - 1);
        let theta = Math.random() * Math.PI * 2;
        let p = new THREE.Vector3().setFromSphericalCoords(1.0, phi, theta);
        m.position.copy(p);
        m.lookAt(new THREE.Vector3(0, 0, 0));
        m.rotateX(Math.PI / 2);
        window.__aero_scene.add(m);
        window.__aero_entities.push(m);
      }
    }

    // 3. Orbiting Satellites (Advanced)
    if (era.includes("ADVANCED") || tech > 0.8) {
      let geo = new THREE.TorusGeometry(1.2, 0.005, 8, 50);
      let mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 });
      let ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 3;
      window.__aero_scene.add(ring);
      window.__aero_entities.push(ring);
    }
  }

  // Old render logic successfully excised.

  if (stateJSON.atmosphere_color_hex) {
    if (window.__aero_uniformTargets) {
      window.__aero_uniformTargets.colorEdge.set(stateJSON.atmosphere_color_hex);
    }
  }
};

// --- Draggable UI Elements ---
function makeDraggable(panel) {
  panel.style.cursor = 'grab';
  let isDragging = false;
  let offsetX = 0; let offsetY = 0;

  panel.addEventListener('pointerdown', function (e) {
    const isInteractive = e.target.closest('button, input, textarea, a, select, summary, .aerosphere-range-slider');
    if (isInteractive || e.button !== 0) return;

    let rect = panel.getBoundingClientRect();
    if (!panel.dataset.detached) {
      panel.style.width = rect.width + 'px';
      panel.style.height = rect.height + 'px';
      panel.style.position = 'fixed';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      panel.style.margin = '0';
      panel.dataset.detached = 'true';
    } else {
      rect = panel.getBoundingClientRect(); // re-eval purely if already detached
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

  const onUp = function () {
    if (isDragging) {
      isDragging = false;
      panel.style.cursor = 'grab';
      document.body.style.userSelect = '';
    }
  };

  window.addEventListener('pointermove', function (e) {
    if (!isDragging) return;
    panel.style.left = (e.clientX - offsetX) + 'px';
    panel.style.top = (e.clientY - offsetY) + 'px';
  });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

const uiObserver = new MutationObserver(() => {
  const panels = document.querySelectorAll('.aerosphere-glass-panel:not(.draggable-initialized)');
  panels.forEach(p => {
    p.classList.add('draggable-initialized');
    makeDraggable(p);
  });
});
uiObserver.observe(document.body, { childList: true, subtree: true });

// =========================================================
// AEROSPHERE - DYNAMIC HUD LOGIC
// =========================================================

// Action status management
window.handleAction = function (type) {
  const actionStatusEl = document.getElementById('action-status');
  if (!actionStatusEl) return;

  if (type === 'stabilize') {
    actionStatusEl.textContent = '⟐ Core stabilization in progress...';
    actionStatusEl.style.color = 'rgba(100, 200, 180, 0.6)';
    setTimeout(() => {
      actionStatusEl.textContent = '✓ Core stabilized — nominal';
      setTimeout(() => {
        actionStatusEl.textContent = 'Awaiting directive';
        actionStatusEl.style.color = 'rgba(100, 200, 180, 0.35)';
      }, 3000);
    }, 2000);
  } else if (type === 'extract') {
    actionStatusEl.textContent = '⟐ Extracting luminescent field...';
    actionStatusEl.style.color = 'rgba(200, 180, 100, 0.6)';
    setTimeout(() => {
      actionStatusEl.textContent = '✓ Luminescence captured — 340 lux';
      setTimeout(() => {
        actionStatusEl.textContent = 'Awaiting directive';
        actionStatusEl.style.color = 'rgba(100, 200, 180, 0.35)';
      }, 3000);
    }, 2500);
  } else if (type === 'submit') {
    actionStatusEl.textContent = '⟐ Processing command...';
    actionStatusEl.style.color = 'rgba(160, 185, 200, 0.6)';
    setTimeout(() => {
      actionStatusEl.textContent = 'Awaiting directive';
      actionStatusEl.style.color = 'rgba(100, 200, 180, 0.35)';
    }, 1500);
  }
}

// Wire up Gradio Slider to our custom HTML elements
function initTelemetrySlider() {
  const checkExist = setInterval(function () {
    // Gradio injects an input[type='range']
    const slider = document.querySelector('.aerosphere-range-slider input[type="range"]');
    if (slider) {
      const valueDisplay = document.getElementById('telemetry-value');
      const telemetryBar = document.getElementById('telemetry-bar');

      const updateSliderVisuals = () => {
        const val = slider.value;
        if (valueDisplay) valueDisplay.textContent = val;
        if (telemetryBar) telemetryBar.style.width = val + '%';

        if (valueDisplay) {
          if (val < 30) {
            valueDisplay.style.color = 'rgba(220, 120, 80, 0.85)';
          } else if (val > 80) {
            valueDisplay.style.color = 'rgba(100, 220, 200, 0.95)';
          } else {
            valueDisplay.style.color = 'rgba(140, 210, 220, 0.85)';
          }
        }
      };

      slider.addEventListener('input', updateSliderVisuals);
      slider.addEventListener('change', updateSliderVisuals);

      updateSliderVisuals();
      clearInterval(checkExist);
    }
  }, 500);
}

// Live Clock in Narrative Timestamp
function updateTimestamp() {
  const el = document.getElementById('narrative-timestamp');
  if (!el) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `◆ Timestamp: 2387.04.11 · ${h}:${m}:${s} UTC · Cipher: OMICRON-7`;
}
setInterval(updateTimestamp, 1000);

// Simulated Live Telemetry Fluctuation
function fluctuateStatus() {
  const hullEl = document.getElementById('status-hull');
  const shieldEl = document.getElementById('status-shields');
  if (hullEl) {
    const hull = (97 + Math.random() * 2).toFixed(1);
    hullEl.textContent = hull + '%';
  }
  if (shieldEl) {
    const shields = (68 + Math.random() * 8).toFixed(1);
    shieldEl.textContent = shields + '%';
    if (parseFloat(shields) < 72) {
      shieldEl.classList.add('warning');
    } else {
      shieldEl.classList.remove('warning');
    }
  }

  // Custom Hook to sync Gradio changes since Python updates the values.
  const actionStatus = document.getElementById('action-status');
  const activeAction = document.getElementById('active-action');
  const uiContainer = document.getElementById('aerosphere-ui');

  const telemetryValue = document.getElementById('telemetry-value');
  const telemetryBar = document.getElementById('telemetry-bar');
  const slider = document.querySelector('.aerosphere-range-slider input[type="range"]');
  if (slider && telemetryValue && telemetryValue.textContent !== slider.value) {
    telemetryValue.textContent = slider.value;
    if (telemetryBar) telemetryBar.style.width = slider.value + '%';
    const val = parseInt(slider.value, 10);
    if (val < 30) {
      telemetryValue.style.color = 'rgba(220, 120, 80, 0.85)';
    } else if (val > 80) {
      telemetryValue.style.color = 'rgba(100, 220, 200, 0.95)';
    } else {
      telemetryValue.style.color = 'rgba(140, 210, 220, 0.85)';
    }
  }
}
setInterval(fluctuateStatus, 3000);

// Call init helpers
initTelemetrySlider();