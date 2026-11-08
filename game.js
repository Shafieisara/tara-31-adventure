(() => {
"use strict";

// Since 2015 — improved birthday-adventure cut into 31 micro-rooms
// Adventure-style skies + Tara/Sara + 31 multi-photo memories + cake finale

const TILE = 32;
const COLS = 24;
const ROWS = 14;
const W = COLS * TILE;
const H = ROWS * TILE;
const GRAVITY = 0.5;
const JUMP_FORCE = -12.2;
const MOVE_SPEED = 6.2;
const MAX_FALL = 12;
const FRICTION = 0.76;
const ACCEL = 1.12;
const COYOTE = 10;
const JUMP_BUF = 10;

const EMPTY=0, GROUND=1, PLATFORM=2, SPIKE=3, COIN=4, SPRING=5, EXIT=6, MEM=9;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = W; canvas.height = H;

const stageEl = document.getElementById("stage");
const memCountEl = document.getElementById("memcount");
const titleEl = document.getElementById("title");
const memEl = document.getElementById("mem");
const gateEl = document.getElementById("year-gate");
const roomBanner = document.getElementById("roomBanner");
const cakeEl = document.getElementById("cakeWin");

const keys = {};
window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
  if (e.key === "Escape") {
    if (gameState === "memory") closeMemory(false);
  }
  if ((e.key === "Enter" || e.code === "Enter") && gameState === "memory") {
    e.preventDefault();
    closeMemory(true);
  }
  if ((e.key === "ArrowLeft" || e.key === "a" || e.key === "A") && gameState === "memory") stepPhoto(-1);
  if ((e.key === "ArrowRight" || e.key === "d" || e.key === "D") && gameState === "memory") stepPhoto(1);
});
window.addEventListener("keyup", e => { keys[e.code] = false; });
const left = () => keys.ArrowLeft || keys.KeyA;
const right = () => keys.ArrowRight || keys.KeyD;
const jump = () => keys.ArrowUp || keys.KeyW || keys.Space;

function load(src){ const i = new Image(); i.src = src; return i; }
function loadPrefer(hi, lo){
  const i = new Image();
  i.src = hi;
  i.onerror = () => { i.onerror = null; i.src = lo; };
  return i;
}

const img = {
  back: load("env/back.png"),
  middle: load("env/middle.png"),
  tara: {
    idle: loadPrefer("sprites/tara-idle@2x.png","sprites/tara-idle.png"),
    walk: loadPrefer("sprites/tara-walk@2x.png","sprites/tara-walk.png"),
    jump: loadPrefer("sprites/tara-jump@2x.png","sprites/tara-jump.png"),
  },
  sara: {
    idle: loadPrefer("sprites/sara-idle@2x.png","sprites/sara-idle.png"),
    walk: loadPrefer("sprites/sara-walk@2x.png","sprites/sara-walk.png"),
    jump: loadPrefer("sprites/sara-jump@2x.png","sprites/sara-jump.png"),
  },
  hug: loadPrefer("sprites/hug@2x.png","sprites/hug.png"),
};

let LEVELS = [];
let MEMORIES = [];
let ready = false;

function normalizeMemory(m){
  const imgs = (m.imgs && m.imgs.length) ? m.imgs.slice()
    : (m.photo ? [m.photo] : []);
  return {
    id: m.id || ("mem-" + m.n),
    n: m.n,
    skin: m.skin || (m.kind === "video" || m.video ? "vhs" : "photo"),
    title: m.title || ("خاطره " + m.n),
    year: m.year || m.date || "2015-01-01",
    dateLocked: !!m.dateLocked,
    lines: m.lines || m.note || "",
    imgs,
    video: m.video || null,
  };
}

let LEVEL_TEMPLATES = [];

Promise.all([
  fetch("levels.json").then(r => r.json()),
  fetch("memories.json").then(r => r.json()),
]).then(([levels, memories]) => {
  LEVEL_TEMPLATES = levels.map(L => ({
    ...L,
    map: L.map.map(row => row.slice()),
    movingPlatforms: (L.movingPlatforms || []).map(m => ({...m})),
  }));
  LEVELS = LEVEL_TEMPLATES.map(L => ({
    ...L,
    map: L.map.map(row => row.slice()),
    movingPlatforms: (L.movingPlatforms || []).map(m => ({...m})),
  }));
  MEMORIES = memories.map(normalizeMemory);
  ready = true;
}).catch(err => console.error(err));

