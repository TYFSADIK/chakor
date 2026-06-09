// Builds the README marketing images from code so they stay consistent and
// on-brand. Renders crisp 2x PNGs (and an animated GIF) with the app's own
// sharp. Run: node docs/build-assets.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- brand ---------------------------------------------------------------
const C = {
  bg0: '#08100c', bg1: '#0c1512', bg2: '#0f0f11', card: '#141417', card2: '#18181b',
  line: '#26262b', line2: '#2f2f35',
  fg: '#fafafa', fg2: '#a1a1aa', fg3: '#71717a', fg4: '#52525b',
  green: '#22c55e', greenHi: '#34d36b', greenTx: '#86efac', greenDim: '#16351f',
  amber: '#e0a32e', amberDim: '#3a2f12', red: '#f87171', redDim: '#3a1c1c',
};
const SANS = 'DejaVu Sans, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- reusable pieces -----------------------------------------------------
const FIST = (x, y, s = 1, fill = 'url(#green)') => `<g transform="translate(${x},${y}) scale(${s})" fill="${fill}">
  <rect x="14" y="33" width="20" height="11" rx="4.5"/><rect x="10.5" y="17" width="27" height="18" rx="6"/>
  <rect x="11" y="10" width="5.6" height="12" rx="2.8"/><rect x="17.8" y="8.5" width="5.6" height="13.5" rx="2.8"/>
  <rect x="24.6" y="8.5" width="5.6" height="13.5" rx="2.8"/><rect x="31.4" y="10" width="5.6" height="12" rx="2.8"/>
  <rect x="8" y="22" width="15" height="7.5" rx="3.75" transform="rotate(-18 15 26)"/></g>`;

const DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>
  <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(170 30) rotate(35) scale(760 520)">
    <stop offset="0" stop-color="${C.green}" stop-opacity="0.20"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></radialGradient>
  <linearGradient id="green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.greenHi}"/><stop offset="1" stop-color="#16a34a"/></linearGradient>
  <filter id="sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="22" stdDeviation="34" flood-color="#000" flood-opacity="0.55"/></filter>
  <filter id="sh2" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>`;

// pill chip with a dot
function chip(x, y, label, { dot = C.green, w = null, fg = C.fg2, bg = '#10231a', bd = '#1d3b29' } = {}) {
  const width = w ?? 26 + label.length * 8.4;
  return `<g transform="translate(${x},${y})">
    <rect width="${width}" height="30" rx="15" fill="${bg}" stroke="${bd}"/>
    ${dot ? `<circle cx="17" cy="15" r="4" fill="${dot}"/>` : ''}
    <text x="${dot ? 28 : 14}" y="20" font-family="${MONO}" font-size="13" fill="${fg}">${esc(label)}</text></g>`;
}

function fitBadge(x, y, kind) {
  const map = { FITS: [C.greenDim, '#225c38', C.greenTx], TIGHT: [C.amberDim, '#5c4a18', C.amber], 'TOO BIG': [C.redDim, '#5c2b2b', C.red] };
  const [bg, bd, fg] = map[kind];
  const w = 22 + kind.length * 8.6;
  return `<g transform="translate(${x},${y})"><rect width="${w}" height="22" rx="11" fill="${bg}" stroke="${bd}"/>
    <text x="${w / 2}" y="15.5" font-family="${MONO}" font-size="12" font-weight="bold" fill="${fg}" text-anchor="middle" letter-spacing="0.5">${kind}</text></g>`;
}

async function render(name, svg, scale = 2) {
  await sharp(Buffer.from(svg), { density: 72 * scale }).png().toFile(path.join(DIR, `${name}.png`));
  console.log('rendered', name + '.png');
}

// ==========================================================================
// 1) HERO BANNER
// ==========================================================================
function banner() {
  const W = 1320, H = 450;
  // right-side app window mock
  const win = `<g transform="translate(815,70)" filter="url(#sh)">
    <rect width="430" height="310" rx="16" fill="${C.card}" stroke="${C.line}"/>
    <rect width="430" height="310" rx="16" fill="none" stroke="${C.green}" stroke-opacity="0.18"/>
    <circle cx="22" cy="24" r="5" fill="#f87171"/><circle cx="40" cy="24" r="5" fill="#fbbf24"/><circle cx="58" cy="24" r="5" fill="#34d36b"/>
    <g transform="translate(300,13)"><rect width="116" height="24" rx="12" fill="${C.card2}" stroke="${C.line2}"/><circle cx="15" cy="12" r="4" fill="${C.green}"/><text x="26" y="16.5" font-family="${MONO}" font-size="12" fill="${C.fg2}">Qwen3-4B</text></g>
    <line x1="0" y1="52" x2="430" y2="52" stroke="${C.line}"/>
    <!-- assistant bubble -->
    <g transform="translate(22,72)">${FIST(0, 0, 0.5)}
      <rect x="34" y="2" width="300" height="9" rx="4.5" fill="#2a2a30"/><rect x="34" y="19" width="340" height="9" rx="4.5" fill="#222228"/><rect x="34" y="36" width="250" height="9" rx="4.5" fill="#222228"/>
      <g transform="translate(34,54)">${fitBadge(0, 0, 'FITS')}</g>
    </g>
    <!-- user bubble -->
    <g transform="translate(150,168)"><rect width="258" height="58" rx="14" fill="url(#green)"/>
      <rect x="20" y="18" width="210" height="8" rx="4" fill="#dffbe8"/><rect x="20" y="34" width="150" height="8" rx="4" fill="#bff0cf"/></g>
    <!-- input -->
    <g transform="translate(22,258)"><rect width="386" height="34" rx="17" fill="${C.bg2}" stroke="${C.line2}"/><rect x="16" y="15" width="200" height="6" rx="3" fill="#2a2a30"/>
      <circle cx="368" cy="17" r="13" fill="url(#green)"/><path d="M362 17h10m-4-4 4 4-4 4" stroke="#06140b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
  </g>`;

  const left = `<g transform="translate(82,70)">
    ${FIST(0, 0, 1.0)}
    <text x="58" y="22" font-family="${MONO}" font-size="14" fill="${C.greenTx}" letter-spacing="3">PRIVATE AI WORKSPACE</text>
    <text x="-4" y="118" font-family="${SANS}" font-size="92" font-weight="bold" fill="${C.fg}" letter-spacing="-3">Chakor</text>
    <text x="0" y="172" font-family="${SANS}" font-size="30" font-weight="bold" fill="${C.fg}">Your AI. Your hardware. <tspan fill="${C.greenHi}">Nobody else&#39;s business.</tspan></text>
    <text x="0" y="208" font-family="${SANS}" font-size="18" fill="${C.fg2}">Run any model on your own machine. No cloud, no tracking, no big tech.</text>
    ${chip(0, 236, 'Local-first')}
    ${chip(135, 236, 'Hardware-aware', { dot: C.green })}
    ${chip(310, 236, 'llama.cpp · Ollama · LM Studio', { dot: null, fg: C.fg3, bg: C.card, bd: C.line })}
    ${chip(0, 276, 'Zero telemetry', { dot: null, fg: C.fg3, bg: C.card, bd: C.line })}
    ${chip(165, 276, 'Your data stays home', { dot: null, fg: C.fg3, bg: C.card, bd: C.line })}
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
    <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
    <rect x="0" y="${H - 3}" width="${W}" height="3" fill="${C.green}" opacity="0.6"/>
    ${win}${left}</svg>`;
}

// ---- app-window helpers --------------------------------------------------
const win = (w, h) => `<rect width="${w}" height="${h}" rx="18" fill="${C.bg2}" stroke="${C.line}"/>`;
const navIcon = {
  compare: 'M3 3v14h14M7 13v-4M11 13V6M15 13v-2',
  notes: 'M4 5h12M4 10h12M4 15h8',
  memory: 'M10 3a7 7 0 100 14 7 7 0 000-14zm0 4a3 3 0 100 6 3 3 0 000-6z',
  settings: 'M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2m0 12v2M2 10h2m12 0h2M4.5 4.5l1.4 1.4m8.2 8.2 1.4 1.4m0-11-1.4 1.4m-8.2 8.2-1.4 1.4',
};

// ==========================================================================
// 2) CHAT PREVIEW  (the "look" image)
// ==========================================================================
function preview() {
  const W = 1180, H = 742, SB = 264;
  const conv = (y, title, active) => `<g transform="translate(14,${y})">
    <rect width="${SB - 28}" height="38" rx="9" fill="${active ? C.card2 : 'transparent'}"/>
    ${active ? `<circle cx="${SB - 50}" cy="19" r="4" fill="${C.green}"/>` : ''}
    <text x="14" y="24" font-family="${SANS}" font-size="14" fill="${active ? C.fg : C.fg3}">${esc(title)}</text></g>`;
  const nav = (y, icon, label, active) => `<g transform="translate(14,${y})">
    <rect width="${SB - 28}" height="40" rx="9" fill="${active ? C.card2 : 'transparent'}"/>
    <path transform="translate(15,11)" d="${navIcon[icon]}" fill="none" stroke="${active ? C.green : C.fg3}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="46" y="25" font-family="${SANS}" font-size="14" fill="${active ? C.fg : C.fg2}" font-weight="${active ? 'bold' : 'normal'}">${esc(label)}</text></g>`;

  const sidebar = `<g>
    <rect width="${SB}" height="${H}" fill="${C.bg0}"/><line x1="${SB}" y1="0" x2="${SB}" y2="${H}" stroke="${C.line}"/>
    ${FIST(20, 24, 0.62)} <text x="54" y="46" font-family="${SANS}" font-size="20" font-weight="bold" fill="${C.fg}">Chakor</text>
    <g transform="translate(14,72)"><rect width="${SB - 28}" height="42" rx="10" fill="url(#green)"/>
      <path d="M24 21h14m-7-7v14" stroke="#06140b" stroke-width="2.4" stroke-linecap="round"/><text x="50" y="26" font-family="${SANS}" font-size="14.5" font-weight="bold" fill="#06140b">New chat</text></g>
    <g transform="translate(14,126)"><rect width="${SB - 28}" height="38" rx="9" fill="${C.bg2}" stroke="${C.line}"/>
      <circle cx="22" cy="19" r="5.5" fill="none" stroke="${C.fg4}" stroke-width="1.6"/><path d="M26 23l3 3" stroke="${C.fg4}" stroke-width="1.6" stroke-linecap="round"/>
      <text x="38" y="24" font-family="${SANS}" font-size="13.5" fill="${C.fg4}">Search chats</text></g>
    <text x="20" y="196" font-family="${MONO}" font-size="11" fill="${C.fg4}" letter-spacing="1.5">CONVERSATIONS</text>
    ${conv(208, 'Self-hosting setup', true)}${conv(250, 'Refactor the auth flow', false)}
    <g transform="translate(14,296)"><path d="M16 8h6l2 3h10v12H16z" fill="none" stroke="${C.fg3}" stroke-width="1.6" stroke-linejoin="round"/><text x="46" y="26" font-family="${SANS}" font-size="14" fill="${C.fg2}">Work</text><path d="M${SB-44} 16l5 5 5-5" fill="none" stroke="${C.fg4}" stroke-width="1.6" stroke-linecap="round"/></g>
    ${conv(338, 'Weekend trip plan', false)}
    <line x1="20" y1="392" x2="${SB - 20}" y2="392" stroke="${C.line}"/>
    ${nav(408, 'compare', 'Compare', true)}${nav(452, 'notes', 'Notes', false)}${nav(496, 'memory', 'Memory', false)}${nav(540, 'settings', 'Settings', false)}
    <g transform="translate(14,${H - 56})"><circle cx="19" cy="19" r="16" fill="url(#green)"/><text x="19" y="24" font-family="${SANS}" font-size="14" font-weight="bold" fill="#06140b" text-anchor="middle">T</text>
      <text x="46" y="17" font-family="${SANS}" font-size="13.5" fill="${C.fg}">tyfsadik</text>
      <g transform="translate(46,24)"><rect width="46" height="17" rx="8.5" fill="${C.greenDim}"/><text x="23" y="12.5" font-family="${MONO}" font-size="10.5" fill="${C.greenTx}" text-anchor="middle">admin</text></g></g>
  </g>`;

  const M = SB + 36;
  const codeLine = (y, segs) => `<g transform="translate(${M + 30},${y})">${segs.map(([x, w, c]) => `<rect x="${x}" y="0" width="${w}" height="9" rx="4.5" fill="${c}"/>`).join('')}</g>`;
  const top = `<g>
    <g transform="translate(${M},22)"><rect width="150" height="36" rx="10" fill="${C.card2}" stroke="${C.line2}"/><circle cx="18" cy="18" r="4.5" fill="${C.green}"/><text x="30" y="23" font-family="${SANS}" font-size="14" fill="${C.fg}">Qwen3-4B</text><path d="M132 16l5 5 5-5" fill="none" stroke="${C.fg3}" stroke-width="1.6" stroke-linecap="round"/></g>
    <g transform="translate(${M + 162},22)"><rect width="92" height="36" rx="10" fill="${C.bg2}" stroke="${C.line}"/><path d="M16 14h12M16 19h8" stroke="${C.fg3}" stroke-width="1.7" stroke-linecap="round"/><text x="38" y="23" font-family="${MONO}" font-size="13" fill="${C.greenTx}">32K</text></g>
    <g transform="translate(${W - 264},22)"><rect width="148" height="36" rx="18" fill="${C.greenDim}" stroke="${C.green}" stroke-opacity="0.4"/><text x="18" y="23" font-family="${SANS}" font-size="13.5" fill="${C.greenTx}">Web search</text><rect x="112" y="9" width="28" height="18" rx="9" fill="url(#green)"/><circle cx="131" cy="18" r="6.5" fill="#06140b"/></g>
    <circle cx="${W - 96}" cy="40" r="5" fill="${C.green}"/>
    <line x1="${SB}" y1="80" x2="${W}" y2="80" stroke="${C.line}"/></g>`;

  const chat = `<g>
    <g transform="translate(${M},116)">${FIST(0, 2, 0.5)}
      <text x="34" y="6" font-family="${SANS}" font-size="14.5" fill="${C.fg}">Linux 6.12 ships the EEVDF scheduler as default, replacing CFS. It</text>
      <text x="34" y="30" font-family="${SANS}" font-size="14.5" fill="${C.fg}">picks the task with the earliest virtual deadline, so latency-sensitive</text>
      <text x="34" y="54" font-family="${SANS}" font-size="14.5" fill="${C.fg}">work gets served first without the old nice-value heuristics:</text>
      <g transform="translate(34,72)"><rect width="118" height="30" rx="15" fill="${C.card}" stroke="${C.line}"/><circle cx="18" cy="15" r="5" fill="none" stroke="${C.greenTx}" stroke-width="1.5"/><path d="M21 18l3 3" stroke="${C.greenTx}" stroke-width="1.5" stroke-linecap="round"/><text x="30" y="20" font-family="${SANS}" font-size="12.5" fill="${C.greenTx}">4 sources</text></g>
    </g>
    <g transform="translate(${W - 470},372)"><rect width="446" height="64" rx="14" fill="url(#green)"/>
      <text x="24" y="28" font-family="${SANS}" font-size="14.5" fill="#06140b">What changed in the Linux 6.12 scheduler,</text>
      <text x="24" y="48" font-family="${SANS}" font-size="14.5" fill="#06140b">and why does it matter for desktops?</text></g>
    <g transform="translate(${M},462)">${FIST(0, 2, 0.5)}
      <text x="34" y="6" font-family="${SANS}" font-size="14.5" fill="${C.fg}">For an interactive desktop it means snappier UI under load: a video</text>
      <text x="34" y="30" font-family="${SANS}" font-size="14.5" fill="${C.fg}">call or a compile no longer starves your cursor. EEVDF gives each</text>
      <text x="34" y="54" font-family="${SANS}" font-size="14.5" fill="${C.fg}">runnable task a fair share, bounded by an explicit deadline.<tspan fill="${C.green}">&#9610;</tspan></text>
      <g transform="translate(34,74)"><text font-family="${MONO}" font-size="12" fill="${C.fg4}">142 tokens · 1.4s · <tspan fill="${C.green}">98.6 t/s</tspan></text></g></g></g>`;

  const codeBlock = `<g transform="translate(${M + 34},226)"><rect width="470" height="120" rx="12" fill="#0b0b0d" stroke="${C.line}"/>
    <g transform="translate(20,22)">
      ${[[[0,46,'#c084fc'],[54,84,'#7dd3fc']],[[0,30,'#94a3b8'],[38,120,'#fbbf24']],[[16,150,'#86efac']],[[16,90,'#94a3b8'],[114,40,'#7dd3fc']],[[0,64,'#c084fc']]].map((segs,i)=>`<g transform="translate(0,${i*20})">${segs.map(([x,w,c])=>`<rect x="${x}" width="${w}" height="9" rx="4.5" fill="${c}" opacity="0.9"/>`).join('')}</g>`).join('')}
    </g></g>`;

  const input = `<g transform="translate(${M},${H - 64})"><rect width="${W - M - 24}" height="46" rx="23" fill="${C.bg2}" stroke="${C.line2}"/>
    <path d="M28 23c-4 0-7-3-7-7s3-7 7-7 7 3 7 7" fill="none" stroke="${C.fg4}" stroke-width="1.6" stroke-linecap="round"/>
    <text x="48" y="28" font-family="${SANS}" font-size="14" fill="${C.fg4}">Message Chakor. Runs on your machine.</text>
    <circle cx="${W - M - 24 - 26}" cy="23" r="16" fill="url(#green)"/><path d="M${W - M - 24 - 33} 23h14m-5-5 5 5-5 5" stroke="#06140b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
    <rect width="${W}" height="${H}" fill="${C.bg2}"/>${sidebar}${top}${chat}${codeBlock}${input}</svg>`;
}

