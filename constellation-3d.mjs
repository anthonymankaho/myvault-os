import * as THREE from "three";

const PROJECT_COLOR = "#ffe3b3";
const SKILL_COLOR = "#b9e8d1";
const FOV = 46;
const DEG = Math.PI / 180;

function hash01(value, salt = 0) {
  let hash = 2166136261 ^ salt;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function buildPositions(nodes) {
  const positions = new Float32Array(nodes.length * 3);
  const projects = [];
  const skills = [];
  nodes.forEach((node, index) =>
    (node.kind === "projects" ? projects : skills).push([node, index]),
  );

  const golden = Math.PI * (3 - Math.sqrt(5));
  const projectRadius = Math.min(15, Math.max(5, Math.sqrt(projects.length) * 2.1));
  projects.forEach(([node, index], slot) => {
    const t = projects.length === 1 ? 0.5 : (slot + 0.5) / projects.length;
    const y = 1 - 2 * t;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = projects.length === 1 ? 0 : projectRadius * Math.cbrt(t);
    const angle = golden * slot + hash01(node.key, 1) * 0.5;
    positions[index * 3] = Math.cos(angle) * horizontal * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(angle) * horizontal * radius;
  });

  const orbitRadius = Math.max(31, Math.min(45, 29 + Math.sqrt(skills.length) * 1.45));
  const tilt = 65 * DEG;
  skills.forEach(([node, index], slot) => {
    const angle = (slot / Math.max(skills.length, 1)) * Math.PI * 2 + hash01(node.key, 2) * 0.12;
    const radialJitter = (hash01(node.key, 3) - 0.5) * 5.5;
    const normalOffset = (hash01(node.key, 4) - 0.5) * 4.6;
    const radius = orbitRadius + radialJitter;
    const x = Math.cos(angle) * radius;
    const flatZ = Math.sin(angle) * radius;
    positions[index * 3] = x;
    positions[index * 3 + 1] = -flatZ * Math.sin(tilt) + normalOffset * Math.cos(tilt);
    positions[index * 3 + 2] = flatZ * Math.cos(tilt) + normalOffset * Math.sin(tilt);
  });

  return { positions, orbitRadius };
}

function makeRing(THREERef, radius, segments = 160) {
  const points = new Float32Array(segments * 3);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points[index * 3] = Math.cos(angle) * radius;
    points[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREERef.BufferGeometry();
  geometry.setAttribute("position", new THREERef.BufferAttribute(points, 3));
  return geometry;
}

function fitDistance(nodes, positions, width, height) {
  let radius = 12;
  nodes.forEach((_, index) => {
    radius = Math.max(
      radius,
      Math.hypot(
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ),
    );
  });
  const aspect = Math.max(0.25, width / Math.max(height, 1));
  const vertical = FOV * DEG;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const limiting = Math.min(vertical, horizontal);
  return (radius * 1.18) / Math.sin(limiting / 2);
}

function markup(projectCount, skillCount) {
  return `
    <div class="constellation-stage" data-constellation-stage>
      <div class="constellation-labels" data-constellation-labels aria-hidden="true"></div>
      <header class="constellation-title">
        <span>MYVAULT CONSTELLATION</span>
        <strong>Projects &amp; skills</strong>
      </header>
      <div class="constellation-hud" aria-live="polite">
        <span data-constellation-mode>FREE ORBIT</span>
        <strong data-constellation-selection>No selection</strong>
      </div>
      <div class="constellation-search">
        <label class="visually-hidden" for="constellation-3d-query">Search projects and skills</label>
        <span aria-hidden="true">⌕</span>
        <input id="constellation-3d-query" data-constellation-query type="search" autocomplete="off" placeholder="Search projects and skills…" />
        <div class="constellation-results" data-constellation-results hidden></div>
      </div>
      <div class="constellation-legend" aria-label="Constellation legend">
        <span><i style="--star-color:${PROJECT_COLOR}"></i>${projectCount} projects</span>
        <span><i style="--star-color:${SKILL_COLOR}"></i>${skillCount} skills</span>
      </div>
      <div class="constellation-tools" aria-label="Constellation controls">
        <button type="button" data-constellation-action="labels" aria-pressed="true">Labels</button>
        <button type="button" data-constellation-action="signals" aria-pressed="true">Signals</button>
        <button type="button" data-constellation-action="rotate" aria-pressed="true">Rotate</button>
        <span aria-hidden="true"></span>
        <button type="button" data-constellation-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-constellation-zoom aria-label="Reset zoom">100%</button>
        <button type="button" data-constellation-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-constellation-action="reset">Reset</button>
      </div>
      <p class="constellation-hint">Drag to orbit · Scroll or pinch to zoom · Select a star to open its MyVault record</p>
      <aside class="constellation-detail" data-constellation-detail hidden aria-live="polite"></aside>
      <div class="constellation-unavailable" data-constellation-unavailable hidden>
        The interactive constellation is unavailable in this browser. Use the Projects and Skills pages from the side control.
      </div>
    </div>`;
}

export function createMyVaultConstellation({ container, nodes, edges, onOpen }) {
  const abortController = new AbortController();
  const { signal } = abortController;
  const bind = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal });

  container.innerHTML = markup(
    nodes.filter((node) => node.kind === "projects").length,
    nodes.filter((node) => node.kind === "skills").length,
  );
  const stage = container.querySelector("[data-constellation-stage]");
  const labelsHost = container.querySelector("[data-constellation-labels]");
  const queryInput = container.querySelector("[data-constellation-query]");
  const resultsHost = container.querySelector("[data-constellation-results]");
  const selectionText = container.querySelector("[data-constellation-selection]");
  const detail = container.querySelector("[data-constellation-detail]");
  const unavailable = container.querySelector("[data-constellation-unavailable]");
  const zoomText = container.querySelector("[data-constellation-zoom]");
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
  renderer.domElement.setAttribute("aria-label", "Interactive project and skill constellation");
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080e12, 0.0048);
  const graph = new THREE.Group();
  scene.add(graph);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1600);
  const { positions, orbitRadius } = buildPositions(nodes);

  const starCanvas = document.createElement("canvas");
  starCanvas.width = starCanvas.height = 64;
  const starContext = starCanvas.getContext("2d");
  const starGradient = starContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  starGradient.addColorStop(0, "rgba(255,255,255,1)");
  starGradient.addColorStop(0.18, "rgba(255,255,255,.95)");
  starGradient.addColorStop(0.52, "rgba(255,255,255,.24)");
  starGradient.addColorStop(1, "rgba(255,255,255,0)");
  starContext.fillStyle = starGradient;
  starContext.fillRect(0, 0, 64, 64);
  const starTexture = new THREE.CanvasTexture(starCanvas);

  const skyCount = 460;
  const skyPositions = new Float32Array(skyCount * 3);
  for (let index = 0; index < skyCount; index += 1) {
    const radius = orbitRadius * (1.9 + hash01(index, 10) * 1.4);
    const phi = Math.acos(2 * hash01(index, 11) - 1);
    const theta = hash01(index, 12) * Math.PI * 2;
    skyPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    skyPositions[index * 3 + 1] = radius * Math.cos(phi);
    skyPositions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const skyGeometry = new THREE.BufferGeometry();
  skyGeometry.setAttribute("position", new THREE.BufferAttribute(skyPositions, 3));
  const skyMaterial = new THREE.PointsMaterial({
    size: 1.15,
    map: starTexture,
    color: 0x93a7c9,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(skyGeometry, skyMaterial));

  const nodeColors = new Float32Array(nodes.length * 3);
  const nodeSizes = new Float32Array(nodes.length);
  nodes.forEach((node, index) => {
    const color = new THREE.Color(node.kind === "projects" ? PROJECT_COLOR : SKILL_COLOR);
    nodeColors.set(color.toArray(), index * 3);
    nodeSizes[index] = node.kind === "projects" ? 1.45 : 1.08;
  });
  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  nodeGeometry.setAttribute("color", new THREE.BufferAttribute(nodeColors, 3));
  nodeGeometry.setAttribute("aSize", new THREE.BufferAttribute(nodeSizes, 1));
  const nodeMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixels: { value: 400 }, uScale: { value: 7.3 } },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixels;
      uniform float uScale;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * uPixels / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float distanceToCenter = length(gl_PointCoord - 0.5) * 2.0;
        if (distanceToCenter > 1.0) discard;
        float core = smoothstep(0.68, 0.0, distanceToCenter);
        float halo = pow(1.0 - distanceToCenter, 2.8);
        vec3 color = vColor * (0.55 + core * 1.25) + vec3(core * 0.48);
        gl_FragColor = vec4(color, core * 0.98 + halo * 0.48);
      }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodePoints = new THREE.Points(nodeGeometry, nodeMaterial);
  nodePoints.frustumCulled = false;
  graph.add(nodePoints);

  const linePositions = new Float32Array(edges.length * 6);
  const lineColors = new Float32Array(edges.length * 6);
  edges.forEach((edge, index) => {
    linePositions.set(positions.slice(edge.source * 3, edge.source * 3 + 3), index * 6);
    linePositions.set(positions.slice(edge.target * 3, edge.target * 3 + 3), index * 6 + 3);
    lineColors.set(new THREE.Color(nodes[edge.source].kind === "projects" ? PROJECT_COLOR : SKILL_COLOR).toArray(), index * 6);
    lineColors.set(new THREE.Color(nodes[edge.target].kind === "projects" ? PROJECT_COLOR : SKILL_COLOR).toArray(), index * 6 + 3);
  });
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: reducedMotion ? 0.22 : 0.3,
    blending: THREE.AdditiveBlending,
  });
  graph.add(new THREE.LineSegments(lineGeometry, lineMaterial));

  const guideMaterial = new THREE.LineBasicMaterial({ color: 0x5d7cae, transparent: true, opacity: 0.12 });
  const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x71b49d, transparent: true, opacity: 0.34 });
  const guideGeometries = [];
  [
    [Math.PI / 3, 0, guideMaterial],
    [-Math.PI / 3, 0, guideMaterial],
    [Math.PI / 2, Math.PI / 2.6, guideMaterial],
    [65 * DEG, 0, orbitMaterial],
  ].forEach(([rotationX, rotationY, material]) => {
    const geometry = makeRing(THREE, orbitRadius);
    guideGeometries.push(geometry);
    const ring = new THREE.LineLoop(geometry, material);
    ring.rotation.set(rotationX, rotationY, 0);
    graph.add(ring);
  });

  const labelPool = nodes.map((node) => {
    const label = document.createElement("span");
    label.className = "constellation-label";
    label.textContent = node.name;
    label.dataset.kind = node.kind;
    labelsHost.appendChild(label);
    return label;
  });

  let selectedIndex = -1;
  let query = "";
  let showLabels = true;
  let spin = false;
  let signals = !reducedMotion;
  let animationFrame = 0;
  let lastTime = performance.now();
  let width = 1;
  let height = 1;
  let baseDistance = 100;
  const cameraState = {
    theta: 0.64,
    phi: 1.18,
    distance: 100,
    targetTheta: 0.64,
    targetPhi: 1.18,
    targetDistance: 100,
  };
  const screenNodes = nodes.map(() => ({ x: -100, y: -100, depth: 2, radius: 9 }));
  const vector = new THREE.Vector3();
  const rankedLabels = nodes
    .map((node, index) => ({ node, index, score: edges.filter((edge) => edge.source === index || edge.target === index).length }))
    .sort((a, b) => b.score - a.score).slice(0, 18);

  function syncButtons() {
    const stateByAction = { labels: showLabels, signals, rotate: spin };
    Object.entries(stateByAction).forEach(([action, active]) => {
      const button = container.querySelector(`[data-constellation-action="${action}"]`);
      button?.setAttribute("aria-pressed", String(active));
      button?.classList.toggle("is-active", active);
    });
  }

  function updateZoom() {
    zoomText.textContent = `${Math.round((baseDistance / cameraState.targetDistance) * 100)}%`;
  }

  function dolly(factor) {
    cameraState.targetDistance = Math.max(baseDistance * 0.28, Math.min(baseDistance * 2.4, cameraState.targetDistance * factor));
    updateZoom();
  }

  function resetCamera() {
    cameraState.targetTheta = 0.64;
    cameraState.targetPhi = 1.18;
    cameraState.targetDistance = baseDistance;
    selectedIndex = -1;
    selectionText.textContent = "No selection";
    detail.hidden = true;
    updateZoom();
  }

  function renderResults() {
    const normalized = query.trim().toLowerCase();
    const matches = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => !normalized || `${node.name} ${node.meta} ${node.description}`.toLowerCase().includes(normalized))
      .slice(0, 24);
    resultsHost.innerHTML = matches.length
      ? `<p>${normalized ? `${matches.length} matches` : "Project & skill index"}</p>${matches.map(({ node, index }) => `<button type="button" data-constellation-result="${index}"><i data-kind="${node.kind}"></i><span>${node.safeName}</span><small>${node.kind === "projects" ? "Project" : "Skill"}</small></button>`).join("")}`
      : "<p>No projects or skills match this search.</p>";
  }

  function selectNode(index, { open = false } = {}) {
    const node = nodes[index];
    if (!node) return;
    selectedIndex = index;
    spin = false;
    syncButtons();
    selectionText.textContent = node.name;
    detail.hidden = false;
    detail.innerHTML = `
      <button type="button" class="constellation-detail-close" aria-label="Close details">×</button>
      <span><i data-kind="${node.kind}"></i>${node.kind === "projects" ? "PROJECT" : "SKILL"}</span>
      <h2>${node.safeName}</h2>
      <p>${node.safeMeta}</p>
      <p>${node.safeDescription || "No notes yet."}</p>
      <button type="button" class="constellation-open-record">Open in MyVault</button>`;
    detail.querySelector(".constellation-detail-close").addEventListener("click", () => {
      selectedIndex = -1;
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
    nodeMaterial.uniforms.uPixels.value = height / (2 * Math.tan((FOV * DEG) / 2));
    const nextBase = fitDistance(nodes, positions, width, height);
    if (!Number.isFinite(baseDistance) || baseDistance === 100) {
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
      vector.applyMatrix4(graph.matrixWorld);
      const distance = camera.position.distanceTo(vector);
      vector.project(camera);
      const screen = screenNodes[index];
      screen.x = (vector.x * 0.5 + 0.5) * width;
      screen.y = (-vector.y * 0.5 + 0.5) * height;
      screen.depth = vector.z;
      screen.radius = Math.max(10, (nodeSizes[index] * nodeMaterial.uniforms.uScale.value * nodeMaterial.uniforms.uPixels.value) / Math.max(distance, 1) * 0.42);
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

  function drawLabels() {
    const normalized = query.trim().toLowerCase();
    const ranked = rankedLabels;
    const wanted = new Set(showLabels ? ranked.map(({ index }) => index) : []);
    if (showLabels) nodes.forEach((node, index) => {
      if (node.kind === "skills") wanted.add(index);
    });
    if (selectedIndex >= 0) wanted.add(selectedIndex);
    if (normalized) nodes.forEach((node, index) => node.name.toLowerCase().includes(normalized) && wanted.add(index));
    const taken = [];
    labelPool.forEach((label, index) => {
      const screen = screenNodes[index];
      let visible = wanted.has(index) && screen.depth < 1 && screen.x > -80 && screen.x < width + 80 && screen.y > -20 && screen.y < height + 30;
      const labelWidth = Math.min(260, nodes[index].name.length * 6.5 + 16);
      const box = [screen.x - labelWidth / 2, screen.y - 30, labelWidth, 20];
      if (visible && nodes[index].kind !== "skills" && taken.some((item) => box[0] < item[0] + item[2] && box[0] + box[2] > item[0] && box[1] < item[1] + item[3] && box[1] + box[3] > item[1])) visible = false;
      if (visible) taken.push(box);
      label.style.opacity = visible ? "1" : "0";
      if (visible) label.style.transform = `translate(-50%, -50%) translate(${screen.x.toFixed(1)}px, ${(screen.y - 18).toFixed(1)}px)`;
      label.classList.toggle("is-selected", index === selectedIndex);
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
    if (spin && !document.hidden) cameraState.targetTheta += delta * 0.075;
    const smoothing = 1 - Math.pow(0.002, delta);
    cameraState.theta += (cameraState.targetTheta - cameraState.theta) * smoothing;
    cameraState.phi += (cameraState.targetPhi - cameraState.phi) * smoothing;
    cameraState.distance += (cameraState.targetDistance - cameraState.distance) * smoothing;
    camera.position.set(
      cameraState.distance * Math.sin(cameraState.phi) * Math.cos(cameraState.theta),
      cameraState.distance * Math.cos(cameraState.phi),
      cameraState.distance * Math.sin(cameraState.phi) * Math.sin(cameraState.theta),
    );
    camera.lookAt(0, 0, 0);
    lineMaterial.opacity = signals && !reducedMotion ? 0.24 + Math.sin(now * 0.0018) * 0.1 : 0.22;
    updateProjection();
    drawLabels();
    renderer.render(scene, camera);
  }

  const pointers = new Map();
  let dragging = false;
  let moved = 0;
  let previousX = 0;
  let previousY = 0;
  let previousPinch = 0;
  bind(renderer.domElement, "pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.domElement.setPointerCapture(event.pointerId);
    dragging = true;
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
      renderer.domElement.style.cursor = hover >= 0 ? "pointer" : "grab";
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
      if (index >= 0) selectNode(index);
    }
    dragging = pointers.size > 0;
  };
  bind(renderer.domElement, "pointerup", endPointer);
  bind(renderer.domElement, "pointercancel", (event) => {
    pointers.delete(event.pointerId);
    previousPinch = 0;
    moved = 7;
    dragging = pointers.size > 0;
  });
  bind(renderer.domElement, "wheel", (event) => {
    event.preventDefault();
    dolly(event.deltaY > 0 ? 1.11 : 1 / 1.11);
  }, { passive: false });

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
    selectNode(Number(button.dataset.constellationResult));
    resultsHost.hidden = true;
    queryInput.blur();
  });
  bind(document, "pointerdown", (event) => {
    if (!event.target.closest(".constellation-search")) resultsHost.hidden = true;
  });
  bind(container, "click", (event) => {
    const action = event.target.closest("[data-constellation-action]")?.dataset.constellationAction;
    if (!action) return;
    if (action === "labels") showLabels = !showLabels;
    if (action === "signals") signals = !signals;
    if (action === "rotate") spin = !spin;
    if (action === "zoom-out") dolly(1.18);
    if (action === "zoom-in") dolly(1 / 1.18);
    if (action === "reset") resetCamera();
    syncButtons();
  });
  bind(zoomText, "click", () => {
    cameraState.targetDistance = baseDistance;
    updateZoom();
  });
  bind(window, "resize", resize);
  bind(window, "keydown", (event) => {
    if (!document.body.classList.contains("constellation-home")) return;
    if (event.key === "Escape") {
      resultsHost.hidden = true;
      detail.hidden = true;
      selectedIndex = -1;
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
      cancelAnimationFrame(animationFrame);
      scene.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
      guideGeometries.forEach((geometry) => geometry.dispose());
      guideMaterial.dispose();
      orbitMaterial.dispose();
      starTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelPool.forEach((label) => label.remove());
      container.replaceChildren();
    },
  };
}