let currentLevel = 0;
let collected = new Set();
let gameState = "gate"; // gate, title, playing, memory, win
let particles = [];
let screenShake = 0;
let coinTaken = Array.from({length:ROWS}, () => Array(COLS).fill(true));
let memTaken = false;
let exitOpen = false;
let gt = 0;
let hugUntil = 0;
let fade = 0;
let photoIdx = 0;
let activeMem = null;
let movers = [];
let balloons = [];
let hills = [];
let roomFlash = 0;

const player = {
  x:0,y:0,vx:0,vy:0,w:18,h:30,
  onGround:false, facing:1, coyote:0, jumpBuf:0, dead:false
};
const buddy = { x:0, y:0, facing:1 };

const palettes = [
  { // dawn childhood
    sky:["#a8dff7","#6db8e6"], hill:["#7ec8a0","#5aa87a"], dirt:"#8b5a2b", grass:"#5daf4a",
    plat:"#f4a7c6", accent:"#ffe08a", cave:false
  },
  { // meadow friendship
    sky:["#b9e6c8","#7ec4e8"], hill:["#8fd49a","#5faf70"], dirt:"#7a4e2d", grass:"#4c9a5a",
    plat:"#ffd27a", accent:"#ff9f43", cave:false
  },
  { // dusk years
    sky:["#f0b89a","#7a8ec8"], hill:["#6a7a9a","#44506e"], dirt:"#5a3a28", grass:"#3f8f6a",
    plat:"#c9a0ff", accent:"#ffd93d", cave:false
  },
  { // gold present
    sky:["#ffe6c2","#f0a868"], hill:["#d4c078","#a88848"], dirt:"#8d5a2b", grass:"#6aa84f",
    plat:"#ff8fab", accent:"#fff1a8", cave:false
  },
];

function seedDecor(levelIdx){
  const pal = palettes[LEVELS[levelIdx]?.palette || 0];
  balloons = Array.from({length: 7}, (_,i) => ({
    x: 40 + i*100 + (levelIdx*17)%40,
    y: 50 + (i%4)*28,
    col: ["#FF6B9D","#FFD93D","#6BCB77","#4D96FF","#FF6B6B","#C9A0FF","#FF9F43"][i],
    sz: 10 + (i%3)*3,
    sw: Math.random()*Math.PI*2,
  }));
  hills = [
    {x:-40, y:H-90, w:280, h:110, col:pal.hill[1]},
    {x:160, y:H-120, w:340, h:140, col:pal.hill[0]},
    {x:420, y:H-100, w:300, h:120, col:pal.hill[1]},
    {x:620, y:H-85, w:220, h:100, col:pal.hill[0]},
  ];
}

// ── Year gate + Felicita ───────────────────────────────────
(function setupGate(){
  const years = ["2013","2014","2015","2016","2017","2018"];
  for (let i=years.length-1;i>0;i--){ const j=(i*5+3)%(i+1); [years[i],years[j]]=[years[j],years[i]]; }
  const row = document.getElementById("yg-years");
  const err = document.getElementById("yg-err");
  years.forEach(y => {
    const b = document.createElement("button");
    b.type="button"; b.textContent=y;
    b.onclick = () => {
      if (y === "2015") {
        b.classList.add("ok"); err.textContent = "درست بود.";
        startMusic();
        setTimeout(() => { gateEl.classList.add("hidden"); gameState="title"; }, 450);
      } else {
        err.textContent = "نه… سال دوستی را دوباره حدس بزن.";
      }
    };
    row.appendChild(b);
  });
})();

const audio = document.getElementById("felicita");
const musicBtn = document.getElementById("music");
audio.volume = 0.55; audio.loop = true;
function syncMusic(on){
  musicBtn.classList.toggle("on", !!on);
  musicBtn.classList.toggle("off", !on);
  musicBtn.setAttribute("aria-pressed", on?"true":"false");
  musicBtn.textContent = on ? "♪ Felicita · روشن" : "♪ Felicita · خاموش";
}
function startMusic(){
  audio.play().then(()=>syncMusic(true)).catch(()=>syncMusic(false));
}
musicBtn.onclick = (e) => {
  e.stopPropagation();
  if (audio.paused) startMusic(); else { audio.pause(); syncMusic(false); }
};
["pointerdown","keydown"].forEach(ev => window.addEventListener(ev, ()=>startMusic(), {once:true, passive:true}));

(function setupPad(){
  const pad = document.createElement("div");
  pad.id = "pad";
  pad.innerHTML = '<button type="button" data-k="ArrowLeft">◀</button><button type="button" data-k="Space">⤒</button><button type="button" data-k="ArrowRight">▶</button>';
  document.body.appendChild(pad);
  const style = document.createElement("style");
  style.textContent = `#pad{position:fixed;bottom:52px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:35}
  #pad button{width:56px;height:56px;border-radius:14px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.75);font-size:22px;cursor:pointer;backdrop-filter:blur(6px)}
  @media(min-width:900px){#pad{opacity:.5}}`;
  document.head.appendChild(style);
  pad.querySelectorAll("button").forEach(btn=>{
    const code = btn.dataset.k;
    const down = e => { e.preventDefault(); keys[code]=true; };
    const up = e => { e.preventDefault(); keys[code]=false; };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  });
})();

