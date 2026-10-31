// The everyday map has no network, canvas, or WebGL dependency.
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const color = (node) => node.kind === 'projects' ? '#ffe3b3' : '#b9e8d1';

export function wrapStarName(value, width = 26) {
  const lines = [];
  let remaining = String(value);
  while (remaining.length > width) {
    const space = remaining.lastIndexOf(' ', width);
    const end = space > width / 2 ? space : width;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export function layoutConstellation(nodes) {
  const groups = ['projects', 'skills'].map((kind) => nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.kind === kind));
  const positions = new Array(nodes.length);
  groups.forEach((group, kind) => group.forEach(({ index }, slot) => {
    const ring = Math.floor(slot / 28);
    const count = Math.min(28, group.length - ring * 28);
    const angle = (slot % 28) / count * Math.PI * 2 - Math.PI / 2 + ring * 0.23;
    const radius = kind === 0 ? (group.length === 1 ? 0 : 95 + ring * 36) : 235 + ring * 30;
    positions[index] = { x: 500 + Math.cos(angle) * radius * 1.32, y: 310 + Math.sin(angle) * radius };
  }));
  return positions;
}

export function layoutStarLabels(nodes, positions) {
  const placed = [];
  return nodes.map((node, index) => {
    const lines = wrapStarName(node.name);
    const width = Math.max(...lines.map((line) => Array.from(line).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 12 : 6.8), 0)), 30) + 12;
    const height = lines.length * 15 + 8;
    const point = positions[index];
    let box;
    let center;
    // Move labels, never hide them. Leader lines keep moved names tied to stars.
    outer: for (let ring = 0; ring < 36; ring++) {
      for (let slot = 0; slot < (ring ? 16 : 1); slot++) {
        const angle = slot * Math.PI / 8 - Math.PI / 2;
        center = { x: point.x + Math.cos(angle) * ring * 18, y: point.y - 28 - (lines.length - 1) * 7.5 + Math.sin(angle) * ring * 18 };
        box = { left: center.x - width / 2, top: center.y - height / 2, width, height };
        if (!placed.some((other) => box.left < other.left + other.width && box.left + width > other.left && box.top < other.top + other.height && box.top + height > other.top)) break outer;
      }
    }
    placed.push(box);
    return { ...center, lines, box };
  });
}

export function matchingNodeIndexes(nodes, query = '', kind = 'all') {
  const term = query.trim().toLocaleLowerCase();
  return nodes.map((node, index) => ({ node, index })).filter(({ node }) =>
    (kind === 'all' || node.kind === kind) && `${node.name} ${node.meta} ${node.description}`.toLocaleLowerCase().includes(term),
  ).map(({ index }) => index);
}