// ==========================================================================
// 3) HARDWARE-AWARE FIT  (Settings -> Models) — the differentiator
// ==========================================================================
function fit() {
  const W = 940, H = 772, PX = 40;
  const label = (x, y, t) => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="12" fill="${C.fg3}" letter-spacing="1.5">${t}</text>`;
  const statTile = (x, y, w, k, v) => `<g transform="translate(${x},${y})"><rect width="${w}" height="58" rx="10" fill="${C.card2}" stroke="${C.line}"/>
    <text x="14" y="24" font-family="${MONO}" font-size="11" fill="${C.fg4}" letter-spacing="1">${k}</text><text x="14" y="44" font-family="${SANS}" font-size="14" fill="${C.fg2}">${esc(v)}</text></g>`;
  const engineRow = (y, name, sub, on, pill, pcol) => `<g transform="translate(0,${y})">
    <circle cx="20" cy="20" r="5" fill="${on ? C.green : C.line2}"/>
    <text x="40" y="17" font-family="${SANS}" font-size="14" fill="${C.fg}">${esc(name)}</text>
    <text x="40" y="34" font-family="${MONO}" font-size="11.5" fill="${C.fg4}">${esc(sub)}</text>
    <g transform="translate(${W - 2 * PX - 40 - 96},9)"><rect width="96" height="22" rx="11" fill="${on ? C.greenDim : C.card2}" stroke="${on ? '#225c38' : C.line2}"/><text x="48" y="15.5" font-family="${MONO}" font-size="11" fill="${pcol}" text-anchor="middle">${pill}</text></g>
    <line x1="0" y1="52" x2="${W - 2 * PX}" y2="52" stroke="${C.line}"/></g>`;
  const modelRow = (y, name, size, kind, tag, action) => {
    const inner = W - 2 * PX;
    return `<g transform="translate(0,${y})"><rect width="${inner}" height="58" rx="0" fill="${tag === 'RUNNING' ? C.greenDim : 'transparent'}"/>
      <text x="16" y="26" font-family="${SANS}" font-size="14" fill="${C.fg}">${esc(name)}</text>
      <g transform="translate(${16 + name.length * 7.7 + 14},15)">${fitBadge(0, 0, kind)}</g>
      ${tag === 'RECOMMENDED' ? `<g transform="translate(${16 + name.length * 7.7 + 28 + kind.length * 8.6 + 22},15)"><rect width="118" height="22" rx="11" fill="${C.greenDim}" stroke="#225c38"/><text x="59" y="15.5" font-family="${MONO}" font-size="11" font-weight="bold" fill="${C.greenTx}" text-anchor="middle">RECOMMENDED</text></g>` : ''}
      <text x="16" y="44" font-family="${MONO}" font-size="11.5" fill="${kind === 'TOO BIG' ? C.red : C.fg4}">${esc(size)}</text>
      ${tag === 'RUNNING'
        ? `<text x="${inner - 16}" y="33" font-family="${MONO}" font-size="12" font-weight="bold" fill="${C.greenTx}" text-anchor="end">RUNNING</text>`
        : `<g transform="translate(${inner - 16 - 64},14)"><rect width="64" height="30" rx="8" fill="transparent" stroke="${C.line2}"/><text x="32" y="20" font-family="${SANS}" font-size="13" fill="${C.fg2}" text-anchor="middle">${action}</text></g>`}
      <line x1="0" y1="58" x2="${inner}" y2="58" stroke="${C.line}"/></g>`;
  };

  const card = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.bg1}" stroke="${C.line}"/>`;
  const iw = W - 2 * PX;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
    <rect width="${W}" height="${H}" fill="${C.bg2}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
    <text x="${PX}" y="50" font-family="${SANS}" font-size="22" font-weight="bold" fill="${C.fg}">Models</text>
    <text x="${PX}" y="74" font-family="${SANS}" font-size="13.5" fill="${C.fg3}">Chakor reads your machine and tells you what will actually run, before it can crash.</text>

    ${label(PX, 116, 'YOUR HARDWARE')}
    ${card(PX, 128, iw, 122)}
    <text x="${PX + 18}" y="158" font-family="${SANS}" font-size="14.5" fill="${C.fg}">16 GB RAM · NVIDIA GeForce RTX 3060 12 GB</text>
    <g transform="translate(${W - PX - 18 - 84},140)"><rect width="84" height="30" rx="8" fill="transparent" stroke="${C.line2}"/><text x="42" y="20" font-family="${SANS}" font-size="12.5" fill="${C.fg2}" text-anchor="middle">Rescan</text></g>
    ${statTile(PX + 18, 176, (iw - 36 - 24) / 3, 'MEMORY', '16 GB · 12 GB free')}
    ${statTile(PX + 18 + (iw - 36 - 24) / 3 + 12, 176, (iw - 36 - 24) / 3, 'PROCESSOR', 'Ryzen 7 · 16 cores')}
    ${statTile(PX + 18 + 2 * ((iw - 36 - 24) / 3 + 12), 176, (iw - 36 - 24) / 3, 'GRAPHICS', 'RTX 3060 · 12 GB')}

    ${label(PX, 290, 'AI ENGINES')}
    ${card(PX, 302, iw, 170)}
    <g transform="translate(${PX + 20},318)">
      ${engineRow(0, 'llama.cpp', 'managed by Chakor · http://127.0.0.1:4546', true, '1 model', C.greenTx)}
      ${engineRow(54, 'Ollama', '3 models installed · http://127.0.0.1:11434', true, '3 models', C.greenTx)}
      ${engineRow(108, 'LM Studio', 'not running · http://127.0.0.1:1234/v1', false, 'offline', C.fg4)}
    </g>

    ${label(PX, 512, 'LOCAL MODELS')}
    ${card(PX, 524, iw, 208)}
    <g transform="translate(${PX + 20},540)">
      ${modelRow(0, 'Qwen3-4B-Q4_K_M.gguf', '2.4 GB · runs on the GPU', 'FITS', 'RECOMMENDED', 'Use')}
      ${modelRow(58, 'Llama-3.1-8B-Q4_K_M.gguf', '4.9 GB · runs on the GPU', 'FITS', 'RUNNING', '')}
      ${modelRow(116, 'DeepSeek-R1-14B-Q4.gguf', '9.0 GB · partly on CPU, slower', 'TIGHT', '', 'Use')}
      ${modelRow(174, 'Qwen2.5-32B-Q4_K_M.gguf', '20 GB · needs more than 16 GB', 'TOO BIG', '', 'Use')}
    </g>
  </svg>`;
}

// ==========================================================================
// 4) DOWNLOAD FROM HUGGING FACE  (in-app, background)
// ==========================================================================
function download() {
  const W = 940, H = 612, PX = 40, iw = W - 2 * PX;
  const label = (x, y, t) => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="12" fill="${C.fg3}" letter-spacing="1.5">${t}</text>`;
  const fileRow = (y, name, meta, kind, pct) => `<g transform="translate(20,${y})">
    <text x="0" y="16" font-family="${SANS}" font-size="13.5" fill="${C.fg}">${esc(name)}</text>
    <g transform="translate(${name.length * 7.4 + 12},3)">${fitBadge(0, 0, kind)}</g>
    <text x="0" y="36" font-family="${MONO}" font-size="11.5" fill="${kind === 'TOO BIG' ? C.red : C.fg4}">${esc(meta)}</text>
    ${pct != null
      ? `<text x="${iw - 40 - 20}" y="26" font-family="${MONO}" font-size="13" font-weight="bold" fill="${C.greenTx}" text-anchor="end">${pct}%</text>`
      : `<g transform="translate(${iw - 40 - 84},6)"><rect width="84" height="30" rx="8" fill="transparent" stroke="${C.line2}"/><text x="42" y="20" font-family="${SANS}" font-size="12.5" fill="${C.fg2}" text-anchor="middle">Download</text></g>`}
    <line x1="0" y1="50" x2="${iw - 40}" y2="50" stroke="${C.line}"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
    <rect width="${W}" height="${H}" fill="${C.bg2}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
    <text x="${PX}" y="48" font-family="${SANS}" font-size="22" font-weight="bold" fill="${C.fg}">Download from Hugging Face</text>
    <text x="${PX}" y="72" font-family="${SANS}" font-size="13.5" fill="${C.fg3}">Search, pick a quant that fits, click once. It downloads to your models folder, ready for llama.cpp.</text>

    <g transform="translate(${PX},96)"><rect width="${iw - 120}" height="42" rx="10" fill="${C.bg1}" stroke="${C.line2}"/><text x="18" y="27" font-family="${SANS}" font-size="14" fill="${C.fg}">qwen3 4b</text>
      <rect x="${iw - 110}" y="0" width="110" height="42" rx="10" fill="url(#green)"/><text x="${iw - 55}" y="27" font-family="${SANS}" font-size="14" font-weight="bold" fill="#06140b" text-anchor="middle">Search</text></g>

    ${label(PX, 178, 'unsloth/Qwen3-4B-GGUF   ·   ↓ 720k   ·   ♥ 269')}
    <rect x="${PX}" y="190" width="${iw}" height="172" rx="12" fill="${C.bg1}" stroke="${C.line}"/>
    <g transform="translate(${PX},206)">
      ${fileRow(0, 'Qwen3-4B-Q4_K_M.gguf', '2.4 GB · Q4_K_M · runs on the GPU', 'FITS', null)}
      ${fileRow(58, 'Qwen3-4B-Q8_0.gguf', '4.3 GB · Q8_0 · partly on CPU, slower', 'TIGHT', null)}
      ${fileRow(116, 'Qwen3-4B-F16.gguf', '8.1 GB · F16 · needs more memory', 'TOO BIG', null)}
    </g>

    ${label(PX, 410, 'DOWNLOADS  ·  these run on the server, close the tab if you like')}
    <rect x="${PX}" y="422" width="${iw}" height="150" rx="12" fill="${C.bg1}" stroke="${C.line}"/>
    <g transform="translate(${PX + 20},446)">
      <text x="0" y="16" font-family="${SANS}" font-size="13.5" fill="${C.fg}">qwen3-4b-q4_k_m.gguf</text>
      <text x="0" y="36" font-family="${MONO}" font-size="11.5" fill="${C.greenTx}">1.2 GB / 2.4 GB · 98 MB/s · 12s left</text>
      <g transform="translate(${iw - 40 - 70},6)"><rect width="70" height="28" rx="8" fill="transparent" stroke="#5c2b2b"/><text x="35" y="19" font-family="${SANS}" font-size="12.5" fill="${C.red}" text-anchor="middle">Cancel</text></g>
      <rect x="0" y="50" width="${iw - 40}" height="7" rx="3.5" fill="${C.bg3 || '#27272a'}"/><rect x="0" y="50" width="${(iw - 40) * 0.5}" height="7" rx="3.5" fill="url(#green)"/>
      <g transform="translate(0,74)"><text x="0" y="16" font-family="${SANS}" font-size="13.5" fill="${C.fg2}">mmproj-Qwen3-VL-4B-F16.gguf</text><text x="0" y="36" font-family="${MONO}" font-size="11.5" fill="${C.fg4}">Done · 1.1 GB</text>
        <text x="${iw - 40}" y="26" font-family="${MONO}" font-size="12" fill="${C.greenTx}" text-anchor="end">100%</text></g>
    </g>
  </svg>`;
}

await render('banner', banner());
await render('preview', preview());
await render('fit', fit());
await render('download', download());
console.log('done');