window.addEventListener("keydown", e => {
  if (e.key==="n" || e.key==="N") {
    if (gameState==="playing" && !memTaken) openMemoryForLevel(currentLevel);
    else if (gameState==="memory") closeMemory(true);
  }
  if (e.key==="." && gameState==="playing") {
    collected.add(MEMORIES[currentLevel]?.id || (currentLevel+1));
    memTaken = true; exitOpen = true;
    goNextRoom();
  }
});

document.getElementById("startBtn").onclick = () => {
  if (!ready) return;
  titleEl.classList.add("hidden");
  if (cakeEl) cakeEl.classList.add("hidden");
  startMusic();
  collected = new Set();
  startLevel(0);
  gameState = "playing";
  updateHUD();
};

function tileAt(c,r){
  if (r<0||c<0||r>=ROWS||c>=COLS) return GROUND;
  return LEVELS[currentLevel].map[r][c];
}
function solid(c,r){
  const t = tileAt(c,r);
  return t===GROUND || t===PLATFORM;
}

function findTile(type){
  const map = LEVELS[currentLevel].map;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (map[r][c]===type) return {c,r};
  return null;
}

function startLevel(idx){
  currentLevel = idx;
  const tmpl = LEVEL_TEMPLATES[idx];
  LEVELS[idx] = {
    ...tmpl,
    map: tmpl.map.map(row => row.slice()),
    movingPlatforms: (tmpl.movingPlatforms || []).map(m => ({...m})),
  };
  const lvl = LEVELS[idx];
  player.x = lvl.spawn[0]*TILE + 6;
  player.y = lvl.spawn[1]*TILE;
  player.vx=0; player.vy=0; player.dead=false; player.onGround=false;
  buddy.x = player.x - 28; buddy.y = player.y;
  coinTaken = Array.from({length:ROWS}, (_,r) =>
    Array.from({length:COLS}, (_,c) => lvl.map[r][c] !== COIN)
  );
  memTaken = collected.has(MEMORIES[idx]?.id);
  exitOpen = memTaken;
  // if already collected (replay), clear MEM orb
  if (memTaken) {
    const mem = findTile(MEM);
    if (mem) lvl.map[mem.r][mem.c] = EMPTY;
  }
  movers = (lvl.movingPlatforms || []).map(m => ({
    ...m,
    ox: m.x, oy: m.y, t: 0,
    px: m.x * TILE, py: m.y * TILE,
  }));
  seedDecor(idx);
  fade = 1;
  roomFlash = 90;
  if (roomBanner) {
    roomBanner.classList.remove("hidden");
    roomBanner.querySelector(".rb-n").textContent = `${idx+1} / 31`;
    roomBanner.querySelector(".rb-t").textContent = "";
    roomBanner.querySelector(".rb-y").textContent = "";
  }
  updateHUD();
}

function updateHUD(){
  stageEl.innerHTML = `اتاق <bdi>${currentLevel+1} / 31</bdi>`;
  memCountEl.innerHTML = `خاطره <bdi>${collected.size} / 31</bdi>`;
}

function rectTiles(x,y,w,h){
  const c0 = Math.floor(x/TILE), c1 = Math.floor((x+w-0.01)/TILE);
  const r0 = Math.floor(y/TILE), r1 = Math.floor((y+h-0.01)/TILE);
  return {c0,c1,r0,r1};
}

function updateMovers(){
  for (const m of movers) {
    m.t += 1;
    const amp = (m.range || 3) * TILE;
    const speed = Math.abs(m.dx || m.dy || 0.05);
    const wave = Math.sin(m.t * speed) * amp;
    if (m.axis === "y") {
      m.px = m.ox * TILE;
      m.py = m.oy * TILE + wave;
    } else {
      m.px = m.ox * TILE + wave;
      m.py = m.oy * TILE;
    }
  }
}

function moverSolidHit(px, py, pw, ph, prevY){
  for (const m of movers) {
    const mx = m.px, my = m.py, mw = m.w * TILE, mh = Math.max(10, m.h * 12);
    if (px + pw > mx && px < mx + mw && py + ph > my && py < my + mh) {
      if (prevY + ph <= my + 4 && player.vy >= 0) {
        return { kind:"land", y: my - ph, mover:m };
      }
      if (player.vy < 0 && py < my + mh) {
        return { kind:"head", y: my + mh, mover:m };
      }
      if (player.vx > 0) return { kind:"side", x: mx - pw, mover:m };
      if (player.vx < 0) return { kind:"side", x: mx + mw, mover:m };
    }
  }
  return null;
}

