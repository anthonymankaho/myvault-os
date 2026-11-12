import * as THREE from "three";
import {
  SECTION_META,
  sectionMeta,
  hash01,
  layoutSolarSystems,
  starOrbitPosition,
} from "./constellation-systems.mjs?v=5";

const FOV = 46;
const DEG = Math.PI / 180;
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function glowTexture(size, stops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function ringTexture(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.strokeStyle = "rgba(255,255,255,.95)";
  context.lineWidth = size * 0.045;
  context.shadowColor = "rgba(255,255,255,.9)";
  context.shadowBlur = size * 0.08;
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  context.stroke();
  return new THREE.CanvasTexture(canvas);
}

function makeOrbitGeometry(radius, segments = 128) {
  const points = new Float32Array(segments * 3);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points[index * 3] = Math.cos(angle) * radius;
    points[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  return geometry;
}

function markup(systems, total) {
  const chips = systems
    .map(
      (system) =>
        `<button type="button" data-system-chip="${system.kind}" style="--section-color:${SECTION_META[system.kind].sun}"><i></i>${SECTION_META[system.kind].label}<small>${system.count}</small></button>`,
    )
    .join("");
  const legend = systems
    .map(
      (system) =>
        `<span><i style="--star-color:${SECTION_META[system.kind].star}"></i>${system.count} ${SECTION_META[system.kind].label.toLowerCase()}</span>`,
    )
    .join("");
  return `
    <div class="constellation-stage" data-constellation-stage>
      <div class="constellation-labels" data-constellation-labels aria-hidden="true"></div>
      <header class="constellation-title">
        <span>MYVAULT GALAXY · 我的星系</span>
        <strong>Every item a star, every section a solar system.</strong>
      </header>
      <div class="constellation-hud" aria-live="polite">
        <span data-constellation-mode>FREE ORBIT</span>
        <strong data-constellation-selection>No selection</strong>
      </div>
      <div class="constellation-search">
        <label class="visually-hidden" for="constellation-3d-query">Search every item in MyVault</label>
        <span aria-hidden="true">⌕</span>
        <input id="constellation-3d-query" data-constellation-query type="search" autocomplete="off" placeholder="Search every star…" />
        <div class="constellation-results" data-constellation-results hidden></div>
      </div>
      <nav class="constellation-systems" aria-label="Solar systems">${chips}</nav>
      <div class="constellation-legend" aria-label="Galaxy legend">${legend}</div>
      <div class="constellation-tools" aria-label="Galaxy controls">
        <button type="button" data-constellation-action="labels" aria-pressed="true">Labels</button>
        <button type="button" data-constellation-action="signals" aria-pressed="true">Links</button>
        <button type="button" data-constellation-action="motion" aria-pressed="true">Motion</button>
        <button type="button" data-constellation-action="rotate" aria-pressed="false">Rotate</button>
        <label class="constellation-slider">Glow<input type="range" data-constellation-glow min="40" max="180" value="100" aria-label="Star glow"></label>
        <label class="constellation-slider">Speed<input type="range" data-constellation-speed min="0" max="220" value="100" aria-label="Orbit speed"></label>
        <span aria-hidden="true"></span>
        <button type="button" data-constellation-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-constellation-zoom aria-label="Reset zoom">100%</button>
        <button type="button" data-constellation-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-constellation-action="reset">Reset</button>
      </div>
      <p class="constellation-hint">Drag to orbit · Scroll or pinch to zoom · Click a sun to visit its system · Click a star to open its record</p>
      ${total === 0 ? `<div class="constellation-empty"><span aria-hidden="true">✧</span><h2>Your galaxy is ready.</h2><p>Add projects, skills, documents, chats or tasks — each one becomes a star in its section's solar system.</p><button type="button" data-map-action="create">Create a project</button><button type="button" data-map-action="create-skill">Add a skill</button></div>` : ""}
      <aside class="constellation-detail" data-constellation-detail hidden aria-live="polite"></aside>
      <div class="constellation-unavailable" data-constellation-unavailable hidden>
        The interactive galaxy is unavailable in this browser. Use the section pages from the side control.
      </div>
    </div>`;
}

export function createMyVaultConstellation({ container, nodes, edges, onOpen }) {
  const abortController = new AbortController();
  const { signal } = abortController;
  const bind = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal });

  const { systems, positions } = layoutSolarSystems(nodes);
  container.innerHTML = markup(systems, nodes.length);
  const stage = container.querySelector("[data-constellation-stage]");
  const labelsHost = container.querySelector("[data-constellation-labels]");
  const queryInput = container.querySelector("[data-constellation-query]");
  const resultsHost = container.querySelector("[data-constellation-results]");
  const selectionText = container.querySelector("[data-constellation-selection]");
  const modeText = container.querySelector("[data-constellation-mode]");
  const detail = container.querySelector("[data-constellation-detail]");
  const zoomText = container.querySelector("[data-constellation-zoom]");
  const glowInput = container.querySelector("[data-constellation-glow]");
  const speedInput = container.querySelector("[data-constellation-speed]");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  queryInput.value = "";

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    abortController.abort();
    container.replaceChildren();
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.domElement.classList.add("constellation-canvas");
  renderer.domElement.setAttribute("aria-label", "Interactive MyVault galaxy — every item a star, every section a solar system");
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060a10, 0.0032);
  const graph = new THREE.Group();
  scene.add(graph);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2400);

  // ---- textures (built once, reused) ----
  const starTexture = glowTexture(64, [
    [0, "rgba(255,255,255,1)"],
    [0.18, "rgba(255,255,255,.95)"],
    [0.52, "rgba(255,255,255,.24)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const coronaTexture = glowTexture(128, [
    [0, "rgba(255,255,255,.9)"],
    [0.22, "rgba(255,255,255,.42)"],
    [0.55, "rgba(255,255,255,.12)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const selectionTexture = ringTexture(128);
  const nebulaTextures = ["#1b3a5c", "#3a1b5c", "#12453a", "#5c2a1b"].map((hue) =>
    glowTexture(256, [
      [0, `${hue}cc`],
      [0.4, `${hue}55`],
      [0.75, `${hue}18`],
      [1, `${hue}00`],
    ]),
  );

  // ---- deep-space background: two twinkling star layers + drifting nebulae ----
  const disposables = [];
  function backgroundLayer(count, radiusMin, radiusMax, size, color, opacity) {
    const array = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const radius = radiusMin + hash01(index, 30) * (radiusMax - radiusMin);
      const phi = Math.acos(2 * hash01(index, 31) - 1);
      const theta = hash01(index, 32) * Math.PI * 2;
      array[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      array[index * 3 + 1] = radius * Math.cos(phi);
      array[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      phases[index] = hash01(index, 33);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(array, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixels: { value: 400 },
        uSize: { value: size },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: `
        attribute float aPhase;
        varying float vPhase;
        uniform float uPixels;
        uniform float uSize;
        void main() {
          vPhase = aPhase;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * uPixels / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vPhase;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float twinkle = 0.7 + 0.3 * sin(uTime * (0.6 + vPhase) + vPhase * 40.0);
          float core = smoothstep(0.7, 0.0, d);
          float halo = pow(1.0 - d, 2.5);
          gl_FragColor = vec4(uColor, (core * 0.9 + halo * 0.35) * uOpacity * twinkle);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    disposables.push(geometry, material);
    return material;
  }
  const skyFar = backgroundLayer(900, 380, 900, 1.5, 0x93a7c9, 0.5);
  const skyNear = backgroundLayer(420, 200, 380, 2.1, 0xc9d8ee, 0.42);

  const nebulae = nebulaTextures.map((texture, index) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    const angle = (index / nebulaTextures.length) * Math.PI * 2 + 0.7;
    sprite.position.set(Math.cos(angle) * 420, (hash01(index, 40) - 0.5) * 260, Math.sin(angle) * 420);
    const scale = 320 + hash01(index, 41) * 220;
    sprite.scale.set(scale, scale, 1);
    scene.add(sprite);
    disposables.push(material);
    return sprite;
  });

  // ---- solar systems: sun, corona, light, orbit rings ----
  const sunGeometry = new THREE.SphereGeometry(2.7, 48, 48);
  disposables.push(sunGeometry);
  const sunUniforms = [];
  const systemObjects = systems.map((system) => {
    const meta = SECTION_META[system.kind];
    const color = new THREE.Color(meta.sun);
    const group = new THREE.Group();
    group.position.set(system.center.x, system.center.y, system.center.z);
    group.rotation.x = system.tilt;

    const uniforms = { uTime: { value: 0 }, uColor: { value: color } };
    sunUniforms.push(uniforms);
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.1);
          float bands = sin(vWorld.y * 5.0 + uTime * 1.1) * 0.5 + 0.5;
          float swirl = sin(vWorld.x * 3.4 - uTime * 0.7) * sin(vWorld.z * 3.4 + uTime * 0.5);
          float heat = 0.74 + 0.26 * bands * (0.6 + 0.4 * swirl);
          vec3 col = uColor * heat * 1.35 + vec3(1.0, 0.96, 0.86) * fres * 0.85;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sun = new THREE.Mesh(sunGeometry, material);
    group.add(sun);
    disposables.push(material);

    const coronaMaterial = new THREE.SpriteMaterial({
      map: coronaTexture,
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const corona = new THREE.Sprite(coronaMaterial);
    corona.scale.set(24, 24, 1);
    group.add(corona);
    disposables.push(coronaMaterial);

    const light = new THREE.PointLight(color, 260, system.radius * 6, 2);
    group.add(light);

    const ringMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(ringMaterial);
    const ringGeometries = [];
    for (let shell = 0; shell < system.shells; shell += 1) {
      const geometry = makeOrbitGeometry(system.baseRadius * (0.6 + shell * 0.4));
      ringGeometries.push(geometry);
      disposables.push(geometry);
      group.add(new THREE.LineLoop(geometry, ringMaterial));
    }
    graph.add(group);
    return { system, group, corona, coronaMaterial, ringGeometries };
  });

  // ---- item stars (one Points cloud, positions animated per frame) ----
  const nodeColors = new Float32Array(nodes.length * 3);
  const nodeSizes = new Float32Array(nodes.length);
  const nodePhases = new Float32Array(nodes.length);
  const starByIndex = new Map();
  systems.forEach((system) => {
    system.stars.forEach((star) => {
      starByIndex.set(star.index, { system, star });
      const color = new THREE.Color(SECTION_META[system.kind].star);
      nodeColors.set(color.toArray(), star.index * 3);
      nodeSizes[star.index] = star.size;
      nodePhases[star.index] = star.phase;
    });
  });
  const nodeGeometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  nodeGeometry.setAttribute("position", positionAttribute);
  nodeGeometry.setAttribute("color", new THREE.BufferAttribute(nodeColors, 3));
  nodeGeometry.setAttribute("aSize", new THREE.BufferAttribute(nodeSizes, 1));
  nodeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(nodePhases, 1));
  const nodeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPixels: { value: 400 },
      uScale: { value: 7.6 },
      uTime: { value: 0 },
      uGlow: { value: 1 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vPhase;
      uniform float uPixels;
      uniform float uScale;
      void main() {
        vColor = color;
        vPhase = aPhase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * uPixels / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vColor;
      varying float vPhase;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float twinkle = 0.88 + 0.12 * sin(uTime * 1.6 + vPhase * 6.2831);
        float core = smoothstep(0.62, 0.0, d);
        float halo = pow(1.0 - d, 2.6);
        vec3 col = vColor * (0.5 + core * 1.3) * uGlow * twinkle + vec3(core * 0.5);
        float alpha = min(1.0, (core * 0.98 + halo * 0.5) * uGlow);
        gl_FragColor = vec4(col, alpha);
      }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodePoints = new THREE.Points(nodeGeometry, nodeMaterial);
  nodePoints.frustumCulled = false;
  graph.add(nodePoints);
  disposables.push(nodeGeometry, nodeMaterial);

  const selectionMaterial = new THREE.SpriteMaterial({
    map: selectionTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const selectionRing = new THREE.Sprite(selectionMaterial);
  selectionRing.visible = false;
  graph.add(selectionRing);
  disposables.push(selectionMaterial);

  // ---- connection lines follow the moving stars ----
  const linePositions = new Float32Array(edges.length * 6);
  const lineColors = new Float32Array(edges.length * 6);
  edges.forEach((edge, index) => {
    lineColors.set(new THREE.Color(sectionMeta(nodes[edge.source].kind).star).toArray(), index * 6);
    lineColors.set(new THREE.Color(sectionMeta(nodes[edge.target].kind).star).toArray(), index * 6 + 3);
  });
  const lineGeometry = new THREE.BufferGeometry();
  const linePositionAttribute = new THREE.BufferAttribute(linePositions, 3);
  linePositionAttribute.setUsage(THREE.DynamicDrawUsage);
  lineGeometry.setAttribute("position", linePositionAttribute);
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  graph.add(lines);
  disposables.push(lineGeometry, lineMaterial);

  // ---- DOM labels: one per star + one per sun ----
  const labelPool = nodes.map((node) => {
    const label = document.createElement("span");
    label.className = "constellation-label";
    label.textContent = node.name;
    label.dataset.kind = node.kind;
    label.style.setProperty("--star-color", sectionMeta(node.kind).star);
    labelsHost.appendChild(label);
    return label;
  });
  const systemLabels = systemObjects.map(({ system }) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "constellation-system-label";
    label.style.setProperty("--section-color", SECTION_META[system.kind].sun);
    label.innerHTML = `<i></i>${SECTION_META[system.kind].label} <span lang="zh-Hant">${SECTION_META[system.kind].zh}</span><small>${system.count}</small>`;
    label.addEventListener("click", () => focusSystem(system.kind), { signal });
    labelsHost.appendChild(label);
    return label;
  });

  // ---- state ----
  let selectedIndex = -1;
  let focusedKind = null;
  let query = "";
  let showLabels = true;
  let signals = true;
  let motion = !reducedMotion;
  let spin = false;
  let speedFactor = 1;
  let animationFrame = 0;
  let lastTime = performance.now();
  let width = 1;
  let height = 1;
  let baseDistance = 160;
  const cameraState = {
    theta: 0.72,
    phi: 1.12,
    distance: 160,
    targetTheta: 0.72,
    targetPhi: 1.12,
    targetDistance: 160,
    target: new THREE.Vector3(0, 0, 0),
    targetGoal: new THREE.Vector3(0, 0, 0),
  };
  const screenNodes = nodes.map(() => ({ x: -100, y: -100, depth: 2, radius: 9 }));
  const screenSuns = systems.map(() => ({ x: -100, y: -100, depth: 2 }));
  const vector = new THREE.Vector3();
  const rankedLabels = nodes
    .map((node, index) => ({ node, index, score: edges.filter((edge) => edge.source === index || edge.target === index).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  function syncButtons() {
    const stateByAction = { labels: showLabels, signals, motion, rotate: spin };
    Object.entries(stateByAction).forEach(([action, active]) => {
      const button = container.querySelector(`[data-constellation-action="${action}"]`);
      button?.setAttribute("aria-pressed", String(active));
      button?.classList.toggle("is-active", active);
    });
    container.querySelectorAll("[data-system-chip]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.systemChip === focusedKind);
    });
  }

  function updateZoom() {
    zoomText.textContent = `${Math.round((baseDistance / cameraState.targetDistance) * 100)}%`;
  }

  function dolly(factor) {
    cameraState.targetDistance = Math.max(baseDistance * 0.16, Math.min(baseDistance * 2.4, cameraState.targetDistance * factor));
    updateZoom();
  }

  function fitAllDistance() {
    let radius = 24;
    systems.forEach((system) => {
      radius = Math.max(radius, Math.hypot(system.center.x, system.center.y, system.center.z) + system.radius);
    });
    const aspect = Math.max(0.25, width / Math.max(height, 1));
    const vertical = FOV * DEG;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    return (radius * 1.16) / Math.sin(Math.min(vertical, horizontal) / 2);
  }

  function focusSystem(kind) {
    const entry = systemObjects.find(({ system }) => system.kind === kind);
    if (!entry) return;
    focusedKind = kind;
    const { system } = entry;
    cameraState.targetGoal.set(system.center.x, system.center.y, system.center.z);
    const aspect = Math.max(0.25, width / Math.max(height, 1));
    const vertical = FOV * DEG;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    cameraState.targetDistance = Math.max(26, (system.radius * 1.5) / Math.sin(Math.min(vertical, horizontal) / 2));
    modeText.textContent = `FOCUS · ${SECTION_META[kind].label.toUpperCase()}`;
    syncButtons();
    updateZoom();
  }

  function resetCamera() {
    focusedKind = null;
    cameraState.targetTheta = 0.72;
    cameraState.targetPhi = 1.12;
    cameraState.targetGoal.set(0, 0, 0);
    cameraState.targetDistance = baseDistance;
    selectedIndex = -1;
    selectionRing.visible = false;
    selectionText.textContent = "No selection";
    detail.hidden = true;
    modeText.textContent = "FREE ORBIT";
    syncButtons();
    updateZoom();
  }

  function renderResults() {
    const normalized = query.trim().toLowerCase();
    const matches = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => !normalized || `${node.name} ${node.meta} ${node.description}`.toLowerCase().includes(normalized))
      .slice(0, 24);
    resultsHost.innerHTML = matches.length
      ? `<p>${normalized ? `${matches.length} matches` : "Every item in MyVault"}</p>${matches.map(({ node, index }) => `<button type="button" data-constellation-result="${index}"><i style="--star-color:${sectionMeta(node.kind).star}"></i><span>${escapeHtml(node.name)}</span><small>${sectionMeta(node.kind).label}</small></button>`).join("")}`
      : "<p>No stars match this search.</p>";
  }

  function selectNode(index, { open = false } = {}) {
    const node = nodes[index];
    if (!node) return;
    selectedIndex = index;
    spin = false;
    syncButtons();
    selectionText.textContent = node.name;
    const meta = sectionMeta(node.kind);
    const virtual = node.kind === "accounting" || node.kind === "games";
    detail.hidden = false;
    detail.innerHTML = `
      <button type="button" class="constellation-detail-close" aria-label="Close details">×</button>
      <span class="constellation-detail-section" style="--section-color:${meta.sun}"><i style="--star-color:${meta.star}"></i>${meta.kindLabel} · <span lang="zh-Hant">${meta.zh}</span></span>
      <h2>${escapeHtml(node.name)}</h2>
      <p>${escapeHtml(node.meta)}</p>
      <p>${escapeHtml(node.description) || "No notes yet."}</p>
      <button type="button" class="constellation-open-record">${virtual ? `Open ${meta.label} ↗` : "Open in MyVault"}</button>`;
    detail.querySelector(".constellation-detail-close").addEventListener("click", () => {
      selectedIndex = -1;
      selectionRing.visible = false;
      selectionText.textContent = "No selection";
      detail.hidden = true;
    }, { signal });
    detail.querySelector(".constellation-open-record").addEventListener("click", () => onOpen(node), { signal });
    if (open) onOpen(node);
  }

  function resize() {
    const bounds = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const pixels = height / (2 * Math.tan((FOV * DEG) / 2));
    nodeMaterial.uniforms.uPixels.value = pixels;
    skyFar.uniforms.uPixels.value = pixels;
    skyNear.uniforms.uPixels.value = pixels;
    const nextBase = fitAllDistance();
    if (!Number.isFinite(baseDistance) || baseDistance === 160) {
      baseDistance = nextBase;
      cameraState.distance = nextBase;
      cameraState.targetDistance = nextBase;
    } else {
      const ratio = cameraState.targetDistance / baseDistance;
      baseDistance = nextBase;
      cameraState.targetDistance = baseDistance * ratio;
    }
    updateZoom();
  }

  function updateProjection() {
    graph.updateMatrixWorld();
    nodes.forEach((node, index) => {
      vector.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      const distance = camera.position.distanceTo(vector);
      vector.project(camera);
      const screen = screenNodes[index];
      screen.x = (vector.x * 0.5 + 0.5) * width;
      screen.y = (-vector.y * 0.5 + 0.5) * height;
      screen.depth = vector.z;
      screen.radius = Math.max(10, (nodeSizes[index] * nodeMaterial.uniforms.uScale.value * nodeMaterial.uniforms.uPixels.value) / Math.max(distance, 1) * 0.42);
    });
    systems.forEach((system, index) => {
      vector.set(system.center.x, system.center.y + 5.4, system.center.z);
      vector.project(camera);
      const screen = screenSuns[index];
      screen.x = (vector.x * 0.5 + 0.5) * width;
      screen.y = (-vector.y * 0.5 + 0.5) * height;
      screen.depth = vector.z;
    });
  }

  function closestNode(clientX, clientY) {
    const bounds = stage.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let closest = -1;
    let closestDepth = Infinity;
    screenNodes.forEach((screen, index) => {
      if (screen.depth > 1) return;
      const dx = screen.x - x;
      const dy = screen.y - y;
      const radius = screen.radius + 9;
      if (dx * dx + dy * dy <= radius * radius && screen.depth < closestDepth) {
        closest = index;
        closestDepth = screen.depth;
      }
    });
    return closest;
  }

  function closestSun(clientX, clientY) {
    const bounds = stage.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let closest = -1;
    let closestDepth = Infinity;
    screenSuns.forEach((screen, index) => {
      if (screen.depth > 1) return;
      const dx = screen.x - x;
      const dy = screen.y - (y + 14);
      if (dx * dx + dy * dy <= 30 * 30 && screen.depth < closestDepth) {
        closest = index;
        closestDepth = screen.depth;
      }
    });
    return closest;
  }

  function drawLabels() {
    const normalized = query.trim().toLowerCase();
    const wanted = new Set(showLabels ? rankedLabels.map(({ index }) => index) : []);
    if (showLabels && focusedKind) {
      const entry = systemObjects.find(({ system }) => system.kind === focusedKind);
      entry?.system.stars.forEach((star) => wanted.add(star.index));
    }
    if (selectedIndex >= 0) wanted.add(selectedIndex);
    if (normalized) nodes.forEach((node, index) => node.name.toLowerCase().includes(normalized) && wanted.add(index));
    const taken = [];
    labelPool.forEach((label, index) => {
      const screen = screenNodes[index];
      let visible = wanted.has(index) && screen.depth < 1 && screen.x > -80 && screen.x < width + 80 && screen.y > -20 && screen.y < height + 30;
      const labelWidth = Math.min(260, nodes[index].name.length * 6.5 + 16);
      const box = [screen.x - labelWidth / 2, screen.y - 30, labelWidth, 20];
      if (visible && taken.some((item) => box[0] < item[0] + item[2] && box[0] + box[2] > item[0] && box[1] < item[1] + item[3] && box[1] + box[3] > item[1])) visible = false;
      if (visible) taken.push(box);
      label.style.opacity = visible ? "1" : "0";
      if (visible) label.style.transform = `translate(-50%, -50%) translate(${screen.x.toFixed(1)}px, ${(screen.y - 18).toFixed(1)}px)`;
      label.classList.toggle("is-selected", index === selectedIndex);
    });
    systemLabels.forEach((label, index) => {
      const screen = screenSuns[index];
      const visible = screen.depth < 1 && screen.x > -120 && screen.x < width + 120 && screen.y > -30 && screen.y < height + 30;
      label.style.opacity = visible ? "1" : "0";
      label.style.pointerEvents = visible ? "auto" : "none";
      if (visible) label.style.transform = `translate(-50%, -50%) translate(${screen.x.toFixed(1)}px, ${(screen.y - 26).toFixed(1)}px)`;
      label.classList.toggle("is-focused", systems[index].kind === focusedKind);
    });
  }

  function frame(now) {
    animationFrame = requestAnimationFrame(frame);
    if (document.hidden || !document.body.classList.contains("constellation-home")) {
      lastTime = now;
      return;
    }
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const time = now * 0.001;

    if (motion) {
      systems.forEach((system) => {
        system.stars.forEach((star) => {
          star.angle += delta * star.speed * speedFactor;
          starOrbitPosition(system, star, star.angle, positions, star.index * 3);
        });
      });
      positionAttribute.needsUpdate = true;
    }
    edges.forEach((edge, index) => {
      linePositions.set(positions.subarray(edge.source * 3, edge.source * 3 + 3), index * 6);
      linePositions.set(positions.subarray(edge.target * 3, edge.target * 3 + 3), index * 6 + 3);
    });
    if (edges.length) linePositionAttribute.needsUpdate = true;
    lines.visible = signals;
    lineMaterial.opacity = signals && !reducedMotion ? 0.26 + Math.sin(time * 1.8) * 0.09 : 0.24;

    if (selectedIndex >= 0) {
      selectionRing.visible = true;
      selectionRing.position.set(positions[selectedIndex * 3], positions[selectedIndex * 3 + 1], positions[selectedIndex * 3 + 2]);
      const scale = 4.6 + Math.sin(time * 2.4) * 0.5;
      selectionRing.scale.set(scale, scale, 1);
      selectionMaterial.color.set(sectionMeta(nodes[selectedIndex].kind).star);
    }

    sunUniforms.forEach((uniforms) => { uniforms.uTime.value = reducedMotion ? 0 : time; });
    nodeMaterial.uniforms.uTime.value = reducedMotion ? 0 : time;
    skyFar.uniforms.uTime.value = reducedMotion ? 0 : time;
    skyNear.uniforms.uTime.value = reducedMotion ? 0 : time;
    if (!reducedMotion) {
      nebulae.forEach((sprite, index) => {
        sprite.material.rotation = time * 0.008 * (index % 2 ? 1 : -1);
      });
      systemObjects.forEach(({ corona }, index) => {
        const pulse = 24 + Math.sin(time * 1.3 + index * 1.7) * 1.6;
        corona.scale.set(pulse, pulse, 1);
      });
    }

    if (spin) cameraState.targetTheta += delta * 0.06;
    const smoothing = 1 - Math.pow(0.002, delta);
    cameraState.theta += (cameraState.targetTheta - cameraState.theta) * smoothing;
    cameraState.phi += (cameraState.targetPhi - cameraState.phi) * smoothing;
    cameraState.distance += (cameraState.targetDistance - cameraState.distance) * smoothing;
    cameraState.target.lerp(cameraState.targetGoal, smoothing);
    camera.position.set(
      cameraState.target.x + cameraState.distance * Math.sin(cameraState.phi) * Math.cos(cameraState.theta),
      cameraState.target.y + cameraState.distance * Math.cos(cameraState.phi),
      cameraState.target.z + cameraState.distance * Math.sin(cameraState.phi) * Math.sin(cameraState.theta),
    );
    camera.lookAt(cameraState.target);
    updateProjection();
    drawLabels();
    renderer.render(scene, camera);
  }

  // ---- pointer controls ----
  const pointers = new Map();
  let moved = 0;
  let previousX = 0;
  let previousY = 0;
  let previousPinch = 0;
  bind(renderer.domElement, "pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.domElement.setPointerCapture(event.pointerId);
    moved = 0;
    previousX = event.clientX;
    previousY = event.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      previousPinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  bind(renderer.domElement, "pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      const hover = closestNode(event.clientX, event.clientY);
      const sun = hover < 0 ? closestSun(event.clientX, event.clientY) : -1;
      renderer.domElement.style.cursor = hover >= 0 || sun >= 0 ? "pointer" : "grab";
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const pinchDelta = Math.abs(distance - previousPinch);
      if (previousPinch) dolly(previousPinch / Math.max(distance, 1));
      previousPinch = distance;
      moved += pinchDelta;
      return;
    }
    const dx = event.clientX - previousX;
    const dy = event.clientY - previousY;
    moved += Math.abs(dx) + Math.abs(dy);
    previousX = event.clientX;
    previousY = event.clientY;
    cameraState.targetTheta -= dx * 0.005;
    cameraState.targetPhi = Math.max(0.12, Math.min(Math.PI - 0.12, cameraState.targetPhi - dy * 0.005));
    spin = false;
    syncButtons();
  });
  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    previousPinch = 0;
    if (moved <= 6) {
      const index = closestNode(event.clientX, event.clientY);
      if (index >= 0) {
        selectNode(index);
      } else {
        const sun = closestSun(event.clientX, event.clientY);
        if (sun >= 0) focusSystem(systems[sun].kind);
      }
    }
  };
  bind(renderer.domElement, "pointerup", endPointer);
  bind(renderer.domElement, "pointercancel", (event) => {
    pointers.delete(event.pointerId);
    previousPinch = 0;
    moved = 7;
  });
  bind(renderer.domElement, "wheel", (event) => {
    event.preventDefault();
    dolly(event.deltaY > 0 ? 1.11 : 1 / 1.11);
  }, { passive: false });

  // ---- UI controls ----
  bind(queryInput, "input", () => {
    query = queryInput.value;
    renderResults();
    resultsHost.hidden = false;
  });
  bind(queryInput, "focus", () => {
    renderResults();
    resultsHost.hidden = false;
  });
  bind(resultsHost, "click", (event) => {
    const button = event.target.closest("[data-constellation-result]");
    if (!button) return;
    const index = Number(button.dataset.constellationResult);
    selectNode(index);
    const entry = starByIndex.get(index);
    if (entry) focusSystem(entry.system.kind);
    resultsHost.hidden = true;
    queryInput.blur();
  });
  bind(document, "pointerdown", (event) => {
    if (!event.target.closest(".constellation-search")) resultsHost.hidden = true;
  });
  bind(container, "click", (event) => {
    const chip = event.target.closest("[data-system-chip]");
    if (chip) {
      focusSystem(chip.dataset.systemChip);
      return;
    }
    const action = event.target.closest("[data-constellation-action]")?.dataset.constellationAction;
    if (!action) return;
    if (action === "labels") showLabels = !showLabels;
    if (action === "signals") signals = !signals;
    if (action === "motion") motion = !motion;
    if (action === "rotate") spin = !spin;
    if (action === "zoom-out") dolly(1.18);
    if (action === "zoom-in") dolly(1 / 1.18);
    if (action === "reset") resetCamera();
    syncButtons();
  });
  bind(glowInput, "input", () => {
    nodeMaterial.uniforms.uGlow.value = Number(glowInput.value) / 100;
  });
  bind(speedInput, "input", () => {
    speedFactor = Number(speedInput.value) / 100;
  });
  bind(zoomText, "click", () => {
    cameraState.targetDistance = baseDistance;
    updateZoom();
  });
  bind(window, "resize", resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  bind(window, "keydown", (event) => {
    if (!document.body.classList.contains("constellation-home")) return;
    if (event.key === "Escape") {
      resultsHost.hidden = true;
      detail.hidden = true;
      selectedIndex = -1;
      selectionRing.visible = false;
      selectionText.textContent = "No selection";
    }
    if (event.key === "/" && !event.target.closest("input, textarea, select, dialog")) {
      event.preventDefault();
      queryInput.focus();
    }
  });

  renderResults();
  syncButtons();
  resize();
  animationFrame = requestAnimationFrame(frame);

  return {
    dispose() {
      abortController.abort();
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
      disposables.forEach((resource) => resource.dispose());
      [starTexture, coronaTexture, selectionTexture, ...nebulaTextures].forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      labelPool.forEach((label) => label.remove());
      systemLabels.forEach((label) => label.remove());
      container.replaceChildren();
    },
  };
}