export function validConstellationEdges(nodes, edges) {
  const seen = new Set();
  return edges.filter(({ source, target }) => {
    if (!Number.isInteger(source) || !Number.isInteger(target) || !nodes[source] || !nodes[target] || source === target) return false;
    const key = [source, target].sort((a, b) => a - b).join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DEMO_NODES = [
  { name: 'A new idea', kind: 'projects', meta: 'Sample project', description: 'Projects bring your ideas, notes, and next steps together.' },
  { name: 'Learning journal', kind: 'projects', meta: 'Sample project', description: 'Keep a project for something you want to learn.' },
  { name: 'Writing', kind: 'skills', meta: 'Sample skill' },
  { name: 'Planning', kind: 'skills', meta: 'Sample skill' },
  { name: 'Research', kind: 'skills', meta: 'Sample skill' },
  { name: 'Communication', kind: 'skills', meta: 'Sample skill' },
  { name: 'Design', kind: 'skills', meta: 'Sample skill' },
];
const DEMO_EDGES = [{ source: 0, target: 2 }, { source: 0, target: 3 }, { source: 0, target: 6 }, { source: 1, target: 4 }, { source: 1, target: 5 }];

export function createMyVaultConstellation({ container, nodes, edges, onOpen, onCreate, onNavigate }) {
  const controller = new AbortController();
  const { signal } = controller;
  const bind = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal });
  const realNodes = nodes;
  const realEdges = validConstellationEdges(nodes, edges);
  let demo = false;
  let query = '';
  let kind = 'all';
  let selected = -1;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let labels = true;
  let connections = true;
  let browse = false;
  let disposed = false;
  let threeD = null;
  let threeRequest = 0;
  let positions = layoutConstellation(nodes);
  let namePositions = layoutStarLabels(nodes, positions);

  container.innerHTML = `<section id="orbit-main" tabindex="-1" class="constellation-stage orbit-stage" aria-label="Constellation map">
    <header class="orbit-header"><div><p class="orbit-eyebrow">YOUR CONNECTED WORKSPACE</p><h1>Everything, connected.</h1><p>Projects at the heart. Skills that help them grow.</p></div><button type="button" class="orbit-dashboard" data-map-action="dashboard">Dashboard ↗</button></header>
    <div class="orbit-discovery"><label class="visually-hidden" for="orbit-query">Search projects and skills</label><input id="orbit-query" type="search" placeholder="Find a project or skill…" autocomplete="off"><div class="orbit-filters" role="group" aria-label="Filter stars"><button type="button" data-map-filter="all" aria-pressed="true">All stars</button><button type="button" data-map-filter="projects" aria-pressed="false">Projects</button><button type="button" data-map-filter="skills" aria-pressed="false">Skills</button></div><button type="button" data-map-action="browse" aria-expanded="false" aria-controls="orbit-index">Browse records</button></div>
    <div class="orbit-summary" role="status" aria-live="polite"></div>
    <div class="orbit-viewport"><svg class="orbit-map" viewBox="0 0 1000 620" role="group" aria-label="Project and skill stars. Tab to a star; Enter to inspect it. Drag to pan; pinch or use controls to zoom."><g class="orbit-camera"></g></svg></div>
    <div class="orbit-welcome" hidden></div>
    <aside class="orbit-index" id="orbit-index" aria-label="Matching records" hidden></aside>
    <aside class="orbit-detail" aria-label="Selected record" hidden></aside>
    <footer class="orbit-footer"><p>Select a star to explore its connections.<br><span>Drag to pan · Pinch to zoom · / to search</span></p><div class="orbit-tools" role="group" aria-label="Map controls"><button type="button" data-map-action="labels" aria-pressed="true">Labels</button><button type="button" data-map-action="connections" aria-pressed="true">Links</button><button type="button" data-map-action="out" aria-label="Zoom out">−</button><button type="button" data-map-action="reset" aria-label="Reset map">100%</button><button type="button" data-map-action="in" aria-label="Zoom in">+</button><button type="button" data-map-action="3d">Try 3D</button></div></footer>
    <p class="orbit-notice" role="status" hidden></p>
  </section><div class="orbit-3d" hidden><div data-three-host></div><button type="button" class="orbit-return" data-map-action="2d">← Back to 2D map</button></div>`;
  const stage = container.querySelector('.orbit-stage');
  const svg = container.querySelector('.orbit-map');
  const camera = container.querySelector('.orbit-camera');
  const input = container.querySelector('#orbit-query');
  const summary = container.querySelector('.orbit-summary');
  const welcome = container.querySelector('.orbit-welcome');
  const indexHost = container.querySelector('.orbit-index');
  const detail = container.querySelector('.orbit-detail');
  const notice = container.querySelector('.orbit-notice');
  const host3d = container.querySelector('.orbit-3d');
  const threeButton = container.querySelector('[data-map-action="3d"]');

  function neighbors(index) {
    return edges.flatMap((edge) => edge.source === index ? [edge.target] : edge.target === index ? [edge.source] : []);
  }
  function transform() {
    camera.setAttribute('transform', `translate(${500 + pan.x} ${310 + pan.y}) scale(${zoom}) translate(-500 -310)`);
    container.querySelector('[data-map-action="reset"]').textContent = `${Math.round(zoom * 100)}%`;
  }
  function draw() {
    const matches = new Set(matchingNodeIndexes(nodes, query, kind));
    const nearby = new Set(selected >= 0 ? [selected, ...neighbors(selected)] : []);
    const projectCount = nodes.filter((node) => node.kind === 'projects').length;
    summary.textContent = `${demo ? 'SAMPLE PREVIEW · ' : ''}${projectCount} projects · ${nodes.length - projectCount} skills · ${edges.length} links${query || kind !== 'all' ? ` · ${matches.size} matches` : ''}`;
    const extent = Math.max(340, ...positions.map(({ x, y }) => Math.max(Math.abs(x - 500), Math.abs(y - 310))), ...namePositions.map(({ box }) => Math.max(Math.abs(box.top - 310), Math.abs(box.top + box.height - 310), Math.abs(box.left - 500) / 1.55, Math.abs(box.left + box.width - 500) / 1.55))) + 12;
    svg.setAttribute('viewBox', `${500 - extent * 1.55} ${310 - extent} ${extent * 3.1} ${extent * 2}`);
    camera.innerHTML = `<ellipse class="orbit-guide" cx="500" cy="310" rx="310" ry="235"/><ellipse class="orbit-guide orbit-guide-inner" cx="500" cy="310" rx="126" ry="95"/><text class="orbit-center-label" x="500" y="310" text-anchor="middle">${projectCount === 1 ? '' : 'YOUR PROJECTS'}</text>` +
      (connections ? edges.map(({ source, target }) => {
        const a = positions[source]; const b = positions[target];
        const active = selected >= 0 && (source === selected || target === selected);
        return `<line class="orbit-link${active ? ' is-connected' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity="${matches.has(source) && matches.has(target) ? (selected < 0 || active ? 1 : 0.12) : 0.08}"/>`;
      }).join('') : '') + nodes.map((node, index) => {
        const { x, y } = positions[index];
        const visible = matches.has(index);
        const strong = selected === index;
        const connected = nearby.has(index);
        const opacity = !visible ? 0.1 : selected < 0 || connected ? 1 : 0.28;
        const name = escape(node.name);
        const label = namePositions[index];
        const labelX = label.x - x; const labelY = label.y - y;
        const lines = label.lines;
        return `<g class="orbit-star${strong ? ' is-selected' : ''}" data-star="${index}" role="button" tabindex="${visible ? 0 : -1}" aria-label="${name}, ${node.kind === 'projects' ? 'project' : 'skill'}, ${neighbors(index).length} connections" aria-pressed="${strong}"${visible ? '' : ' aria-hidden="true"'} transform="translate(${x} ${y})" style="--star-color:${color(node)};opacity:${opacity}"><title>${name}</title><circle class="orbit-hit" r="24"/><circle class="orbit-halo" r="${node.kind === 'projects' ? 19 : 14}"/><circle class="orbit-dot" r="${node.kind === 'projects' ? 6 : 4}"/>${labels ? `${Math.abs(labelX) > 20 || Math.abs(labelY) > 45 ? `<line class="orbit-label-leader" x2="${labelX}" y2="${labelY}"/>` : ''}<text x="${labelX}" y="${labelY - (lines.length - 1) * 7.5}" text-anchor="middle">${lines.map((line, lineIndex) => `<tspan x="${labelX}" dy="${lineIndex ? 15 : 0}">${escape(line)}</tspan>`).join('')}</text>` : ''}</g>`;
      }).join('');
    transform();
    welcome.hidden = nodes.length > 0;
    welcome.innerHTML = `<span class="orbit-welcome-mark" aria-hidden="true">✧</span><p class="orbit-eyebrow">A LITTLE SPACE FOR YOUR NEXT IDEA</p><h2>Your constellation starts here.</h2><p>Add a project, then connect the skills that bring it to life. Your map grows with your vault.</p><div><button type="button" class="button button-primary" data-map-action="create">Create a project</button><button type="button" class="button" data-map-action="demo">Explore a sample</button></div><small>The sample is a preview only. It never changes your vault.</small>`;
    container.querySelector('[data-map-action="3d"]').hidden = !realNodes.length || demo;
    indexHost.hidden = !(browse || query);
    container.querySelector('[data-map-action="browse"]').setAttribute('aria-expanded', String(!indexHost.hidden));
    indexHost.innerHTML = `<h2>${demo ? 'Sample records' : 'Your records'} <span>${matches.size}</span></h2>${[...matches].map((index) => `<button type="button" data-select="${index}"><i style="background:${color(nodes[index])}"></i><span>${escape(nodes[index].name)}<small>${escape(nodes[index].meta || (nodes[index].kind === 'projects' ? 'Project' : 'Skill'))}</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p>No matches. Try a different name or filter.</p>'}${demo ? '<button type="button" data-map-action="exit-demo">Exit sample preview</button>' : ''}`;
    stage.classList.toggle('is-demo', demo);
    let demoExit = container.querySelector('.orbit-demo-exit');
    if (demo && !demoExit) {
      demoExit = document.createElement('button');
      demoExit.type = 'button'; demoExit.className = 'orbit-demo-exit'; demoExit.dataset.mapAction = 'exit-demo'; demoExit.textContent = 'Exit sample preview';
      stage.append(demoExit);
    } else if (!demo) demoExit?.remove();
  }
  function select(index, focus = true) {
    if (!nodes[index]) return;
    selected = index;
    const node = nodes[index];
    const linked = neighbors(index);
    detail.hidden = false;
    detail.innerHTML = `<button type="button" class="orbit-close" data-map-action="close" aria-label="Close star details">×</button><p class="orbit-eyebrow">${demo ? 'SAMPLE ' : ''}${node.kind === 'projects' ? 'PROJECT' : 'SKILL'}</p><h2>${escape(node.name)}</h2><span class="orbit-meta">${escape(node.meta)}</span><p>${escape(node.description || 'No notes yet. Open the record to add a little context.')}</p><h3>${linked.length} connected ${linked.length === 1 ? 'record' : 'records'}</h3><div class="orbit-related">${linked.map((target) => `<button type="button" data-select="${target}">${escape(nodes[target].name)} ↗</button>`).join('') || '<p>Add links to this record to connect it with your other projects and skills.</p>'}</div>${demo ? '<p class="orbit-sample-note">Sample preview · Nothing is saved to your vault.</p>' : '<button type="button" class="button button-primary" data-map-action="open">Open record ↗</button>'}`;
    draw();
    if (focus) detail.querySelector('.orbit-close').focus();
  }
  function resetSelection() {
    selected = -1; detail.hidden = true;
  }
  function setDemo(enabled) {
    demo = enabled;
    nodes = demo ? DEMO_NODES : realNodes;
    edges = demo ? DEMO_EDGES : realEdges;
    positions = layoutConstellation(nodes);
    namePositions = layoutStarLabels(nodes, positions);
    query = ''; input.value = ''; kind = 'all'; browse = false;
    zoom = 1; pan = { x: 0, y: 0 }; resetSelection(); syncFilters(); draw();
  }
  function syncFilters() {
    container.querySelectorAll('[data-map-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mapFilter === kind)));
  }
  function leave3d() {
    threeRequest += 1;
    threeD?.dispose(); threeD = null;
    host3d.hidden = true; stage.hidden = false;
    threeButton.disabled = false; threeButton.textContent = 'Try 3D';
  }
  async function enter3d({ focus = true } = {}) {
    const request = ++threeRequest;
    threeButton.disabled = true; threeButton.textContent = 'Loading 3D…'; notice.hidden = true;
    try {
      const module = await Promise.race([import('./constellation-3d.mjs?v=4'), new Promise((_, reject) => setTimeout(() => reject(new Error('3D loading timed out')), 8000))]);
      if (disposed || request !== threeRequest) return;
      host3d.hidden = false; stage.hidden = true;
      threeD = module.createMyVaultConstellation({ container: host3d.querySelector('[data-three-host]'), nodes: realNodes, edges: realEdges, onOpen });
      if (focus) host3d.querySelector('[data-map-action="2d"]').focus();
    } catch {
      if (disposed || request !== threeRequest) return;
      leave3d();
      notice.textContent = '3D could not start in this browser. Your 2D map and records are still available.';
      notice.hidden = false;
    }
  }
  bind(container, 'click', (event) => {
    const filter = event.target.closest('[data-map-filter]');
    if (filter) { kind = filter.dataset.mapFilter; resetSelection(); syncFilters(); draw(); return; }
    const record = event.target.closest('[data-star], [data-select]');
    if (record && (!record.hasAttribute("data-star") || !dragged)) { select(Number(record.dataset.star ?? record.dataset.select)); return; }
    const action = event.target.closest('[data-map-action]')?.dataset.mapAction;
    if (!action) return;
    if (action === 'dashboard') onNavigate?.('control');
    if (action === 'create') onCreate?.('projects');
    if (action === 'create-skill') onCreate?.('skills');
    if (action === 'demo') setDemo(true);
    if (action === 'exit-demo') setDemo(false);
    if (action === 'browse') { browse = !browse; draw(); }
    if (action === 'close') { const previous = selected; resetSelection(); draw(); container.querySelector(`[data-star="${previous}"]`)?.focus(); }
    if (action === 'open' && selected >= 0 && !demo) onOpen(nodes[selected]);
    if (action === 'in' || action === 'out') { zoom = Math.max(0.5, Math.min(3, zoom * (action === 'in' ? 1.2 : 1 / 1.2))); transform(); }
    if (action === 'reset') { zoom = 1; pan = { x: 0, y: 0 }; transform(); }
    if (action === 'labels' || action === 'connections') { if (action === 'labels') labels = !labels; else connections = !connections; event.target.closest('button').setAttribute('aria-pressed', String(action === 'labels' ? labels : connections)); draw(); }
    if (action === '3d') enter3d();
    if (action === '2d') leave3d();
  });
  bind(input, 'input', () => { query = input.value; resetSelection(); draw(); });
  bind(stage, 'keydown', (event) => {
    const star = event.target.closest('[data-star]');
    if (star && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(Number(star.dataset.star)); }
    if (star && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const matches = matchingNodeIndexes(nodes, query, kind);
      const current = matches.indexOf(Number(star.dataset.star));
      const next = (current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + matches.length) % matches.length;
      container.querySelector(`[data-star="${matches[next]}"]`)?.focus();
    }
  });
  bind(window, 'keydown', (event) => {
    if (!document.body.classList.contains('constellation-home') || stage.hidden || event.target.closest('dialog')) return;
    if (event.key === '/' && !event.target.closest('input,textarea,select')) { event.preventDefault(); input.focus(); }
    if (event.key === 'Escape') { resetSelection(); query = ''; input.value = ''; browse = false; draw(); input.focus(); }
  });
  const pointers = new Map();
  let dragged = false;
  let moved = 0;
  let lastPinch = 0;
  bind(svg, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!pointers.size) { dragged = false; moved = 0; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
    // Capture on the star itself so a tap retains its accessible click target.
    event.target.setPointerCapture?.(event.pointerId);
  });
  bind(svg, 'pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
    moved += Math.abs(dx) + Math.abs(dy); dragged = moved > 7;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch) zoom = Math.max(0.5, Math.min(3, zoom * distance / lastPinch));
      lastPinch = distance; dragged = true;
    } else {
      const bounds = svg.getBoundingClientRect(); const box = svg.viewBox.baseVal;
      const scale = Math.min(bounds.width / box.width, bounds.height / box.height);
      pan.x += dx / Math.max(scale, 0.01); pan.y += dy / Math.max(scale, 0.01);
    }
    transform();
  });
  const end = (event) => { pointers.delete(event.pointerId); lastPinch = 0; };
  bind(svg, 'pointerup', end); bind(svg, 'pointercancel', (event) => { dragged = true; end(event); });
  bind(svg, 'wheel', (event) => { event.preventDefault(); zoom = Math.max(0.5, Math.min(3, zoom * (event.deltaY > 0 ? 0.94 : 1.06))); transform(); }, { passive: false });
  draw();
  // Start 3D on the first visit, without moving keyboard focus during navigation.
  let attemptedDefault = false;
  const startDefault = () => {
    if (!disposed && !attemptedDefault && document.body.classList.contains('constellation-home')) {
      attemptedDefault = true;
      enter3d({ focus: false });
    }
  };
  const viewObserver = new MutationObserver(startDefault);
  viewObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  startDefault();
  return { dispose() { disposed = true; viewObserver.disconnect(); leave3d(); controller.abort(); container.replaceChildren(); } };
}