function movePlayer(){
  if (player.dead || gameState!=="playing") return;
  updateMovers();

  if (left()) { player.vx -= ACCEL; player.facing = -1; }
  else if (right()) { player.vx += ACCEL; player.facing = 1; }
  else player.vx *= FRICTION;
  if (player.vx > MOVE_SPEED) player.vx = MOVE_SPEED;
  if (player.vx < -MOVE_SPEED) player.vx = -MOVE_SPEED;
  if (Math.abs(player.vx) < 0.05) player.vx = 0;

  if (jump()) player.jumpBuf = JUMP_BUF;
  else if (player.jumpBuf>0) player.jumpBuf--;

  if (player.onGround) player.coyote = COYOTE;
  else if (player.coyote>0) player.coyote--;

  if (player.jumpBuf>0 && player.coyote>0) {
    player.vy = JUMP_FORCE;
    player.onGround = false;
    player.coyote = 0;
    player.jumpBuf = 0;
    spawnDust(player.x+player.w/2, player.y+player.h);
  }

  player.vy += GRAVITY;
  if (player.vy > MAX_FALL) player.vy = MAX_FALL;

  const prevY = player.y;

  player.x += player.vx;
  {
    const {c0,c1,r0,r1} = rectTiles(player.x, player.y, player.w, player.h);
    for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++) if (solid(c,r)) {
      if (player.vx>0) player.x = c*TILE - player.w;
      if (player.vx<0) player.x = (c+1)*TILE;
      player.vx = 0;
    }
    const hit = moverSolidHit(player.x, player.y, player.w, player.h, prevY);
    if (hit && hit.kind==="side") { player.x = hit.x; player.vx = 0; }
  }

  player.y += player.vy;
  player.onGround = false;
  {
    const {c0,c1,r0,r1} = rectTiles(player.x, player.y, player.w, player.h);
    for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++) {
      const t = tileAt(c,r);
      if (t===SPRING && player.vy>0) {
        player.vy = JUMP_FORCE * 1.35;
        player.y = r*TILE - player.h;
        spawnDust(player.x+player.w/2, player.y+player.h, "#ffe08a");
        continue;
      }
      if (!solid(c,r)) continue;
      if (player.vy>0) {
        player.y = r*TILE - player.h;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy<0) {
        player.y = (r+1)*TILE;
        player.vy = 0;
      }
    }
    const hit = moverSolidHit(player.x, player.y, player.w, player.h, prevY);
    if (hit) {
      if (hit.kind==="land") {
        player.y = hit.y; player.vy = 0; player.onGround = true;
        // ride
        const speed = Math.abs(hit.mover.dx || hit.mover.dy || 0.05);
        const amp = (hit.mover.range || 3) * TILE;
        if (hit.mover.axis !== "y") {
          player.x += Math.cos(hit.mover.t * speed) * amp * speed * 0.02;
        }
      } else if (hit.kind==="head") {
        player.y = hit.y; player.vy = 0;
      }
    }
  }

  const cx = Math.floor((player.x+player.w/2)/TILE);
  const cy = Math.floor((player.y+player.h/2)/TILE);
  const feet = Math.floor((player.y+player.h-1)/TILE);
  if (tileAt(cx, feet)===SPIKE || tileAt(cx, cy)===SPIKE) {
    respawn();
    return;
  }
  if (tileAt(cx,cy)===COIN && !coinTaken[cy][cx]) {
    coinTaken[cy][cx] = true;
    spawnDust(cx*TILE+16, cy*TILE+16, "#ffd93d");
  }

  if (!memTaken) {
    const memPos = findTile(MEM);
    if (memPos) {
      const orbX = memPos.c*TILE+16, orbY = memPos.r*TILE+16;
      const dx = (player.x+player.w/2) - orbX;
      const dy = (player.y+player.h/2) - orbY;
      if (dx*dx + dy*dy < 42*42) openMemoryForLevel(currentLevel);
    }
  } else if (exitOpen) {
    const ex = findTile(EXIT);
    if (ex) {
      const ox = ex.c*TILE+16, oy = ex.r*TILE+16;
      const dx = (player.x+player.w/2) - ox;
      const dy = (player.y+player.h/2) - oy;
      if (dx*dx + dy*dy < 40*40) goNextRoom();
    }
  }

  if (player.y > H + 40) respawn();

  const tx = player.x + player.w/2 - player.facing*28;
  const ty = player.y + 2;
  buddy.x += (tx - buddy.x) * 0.12;
  buddy.y += (ty - buddy.y) * 0.16;
  buddy.facing = player.facing;
}

