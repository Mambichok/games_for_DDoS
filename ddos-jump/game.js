(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const overlay = document.getElementById("overlay");
  const btnStart = document.getElementById("btnStart");
  const msg = document.getElementById("msg");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const killsEl = document.getElementById("kills");

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const DPR = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  // Sprites (optional). If images are missing, the game falls back to primitives.
  const ASSET_PLAYER_SRC = "./assets/player.png";
  const ASSET_PLAYER_SHOOT_SRC = "./assets/player_shoot.png";
  const ASSET_PLATFORM_SRC = "./assets/platform.png";
  const ASSET_ENEMY_FALLBACK_SRC = "./assets/enemy.png";
  const ASSET_ENEMY_KIND_SRCS = [
    "./assets/enemy0.png",
    "./assets/enemy1.png",
    "./assets/enemy2.png",
    "./assets/enemy3.png",
    "./assets/enemy4.png",
  ];
  const ASSET_BULLET_SRC = "./assets/bullet.png";
  const assets = {
    player: null,
    playerShoot: null,
    platform: null,
    enemyFallback: null,
    enemies: new Array(5).fill(null),
    bullet: null,
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  Promise.all([
    loadImage(ASSET_PLAYER_SRC),
    loadImage(ASSET_PLAYER_SHOOT_SRC),
    loadImage(ASSET_PLATFORM_SRC),
    loadImage(ASSET_BULLET_SRC),
    loadImage(ASSET_ENEMY_FALLBACK_SRC),
    ...ASSET_ENEMY_KIND_SRCS.map((src) => loadImage(src)),
  ]).then(([playerImg, playerShootImg, platformImg, bulletImg, enemyFallbackImg, ...enemyKindImgs]) => {
    assets.player = playerImg;
    assets.playerShoot = playerShootImg;
    assets.platform = platformImg;
    assets.bullet = bulletImg;
    assets.enemyFallback = enemyFallbackImg;
    for (let i = 0; i < 5; i++) {
      assets.enemies[i] = enemyKindImgs[i] ?? null;
    }
  });

  function resizeForDpr() {
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  resizeForDpr();
  window.addEventListener("resize", resizeForDpr);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);

  const STORAGE_KEY = "doodle_jump_best_v1";
  const getBest = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
  const setBest = (v) => localStorage.setItem(STORAGE_KEY, String(v));

  let best = getBest();
  bestEl.textContent = String(best);

  // Input
  const input = {
    left: false,
    right: false,
    pointerDir: 0, // -1 left, +1 right
    pointerActive: false,
    tiltEnabled: false,
    tiltDir: 0, // -1..+1
  };

  function setKeys(e, down) {
    const key = e.key.toLowerCase();
    if (key === "arrowleft" || key === "a") {
      input.left = down;
      e.preventDefault();
    } else if (key === "arrowright" || key === "d") {
      input.right = down;
      e.preventDefault();
    }
  }

  // Phone movement (original-style): horizontal movement based on device tilt.
  window.addEventListener("deviceorientation", (e) => {
    // gamma: left-to-right tilt in degrees (-90..90 usually)
    if (typeof e.gamma !== "number") return;
    input.tiltEnabled = true;
    const g = e.gamma;
    const raw = g / 25; // tune sensitivity
    const dir = Math.abs(raw) < 0.06 ? 0 : clamp(raw, -1, 1);
    input.tiltDir = dir;
  });

  window.addEventListener(
    "keydown",
    (e) => {
      setKeys(e, true);
      if (e.code === "Space") {
        e.preventDefault();
        tryShoot();
      }
      if (e.key === "Enter" && !state.running) {
        startGame();
      }
    },
    { passive: false }
  );
  window.addEventListener("keyup", (e) => setKeys(e, false), { passive: false });

  // Mobile-friendly pointer control
  canvas.addEventListener("pointerdown", (e) => {
    // Touch: shoot to the point you tapped (converted to world coords).
    if (e.pointerType === "touch") {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const tx = (x / rect.width) * W;
      const ty = (y / rect.height) * H + world.cameraY;
      tryShootAt(tx, ty);
      return;
    }

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    input.pointerActive = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    input.pointerDir = x < rect.width / 2 ? -1 : 1;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!input.pointerActive) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    input.pointerDir = x < rect.width / 2 ? -1 : 1;
  });
  const endPointer = () => {
    input.pointerActive = false;
    input.pointerDir = 0;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // Game state
  const physics = {
    gravity: 2400, // px/s^2 (world)
    moveAccel: 2600, // px/s^2
    moveFriction: 0.85, // multiplier when no input
    maxMoveSpeed: 520, // px/s
    jumpBase: 950, // px/s (up => negative vy)
    jumpGrowth: 0.18, // scales with score
  };

  const world = {
    cameraY: 0,
    platforms: [],
    enemies: [],
    bullets: [],
    explosions: [],
    player: null,
    startedAt: 0,
    cameraStart: 0,
    score: 0,
    kills: 0,
    lastShotAt: 0,
    shake: 0,
  };

  const state = {
    running: false,
    gameOver: false,
    lastT: 0,
    rafId: 0,
  };

  function roundedRect(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function makePlatform(x, y, w, type) {
    if (type === "moving") {
      return {
        x,
        baseX: x,
        y,
        w,
        type,
        amp: rand(30, 70),
        speed: rand(0.0017, 0.0035), // radians per ms-ish
        phase: rand(0, Math.PI * 2),
      };
    }
    return { x, y, w, type: "static" };
  }

  function resetWorld() {
    world.cameraY = 0;
    world.platforms = [];
    world.enemies = [];
    world.bullets = [];
    world.explosions = [];
    world.score = 0;
    world.kills = 0;
    world.lastShotAt = 0;
    world.shake = 0;

    const baseY = H - 90;
    const baseW = 170;
    const baseX = W / 2 - baseW / 2;

    world.platforms.push(makePlatform(baseX, baseY, baseW, "static"));

    world.player = {
      x: baseX + baseW / 2 - 14,
      y: baseY - 28 - 1,
      w: 28,
      h: 28,
      vx: 0,
      vy: 0,
      landCooldown: 0,
      isShootingUntil: 0,
    };

    // Seed platforms above.
    let minPlat = { y: baseY, x: baseX + baseW / 2 };
    for (let i = 0; i < 16; i++) {
      const gap = rand(80, 125);
      const y = minPlat.y - gap;
      const w = rand(90, 160);
      const maxShift = 160;
      const x = clamp(minPlat.x + rand(-maxShift, maxShift), 10, W - w - 10);
      const type = Math.random() < 0.18 ? "moving" : "static";
      const p = makePlatform(x, y, w, type);
      world.platforms.push(p);
      minPlat = { y, x: x + w / 2 };
    }

    // Spawn 5 stationary enemies on top of already generated platforms.
    // They are targets for your upward shots (touching them doesn't kill you).
    const enemyW = 32;
    const enemyH = 32;
    const candidates = world.platforms
      .slice(1) // skip starting platform
      .sort((a, b) => a.y - b.y) // higher platforms first (smaller y)
      .slice(0, 5);

    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const kind = i;
      const ex = clamp(p.x + p.w / 2 - enemyW / 2, 8, W - enemyW - 8);
      const ey = p.y - enemyH + 0.5; // stand on platform
      world.enemies.push({
        x: ex,
        y: ey,
        w: enemyW,
        h: enemyH,
        kind,
        alive: true,
      });
    }
  }

  function ensurePlatforms(timeNow) {
    // Move moving platforms.
    for (const p of world.platforms) {
      if (p.type === "moving") {
        p.x = p.baseX + Math.sin(timeNow * p.speed + p.phase) * p.amp;
      }
    }

    // Remove platforms far below.
    world.platforms = world.platforms.filter((p) => p.y - world.cameraY < H + 160);

    // Spawn platforms above current highest "top of world".
    const desiredMinY = world.cameraY - H * 2.3;
    while (true) {
      let minP = null;
      for (const p of world.platforms) {
        if (!minP || p.y < minP.y) minP = p;
      }
      if (!minP) break;
      if (minP.y <= desiredMinY) break;

      const gap = rand(84, 130);
      let newY = minP.y - gap;

      const scoreBoost = Math.min(1, world.score / 1800);
      const maxShift = 170 + 90 * scoreBoost;
      const w = rand(80, 155) - 25 * scoreBoost;

      const shift = rand(-maxShift, maxShift);
      const targetX = minP.x + minP.w / 2 + shift;
      const newX = clamp(targetX - w / 2, 10, W - w - 10);

      // Slightly reduce moving chance as it gets harder.
      const movingChance = 0.22 - 0.1 * scoreBoost;
      const type = Math.random() < movingChance ? "moving" : "static";
      const p = makePlatform(newX, newY, w, type);
      world.platforms.push(p);
    }
  }

  function bounceFromPlatform(plat) {
    const scoreBoost = Math.min(1.5, world.score / 2500);
    const jumpPower = physics.jumpBase + physics.jumpGrowth * physics.jumpBase * scoreBoost;
    world.player.vy = -jumpPower;
    world.player.y = plat.y - world.player.h - 0.5; // place on top
    world.player.landCooldown = 0.08;
    world.shake = 0.9;
  }

  function doCollision() {
    const pl = world.player;
    if (pl.landCooldown > 0) return;
    if (pl.vy <= 0) return; // only when falling

    const playerBottom = pl.y + pl.h;
    const tol = 10;

    for (const p of world.platforms) {
      if (playerBottom < p.y - 2) continue; // above
      if (playerBottom > p.y + tol) continue; // too far past
      if (pl.x + pl.w <= p.x + 4) continue;
      if (pl.x >= p.x + p.w - 4) continue;

      bounceFromPlatform(p);
      return;
    }
  }

  function startGame() {
    resetWorld();
    killsEl.textContent = "0";
    world.playerStartY = world.player.y; // scoring anchor (world coordinates)
    world.startedAt = performance.now();
    world.cameraStart = world.cameraY;
    world.player.vy = -420;
    world.player.vx = 0;
    world.player.landCooldown = 0;
    state.running = true;
    state.gameOver = false;
    state.lastT = performance.now();
    msg.textContent = "";
    overlay.classList.add("is-hidden");
    scoreEl.textContent = "0";
    loop();
  }

  function endGame() {
    state.running = false;
    state.gameOver = true;
    overlay.classList.remove("is-hidden");
    msg.textContent = "Game over. Press Enter or Start again.";

    if (world.score > best) {
      best = world.score;
      setBest(best);
      bestEl.textContent = String(best);
    }
  }

  btnStart.addEventListener("click", startGame);

  const shoot = {
    cooldownMs: 280,
    speed: 980,
    bulletR: 4,
  };

  function tryShootAt(targetX, targetY) {
    if (!state.running || state.gameOver) return;
    const pl = world.player;
    let tx = targetX;
    let ty = targetY;

    // Change player sprite briefly during shooting.
    // "Only above the hero" constraint.
    if (ty >= pl.y) return;

    const now = performance.now();
    if (now - world.lastShotAt < shoot.cooldownMs) return;
    world.lastShotAt = now;
    pl.isShootingUntil = now + 140;

    const bx = pl.x + pl.w / 2;
    const by = pl.y + pl.h * 0.35;

    let dx = tx - bx;
    let dy = ty - by;
    // Ensure upward trajectory.
    if (dy >= -1) dy = -1;

    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * shoot.speed;
    const vy = (dy / len) * shoot.speed;

    world.bullets.push({
      x: bx,
      y: by,
      r: shoot.bulletR,
      vx,
      vy,
    });
  }

  function tryShoot() {
    const pl = world.player;
    tryShootAt(pl.x + pl.w / 2, pl.y - 240);
  }

  function drawBackground(timeNow) {
    // Simple gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0c1634");
    g.addColorStop(1, "#050a18");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stars (cheap, seeded-ish)
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 60; i++) {
      const sx = (i * 97.3 + timeNow * 0.015) % W;
      const sy = (i * 61.7 + Math.sin(i + timeNow * 0.001) * 20 + world.cameraY * 0.05) % H;
      const y = sy < 0 ? sy + H : sy;
      ctx.fillRect(sx, y, 1, 2);
    }
    ctx.globalAlpha = 1;

    // Subtle scan line
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, W, 1);
    ctx.globalAlpha = 1;
  }

  function drawGrid() {
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + (world.cameraY % 40));
      ctx.lineTo(W, y + (world.cameraY % 40));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlatforms(timeNow) {
    for (const p of world.platforms) {
      const sx = p.x;
      const sy = p.y - world.cameraY;
      if (sy < -70 || sy > H + 80) continue;

      if (assets.platform) {
        ctx.drawImage(assets.platform, sx, sy, p.w, 14);
      } else {
        if (p.type === "moving") {
          ctx.fillStyle = "rgba(160, 220, 255, 0.35)";
          ctx.strokeStyle = "rgba(120, 200, 255, 0.55)";
        } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.33)";
        }

        const r = 12;
        roundedRect(sx, sy, p.w, 14, r);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (p.type === "moving") {
        // Small indicator line
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.beginPath();
        ctx.moveTo(sx + 12, sy + 7);
        ctx.lineTo(sx + p.w - 12, sy + 7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawPlayer() {
    const pl = world.player;
    const sx = pl.x;
    const sy = pl.y - world.cameraY;

    // Camera shake on bounce
    const shake = world.shake;
    if (shake > 0.001) {
      const ax = (Math.random() * 2 - 1) * 3 * shake;
      const ay = (Math.random() * 2 - 1) * 3 * shake;
      ctx.save();
      ctx.translate(ax, ay);
      drawPlayerCore(sx, sy);
      ctx.restore();
    } else {
      drawPlayerCore(sx, sy);
    }
  }

  function drawPlayerCore(sx, sy) {
    const pl = world.player;
    const now = performance.now();
    // During shooting we optionally swap to a different sprite.
    if (pl.isShootingUntil > now && assets.playerShoot) {
      ctx.drawImage(assets.playerShoot, sx, sy, pl.w, pl.h);
      return;
    }
    if (assets.player) {
      ctx.drawImage(assets.player, sx, sy, pl.w, pl.h);
      return;
    }
    // Body
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(50, 70, 120, 0.55)";
    roundedRect(sx, sy, pl.w, pl.h, 11);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face
    const eyeY = sy + 11;
    const eyeL = sx + 10;
    const eyeR = sx + pl.w - 10;
    ctx.fillStyle = "rgba(8, 14, 30, 0.95)";
    ctx.beginPath();
    ctx.arc(eyeL, eyeY, 3.3, 0, Math.PI * 2);
    ctx.arc(eyeR, eyeY, 3.3, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = "rgba(8, 14, 30, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 11, sy + 19);
    ctx.lineTo(sx + pl.w - 11, sy + 19);
    ctx.stroke();
  }

  function drawEnemies() {
    for (const en of world.enemies) {
      if (!en.alive) continue;
      const sx = en.x;
      const sy = en.y - world.cameraY;
      if (sy < -120 || sy > H + 120) continue;

      const kindImg = (assets.enemies && assets.enemies[en.kind]) || assets.enemyFallback;
      if (kindImg) {
        ctx.drawImage(kindImg, sx, sy, en.w, en.h);
        continue;
      }

      const palette = [
        ["rgba(255, 110, 110, 0.35)", "rgba(255, 110, 110, 0.65)"],
        ["rgba(255, 220, 120, 0.25)", "rgba(255, 220, 120, 0.60)"],
        ["rgba(160, 255, 180, 0.22)", "rgba(110, 235, 160, 0.60)"],
        ["rgba(165, 170, 255, 0.22)", "rgba(120, 120, 255, 0.60)"],
        ["rgba(255, 160, 240, 0.20)", "rgba(235, 120, 220, 0.58)"],
      ];
      const [fill, stroke] = palette[en.kind % palette.length];
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      roundedRect(sx, sy, en.w, en.h, 12);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      // Tiny face indicator (fallback only)
      ctx.fillStyle = "rgba(10, 18, 40, 0.85)";
      ctx.beginPath();
      ctx.arc(sx + en.w * 0.35, sy + en.h * 0.45, 3, 0, Math.PI * 2);
      ctx.arc(sx + en.w * 0.65, sy + en.h * 0.45, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBullets() {
    for (const b of world.bullets) {
      const sx = b.x;
      const sy = b.y - world.cameraY;
      if (sy < -60 || sy > H + 60) continue;

      if (assets.bullet) {
        ctx.drawImage(assets.bullet, sx - b.r, sy - b.r, b.r * 2, b.r * 2);
        continue;
      }

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.strokeStyle = "rgba(90, 190, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function spawnExplosion(x, y, now) {
    // Simple particle explosion (drawn in screen space in drawExplosions()).
    const particles = [];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(140, 480);
      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp;
      const ttl = rand(0.22, 0.55);
      particles.push({
        x,
        y,
        vx,
        vy,
        size: rand(2.2, 5.0),
        ttl,
        ttl0: ttl,
      });
    }
    world.explosions.push({ t0: now, particles });
  }

  function updateExplosions(dt) {
    for (let i = world.explosions.length - 1; i >= 0; i--) {
      const ex = world.explosions[i];
      let anyAlive = false;
      for (const p of ex.particles) {
        p.ttl -= dt;
        if (p.ttl <= 0) continue;
        anyAlive = true;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 980 * dt; // gravity-ish for a nicer arc
      }
      if (!anyAlive) world.explosions.splice(i, 1);
    }
  }

  function drawExplosions() {
    for (const ex of world.explosions) {
      for (const p of ex.particles) {
        if (p.ttl <= 0) continue;
        const a = p.ttl / p.ttl0;
        const sx = p.x;
        const sy = p.y - world.cameraY;
        if (sy < -120 || sy > H + 120) continue;

        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.fillStyle = "rgba(255, 170, 70, 1)";
        ctx.strokeStyle = "rgba(255, 240, 180, 1)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (0.35 + a), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // A small ember dot
        ctx.fillStyle = "rgba(255, 90, 60, 1)";
        ctx.beginPath();
        ctx.arc(sx + p.size * 0.15, sy - p.size * 0.15, p.size * 0.25 * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function loop() {
    if (!state.running) return;

    const t = performance.now();
    const dt = Math.min(0.033, (t - state.lastT) / 1000);
    state.lastT = t;

    const pl = world.player;

    // Update input direction
    let dir = 0;
    if (input.tiltEnabled) {
      dir = input.tiltDir;
    } else {
      if (input.left) dir -= 1;
      if (input.right) dir += 1;
      if (input.pointerActive) dir = input.pointerDir;
    }

    // Horizontal physics
    if (dir !== 0) {
      pl.vx += dir * physics.moveAccel * dt;
    } else {
      pl.vx *= Math.pow(physics.moveFriction, dt * 60);
    }
    pl.vx = clamp(pl.vx, -physics.maxMoveSpeed, physics.maxMoveSpeed);
    pl.x += pl.vx * dt;
    if (pl.x < -5) pl.x = -5;
    if (pl.x + pl.w > W + 5) pl.x = W + 5 - pl.w;

    // Gravity & vertical
    pl.vy += physics.gravity * dt;
    pl.y += pl.vy * dt;

    // Landing cooldown
    if (pl.landCooldown > 0) pl.landCooldown = Math.max(0, pl.landCooldown - dt);

    // Camera follow
    const playerScreenY = pl.y - world.cameraY;
    const followY = H * 0.42;
    if (playerScreenY < followY) {
      world.cameraY = pl.y - followY;
    }

    // Score based on height reached (up => smaller y)
    const rawScore = Math.floor((world.playerStartY - pl.y) / 10);
    if (rawScore !== world.score) world.score = rawScore;
    scoreEl.textContent = String(world.score);

    // Ensure/animate platforms
    ensurePlatforms(t);

    // Update bullets & handle hits
    for (let i = world.bullets.length - 1; i >= 0; i--) {
      const b = world.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      const sy = b.y - world.cameraY;

      // Remove bullets that are far out of view.
      if (sy < -120 || sy > H + 220) {
        world.bullets.splice(i, 1);
        continue;
      }

      // Bullet hits enemies (point-in-rect using bullet center)
      let hit = false;
      for (const en of world.enemies) {
        if (!en.alive) continue;
        if (b.x < en.x || b.x > en.x + en.w) continue;
        if (b.y < en.y || b.y > en.y + en.h) continue;

        en.alive = false;
        world.kills += 1;
        killsEl.textContent = String(world.kills);
        spawnExplosion(en.x + en.w / 2, en.y + en.h / 2, t);
        hit = true;
        break;
      }

      if (hit) world.bullets.splice(i, 1);
    }

    updateExplosions(dt);

    // Player-enemy collision: touching enemies kills instantly.
    for (const en of world.enemies) {
      if (!en.alive) continue;
      const touches =
        pl.x <= en.x + en.w &&
        pl.x + pl.w >= en.x &&
        pl.y <= en.y + en.h &&
        pl.y + pl.h >= en.y;
      if (touches) {
        endGame();
        return;
      }
    }

    // Collisions
    doCollision();

    // Fell off
    const playerScreenBottom = pl.y - world.cameraY + pl.h;
    if (playerScreenBottom > H + 150) {
      endGame();
      return;
    }

    // Render
    ctx.save();
    world.shake = Math.max(0, world.shake - dt * 3.2);
    drawBackground(t);
    drawGrid();
    drawPlatforms(t);
    drawEnemies();
    drawExplosions();
    drawBullets();
    drawPlayer();
    ctx.restore();

    state.rafId = requestAnimationFrame(loop);
  }

  // Initial setup (not running)
  resetWorld();
  world.playerStartY = world.player.y;
  state.running = false;
  state.gameOver = false;

  overlay.classList.remove("is-hidden");
  btnStart.textContent = "Start";
  scoreEl.textContent = "0";
  killsEl.textContent = "0";
  bestEl.textContent = String(best);
})();

