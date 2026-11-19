// Single source of truth for the MyVault galaxy: every workspace section is a
// solar system, every record a star. Pure layout helpers shared by the 2D map
// and the 3D renderer (no DOM, no three.js — unit-testable in plain Node).

export const SECTION_ORDER = [
  "projects",
  "skills",
  "docs",
  "chats",
  "reports",
  "tasks",
  "accounting",
  "games",
];

export const SECTION_META = {
  projects: { label: "Projects", zh: "項目", kindLabel: "PROJECT", star: "#ffd9a0", sun: "#ff9d45" },
  skills: { label: "Skills", zh: "技能", kindLabel: "SKILL", star: "#8ff0dd", sun: "#2dd4bf" },
  docs: { label: "Documents", zh: "文件", kindLabel: "DOCUMENT", star: "#c9b8ff", sun: "#8b5cf6" },
  chats: { label: "Chats", zh: "對話", kindLabel: "CHAT", star: "#9ad4ff", sun: "#3b82f6" },
  reports: { label: "Report", zh: "報告", kindLabel: "REPORT", star: "#fef08a", sun: "#eab308" },
  tasks: { label: "Monthly Task", zh: "每月任務", kindLabel: "TASK", star: "#ffb3c7", sun: "#f43f5e" },
  accounting: { label: "Accounting", zh: "會計系統", kindLabel: "ACCOUNTING", star: "#c8f08f", sun: "#84cc16" },
  games: { label: "Games", zh: "遊戲", kindLabel: "GAME", star: "#ff8fd3", sun: "#d946ef" },
};

export const sectionMeta = (kind) => SECTION_META[kind] || SECTION_META.projects;

export function hash01(value, salt = 0) {
  let hash = 2166136261 ^ salt;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function groupBySection(nodes) {
  return SECTION_ORDER.map((kind) => ({
    kind,
    members: nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.kind === kind),
  })).filter((group) => group.members.length > 0);
}

// World-space position of one orbiting star. Each system has its own orbital
// inclination and ascending node so the galaxy reads in three dimensions.
export function starOrbitPosition(system, star, angle, out, offset) {
  const flatX = Math.cos(angle) * star.orbitRadius;
  const flatZ = Math.sin(angle) * star.orbitRadius;
  const inclination = star.inclination ?? system.tilt;
  const sinT = Math.sin(inclination);
  const cosT = Math.cos(inclination);
  const y = -flatZ * sinT + star.yOffset * cosT;
  const z = flatZ * cosT + star.yOffset * sinT;
  const node = star.node ?? system.node ?? 0;
  const sinN = Math.sin(node);
  const cosN = Math.cos(node);
  out[offset] = system.center.x + flatX * cosN + z * sinN;
  out[offset + 1] = system.center.y + y;
  out[offset + 2] = system.center.z - flatX * sinN + z * cosN;
  return out;
}

export function layoutSolarSystems(nodes) {
  const groups = groupBySection(nodes);
  const golden = 2.399111111149431;
  const systems = groups.map((group, slot) => {
    const angle = slot * golden + 0.55;
    // Fibonacci-sphere placement distributes systems in depth as well as
    // across the screen, avoiding a flat and crowded belt in the default view.
    const vertical = 1 - (2 * (slot + 0.5)) / groups.length;
    const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const spread = groups.length > 1 ? 112 : 0;
    const center = {
      x: Math.cos(angle) * horizontal * spread,
      y: vertical * spread * 0.72 + (hash01(group.kind, 7) - 0.5) * 8,
      z: Math.sin(angle) * horizontal * spread,
    };
    const count = group.members.length;
    const shells = count <= 6 ? 1 : count <= 18 ? 2 : 3;
    const baseRadius = 8.5 + Math.sqrt(count) * 2.0;
    // Broader inclinations keep the system discs from reading as one flat plane.
    const tilt = (hash01(group.kind, 8) - 0.5) * 1.25;
    const ascendingNode = hash01(group.kind, 15) * Math.PI * 2;
    const stars = group.members.map(({ node, index }, slot2) => {
      const shell = slot2 % shells;
      const seed = node.key ?? `${group.kind}:${index}`;
      return {
        index,
        shell,
        inclination:
          tilt + (shell - (shells - 1) / 2) * 0.24 + (hash01(seed, 16) - 0.5) * 0.26,
        node: ascendingNode + shell * 0.34 + (hash01(seed, 17) - 0.5) * 0.9,
        orbitRadius:
          baseRadius * (0.6 + shell * 0.4) + (hash01(seed, 9) - 0.5) * 1.7,
        angle: 0,
        speed: (0.1 + hash01(seed, 10) * 0.12) / (1 + shell * 0.6),
        yOffset: (hash01(seed, 12) - 0.5) * 2.6,
        size:
          node.kind === "projects"
            ? 1.5
            : node.kind === "accounting" || node.kind === "games"
              ? 1.35
              : 1.05,
        phase: hash01(seed, 13),
      };
    });
    // Even spacing within each shell, with a deterministic per-star jitter.
    for (let shell = 0; shell < shells; shell += 1) {
      const members = stars.filter((star) => star.shell === shell);
      members.forEach((star, i) => {
        const seed = nodes[star.index].key ?? star.index;
        star.angle =
          (i / members.length) * Math.PI * 2 +
          shell * 0.9 +
          (hash01(seed, 14) - 0.5) * 0.35;
      });
    }
    const radius = baseRadius * (0.6 + (shells - 1) * 0.4) + 3.4;
    return { kind: group.kind, center, radius, tilt, node: ascendingNode, shells, baseRadius, stars, count };
  });

  const positions = new Float32Array(nodes.length * 3);
  systems.forEach((system) => {
    system.stars.forEach((star) => {
      starOrbitPosition(system, star, star.angle, positions, star.index * 3);
    });
  });
  return { systems, positions };
}

// 2D map: section suns on a wide ellipse, records on rings around their sun.
export function layoutSystemMap(nodes) {
  const groups = groupBySection(nodes);
  const centers = groups.map((group, slot) => {
    const angle = (slot / Math.max(groups.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      kind: group.kind,
      count: group.members.length,
      x: 500 + Math.cos(angle) * 330,
      y: 310 + Math.sin(angle) * 205,
    };
  });
  const positions = new Array(nodes.length);
  groups.forEach((group, groupIndex) => {
    const center = centers[groupIndex];
    const perRing = 14;
    group.members.forEach(({ node, index }, slot) => {
      const ring = Math.floor(slot / perRing);
      const count = Math.min(perRing, group.members.length - ring * perRing);
      const seed = node.key ?? `${group.kind}:${index}`;
      const angle =
        ((slot % perRing) / count) * Math.PI * 2 - Math.PI / 2 + ring * 0.35;
      const radius =
        group.members.length === 1
          ? 0
          : 52 + ring * 30 + (hash01(seed, 21) - 0.5) * 8;
      positions[index] = {
        x: center.x + Math.cos(angle) * radius * 1.18,
        y: center.y + Math.sin(angle) * radius,
      };
    });
    center.radius =
      (group.members.length === 1 ? 0 : 52 + Math.floor((group.members.length - 1) / perRing) * 30) + 22;
  });
  return { positions, centers };
}

export function layoutConstellation(nodes) {
  return layoutSystemMap(nodes).positions;
}