function respawn(){
  screenShake = 10;
  const lvl = LEVELS[currentLevel];
  player.x = lvl.spawn[0]*TILE + 6;
  player.y = lvl.spawn[1]*TILE;
  player.vx=0; player.vy=0;
  spawnDust(player.x+player.w/2, player.y+player.h/2, "#ff8a7a");
}

function spawnDust(x,y,col="#fff"){
  for (let i=0;i<8;i++){
    particles.push({
      x,y, vx:(Math.random()-0.5)*3, vy:(Math.random()-0.5)*3-1,
      life:1, col
    });
  }
}

function openMemoryForLevel(idx){
  try {
    const mem = MEMORIES[idx];
    if (!mem) return;
    if (memTaken && gameState==="memory") return;
    memTaken = true;
    collected.add(mem.id);
    updateHUD();
    hugUntil = gt + 100;
    gameState = "memory";
    activeMem = mem;
    photoIdx = 0;

    const map = LEVELS[currentLevel].map;
    const memPos = findTile(MEM);
    if (memPos) map[memPos.r][memPos.c] = EMPTY;

    renderMemoryCard(mem);
    memEl.classList.add("on");
    startMusic();
  } catch (err) {
    console.error("openMemory", err);
    gameState = "playing";
  }
}

function renderMemoryCard(mem){
  const media = document.getElementById("memMedia");
  media.innerHTML = "";
  media.classList.toggle("vhs", mem.skin === "vhs");

  if (mem.skin === "vhs") {
    const badge = document.createElement("div");
    badge.className = "mem-vhs";
    badge.textContent = "ویدیو";
    media.appendChild(badge);
  }

  const imgs = mem.imgs && mem.imgs.length ? mem.imgs : [];
  if (mem.video) {
    const v = document.createElement("video");
    v.src = mem.video;
    v.controls = true;
    v.playsInline = true;
    if (imgs[0]) v.poster = imgs[0];
    v.onerror = () => { v.remove(); showPhotoStack(media, imgs); };
    media.appendChild(v);
  } else {
    showPhotoStack(media, imgs);
  }

  document.getElementById("memDate").textContent = mem.dateLocked ? formatDate(mem.year) : "";
  document.getElementById("memTitle").textContent = mem.title || "";
  document.getElementById("memNote").textContent = mem.lines || "";
  const counter = document.getElementById("memPhotoCount");
  if (counter) {
    const n = Math.max(1, (mem.imgs||[]).length);
    counter.textContent = n > 1 ? `عکس ${photoIdx+1} / ${n}` : "";
  }
}

function showPhotoStack(media, imgs){
  if (!imgs.length) {
    const empty = document.createElement("div");
    empty.className = "mem-empty";
    empty.textContent = "عکس به‌زودی";
    media.appendChild(empty);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "mem-stack";
  const imgEl = document.createElement("img");
  imgEl.id = "memPhoto";
  imgEl.src = imgs[photoIdx % imgs.length];
  imgEl.alt = "";
  wrap.appendChild(imgEl);
  if (imgs.length > 1) {
    const prev = document.createElement("button");
    prev.type = "button"; prev.className = "mem-nav prev"; prev.textContent = "‹";
    prev.onclick = (e) => { e.stopPropagation(); stepPhoto(-1); };
    const next = document.createElement("button");
    next.type = "button"; next.className = "mem-nav next"; next.textContent = "›";
    next.onclick = (e) => { e.stopPropagation(); stepPhoto(1); };
    wrap.appendChild(prev); wrap.appendChild(next);
  }
  media.appendChild(wrap);
}

function stepPhoto(dir){
  if (!activeMem || !activeMem.imgs || activeMem.imgs.length < 2) return;
  photoIdx = (photoIdx + dir + activeMem.imgs.length) % activeMem.imgs.length;
  const imgEl = document.getElementById("memPhoto");
  if (imgEl) imgEl.src = activeMem.imgs[photoIdx];
  const counter = document.getElementById("memPhotoCount");
  if (counter) counter.textContent = `عکس ${photoIdx+1} / ${activeMem.imgs.length}`;
}

function formatDate(iso){
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}/${parts[2]}`;
  return iso;
}

function closeMemory(advance){
  memEl.classList.remove("on");
  memEl.querySelectorAll("video").forEach(v => { try{v.pause();}catch(e){} });
  activeMem = null;
  exitOpen = true;
  if (advance) {
    // stay in room — walk to the glowing door
    gameState = "playing";
    roomFlash = 50;
    if (roomBanner) {
      roomBanner.querySelector(".rb-t").textContent = "";
    }
  } else {
    gameState = "playing";
  }
}

function goNextRoom(){
  fade = 1;
  if (currentLevel >= LEVELS.length - 1) {
    showWin();
  } else {
    startLevel(currentLevel + 1);
    gameState = "playing";
  }
}

function showWin(){
  gameState = "win";
  if (cakeEl) {
    cakeEl.classList.remove("hidden");
    titleEl.classList.add("hidden");
  } else {
    titleEl.classList.remove("hidden");
    titleEl.querySelector("h1").textContent = "۳۱ امین ۱۷ آبان تولد مبارک";
    const titleP = titleEl.querySelector("p");
    if (titleP) titleP.textContent = "تاراجانانم\nبه قول خودت امسال تولدت برای من خیلی خاص بوده\nپس زودتری به قولت عمل کن";
    titleEl.querySelector("#startBtn").textContent = "از اول";
  }
}

document.getElementById("memClose").onclick = () => closeMemory(false);
document.getElementById("memNext").onclick = () => closeMemory(true);
memEl.addEventListener("click", e => { if (e.target===memEl) closeMemory(false); });
const cakeReplay = document.getElementById("cakeReplay");
if (cakeReplay) cakeReplay.onclick = () => {
  cakeEl.classList.add("hidden");
  titleEl.classList.remove("hidden");
  titleEl.querySelector("h1").textContent = "تولدت مبارک، تارا";
  titleEl.querySelector("#startBtn").textContent = "شروع";
  gameState = "title";
};

function drawBalloon(x,y,col,sz){
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x,y,sz*0.7,sz,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = "rgba(40,40,40,.35)";
  ctx.beginPath(); ctx.moveTo(x,y+sz); ctx.quadraticCurveTo(x+4,y+sz+14,x,y+sz+22); ctx.stroke();
}

function drawBG(){
  const pal = palettes[LEVELS[currentLevel]?.palette || 0];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, pal.sky[0]);
  g.addColorStop(0.55, pal.sky[1]);
  g.addColorStop(1, pal.hill[1]);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // soft sun / moon
  const isDusk = (LEVELS[currentLevel]?.palette || 0) >= 2;
  ctx.fillStyle = isDusk ? "rgba(255,220,160,.55)" : "rgba(255,250,210,.7)";
  ctx.beginPath();
  ctx.arc(W*0.78, isDusk ? 70 : 58, isDusk ? 28 : 34, 0, Math.PI*2);
  ctx.fill();

  // parallax env art (subtle)
  const scroll = (currentLevel * 36 + player.x * 0.12) % 512;
  if (img.back.complete && img.back.naturalWidth) {
    ctx.globalAlpha = 0.35;
    ctx.drawImage(img.back, -scroll*0.25, H-170, 512, 160);
    ctx.drawImage(img.back, -scroll*0.25+512, H-170, 512, 160);
    ctx.globalAlpha = 1;
  }

  // painted hills
  for (const h of hills) {
    ctx.fillStyle = h.col;
    ctx.beginPath();
    ctx.ellipse(h.x + h.w/2, h.y + h.h*0.55, h.w/2, h.h/2, 0, 0, Math.PI*2);
    ctx.fill();
  }

  if (img.middle.complete && img.middle.naturalWidth) {
    ctx.globalAlpha = 0.45;
    ctx.drawImage(img.middle, -scroll*0.5, H-130, 512, 120);
    ctx.drawImage(img.middle, -scroll*0.5+512, H-130, 512, 120);
    ctx.globalAlpha = 1;
  }

  // clouds
  ctx.fillStyle = "rgba(255,255,255,.72)";
  for (let i=0;i<6;i++){
    const cx = ((i*130 + gt*0.25 + currentLevel*40) % (W+100)) - 50;
    const cy = 36 + (i%3)*26;
    ctx.beginPath(); ctx.ellipse(cx,cy,40,15,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx-22,cy+4,26,12,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+24,cy+5,24,11,0,0,Math.PI*2); ctx.fill();
  }

  balloons.forEach(b => {
    b.sw += 0.016;
    drawBalloon(b.x + Math.sin(b.sw)*10, b.y, b.col+"99", b.sz);
  });
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawTiles(){
  const pal = palettes[LEVELS[currentLevel].palette||0];
  const map = LEVELS[currentLevel].map;
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const t = map[r][c];
      const x=c*TILE, y=r*TILE;
      if (t===GROUND){
        const gg = ctx.createLinearGradient(0,y,0,y+TILE);
        gg.addColorStop(0, pal.grass);
        gg.addColorStop(0.22, pal.dirt);
        gg.addColorStop(1, "#5a3a1e");
        ctx.fillStyle = gg; ctx.fillRect(x,y,TILE,TILE);
        ctx.fillStyle = pal.grass; ctx.fillRect(x,y,TILE,7);
        ctx.fillStyle = "rgba(120,220,80,.55)";
        ctx.fillRect(x+5,y-3,3,6); ctx.fillRect(x+14,y-4,3,7); ctx.fillRect(x+23,y-2,3,5);
      } else if (t===PLATFORM){
        ctx.fillStyle = pal.plat;
        roundRect(x+1,y+8,TILE-2,12,5); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(x+4,y+10,TILE-8,3);
      } else if (t===SPIKE){
        ctx.fillStyle = "#c94444";
        ctx.beginPath();
        ctx.moveTo(x+2,y+TILE); ctx.lineTo(x+TILE/2,y+6); ctx.lineTo(x+TILE-2,y+TILE); ctx.fill();
        ctx.fillStyle = "rgba(255,200,200,.35)";
        ctx.beginPath();
        ctx.moveTo(x+TILE/2,y+6); ctx.lineTo(x+TILE/2+4,y+TILE); ctx.lineTo(x+TILE/2,y+TILE); ctx.fill();
      } else if (t===SPRING){
        ctx.fillStyle = "#ffd93d"; roundRect(x+6,y+14,TILE-12,16,4); ctx.fill();
        ctx.fillStyle = "#ff6b9d"; ctx.fillRect(x+8,y+12,TILE-16,6);
      } else if (t===COIN && !coinTaken[r][c]){
        const bob = Math.sin(gt*0.2 + c)*2;
        ctx.fillStyle = "#ffd93d";
        ctx.beginPath(); ctx.ellipse(x+16,y+16+bob,7,9,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = "#fff6c0"; ctx.fillRect(x+14,y+10+bob,3,8);
      } else if (t===MEM){
        const pulse = 1 + Math.sin(gt*0.14)*0.1;
        const mem = MEMORIES[currentLevel];
        ctx.save();
        ctx.translate(x+16,y+14); ctx.scale(pulse,pulse);
        ctx.fillStyle = "rgba(224,168,92,.3)";
        ctx.beginPath(); ctx.arc(0,0,20,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = "#e0a85c";
        ctx.beginPath(); ctx.arc(0,0,11,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "13px Georgia,serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(mem && mem.skin==="vhs" ? "▶" : "★", 0, 1);
        ctx.restore();
      } else if (t===EXIT){
        const unlocked = exitOpen;
        const pulse = unlocked ? (1 + Math.sin(gt*0.18)*0.12) : 1;
        ctx.save();
        ctx.translate(x+16,y+14); ctx.scale(pulse,pulse);
        ctx.fillStyle = unlocked ? "rgba(255,210,100,.35)" : "rgba(80,90,110,.25)";
        ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill();
        // door shape
        ctx.fillStyle = unlocked ? "#e8b45a" : "#6a7080";
        roundRect(-10,-16,20,28,4); ctx.fill();
        ctx.fillStyle = unlocked ? "#fff3c0" : "#9aa0b0";
        roundRect(-6,-12,12,12,2); ctx.fill();
        if (unlocked) {
          ctx.fillStyle = "#fff";
          ctx.font = "11px Georgia,serif";
          ctx.textAlign = "center";
          ctx.fillText("→", 0, 20);
        }
        ctx.restore();
      }
    }
  }

  // movers
  const pal2 = palettes[LEVELS[currentLevel].palette||0];
  for (const m of movers) {
    ctx.fillStyle = pal2.plat;
    roundRect(m.px, m.py+4, m.w*TILE, 12, 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillRect(m.px+4, m.py+6, m.w*TILE-8, 3);
  }
}

function spriteFrame(pack, moving, air){
  if (air) return pack.jump;
  if (moving) return ((gt>>3)&1) ? pack.walk : pack.idle;
  // idle bob alternate
  return ((gt>>5)&1) ? pack.idle : pack.walk;
}

function drawActor(pack, x, y, facing, moving, air, scale){
  const im = spriteFrame(pack, moving, air);
  const bob = (!air && !moving) ? Math.sin(gt*0.12)*1.2 : 0;
  const drawH = 48 * scale;
  const drawW = (im && im.complete && im.naturalWidth)
    ? (im.naturalWidth/im.naturalHeight)*drawH : 22*scale;
  ctx.save();
  ctx.translate(x, y + bob);
  if (facing===-1) ctx.scale(-1,1);
  ctx.fillStyle="rgba(0,0,0,.18)";
  ctx.beginPath(); ctx.ellipse(0, player.h/2+2, drawW*0.34, 3.2, 0,0,Math.PI*2); ctx.fill();
  if (im && im.complete && im.naturalWidth){
    ctx.drawImage(im, -drawW/2, -drawH/2, drawW, drawH);
  } else {
    ctx.fillStyle="#444"; ctx.fillRect(-8,-16,16,32);
  }
  ctx.restore();
}

function drawHug(cx, cy){
  const im = img.hug;
  const drawH = 60;
  const drawW = (im && im.complete && im.naturalWidth)
    ? (im.naturalWidth/im.naturalHeight)*drawH : 80;
  const pulse = 1 + Math.sin(gt*0.25)*0.04;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(pulse,pulse);
  ctx.fillStyle="rgba(0,0,0,.14)";
  ctx.beginPath(); ctx.ellipse(0, 18, drawW*0.4, 3.2, 0,0,Math.PI*2); ctx.fill();
  if (im && im.complete && im.naturalWidth) ctx.drawImage(im, -drawW/2, -drawH/2, drawW, drawH);
  ctx.restore();
}

function drawCharacters(){
  if (gt < hugUntil) {
    drawHug(player.x+player.w/2, player.y+player.h/2);
    return;
  }
  const moving = Math.abs(player.vx)>0.4;
  const air = !player.onGround;
  drawActor(img.tara, player.x+player.w/2, player.y+player.h/2, player.facing, moving, air, 1.15);
  drawActor(img.sara, buddy.x, buddy.y+player.h/2, buddy.facing, moving, air && Math.abs(player.vy)>2, 0.95);
}

function drawParticles(){
  particles = particles.filter(p => {
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=0.04;
    if (p.life<=0) return false;
    ctx.globalAlpha=p.life; ctx.fillStyle=p.col;
    ctx.fillRect(p.x, p.y, 3, 3); ctx.globalAlpha=1;
    return true;
  });
}

function drawCakeScene(){
  // soft celebration confetti behind overlay
  for (let i=0;i<24;i++){
    const x = (i*37 + gt*1.4) % W;
    const y = (i*53 + gt*2.1) % H;
    ctx.fillStyle = ["#FF6B9D","#FFD93D","#6BCB77","#4D96FF","#FF9F43"][i%5];
    ctx.fillRect(x, y, 4, 6);
  }
}

function frame(){
  gt++;
  if (fade > 0) fade = Math.max(0, fade - 0.04);
  if (roomFlash > 0) {
    roomFlash--;
    if (roomFlash === 0 && roomBanner) roomBanner.classList.add("hidden");
  }

  if (gameState==="playing") movePlayer();

  ctx.save();
  if (screenShake>0){
    ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
    screenShake *= 0.85; if (screenShake<0.4) screenShake=0;
  }

  if (!ready || !LEVELS.length) {
    ctx.fillStyle="#87CEEB"; ctx.fillRect(0,0,W,H);
  } else if (gameState==="win") {
    drawBG();
    drawCakeScene();
  } else if (gameState==="playing" || gameState==="memory") {
    drawBG();
    drawTiles();
    drawCharacters();
    drawParticles();
  } else {
    drawBG();
  }
  ctx.restore();

  const vg = ctx.createRadialGradient(W/2,H/2,H*0.32,W/2,H/2,H*0.78);
  vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(10,30,50,.22)");
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

  if (fade > 0) {
    ctx.fillStyle = `rgba(12,18,22,${fade})`;
    ctx.fillRect(0,0,W,H);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__debug = () => ({x:player.x,y:player.y,vx:player.vx,state:gameState,level:currentLevel+1,memTaken,exitOpen,collected:collected.size});
window.TARA31 = {
  get ready(){ return ready; },
  memories: () => MEMORIES,
  state: () => ({
    ready, gameState, level: currentLevel+1, memTaken, exitOpen,
    collected: collected.size, x: player.x, y: player.y, vx: player.vx,
    modalOn: memEl.classList.contains("on"),
  }),
  start: () => {
    if (!ready) return false;
    gateEl.classList.add("hidden");
    titleEl.classList.add("hidden");
    if (cakeEl) cakeEl.classList.add("hidden");
    collected = new Set();
    startLevel(0);
    gameState = "playing";
    updateHUD();
    startMusic();
    return true;
  },
  openMemory: () => { if (gameState==="playing" && !memTaken) openMemoryForLevel(currentLevel); },
  next: () => { if (gameState==="memory") closeMemory(true); },
  goDoor: () => { if (gameState==="playing" && exitOpen) goNextRoom(); },
};
})();
