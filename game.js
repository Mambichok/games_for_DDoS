const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const timeValue = document.getElementById("timeValue");
const livesContainer = document.getElementById("livesContainer");
const overlay = document.getElementById("overlay");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const restartBtn = document.getElementById("restartBtn");
const logo = document.getElementById("logo");

const GAME_TIME_SECONDS = 120;
const MAX_LIVES = 3;

const assetPaths = {
  heart: "./assets/heart.png",
  forbidden: "./assets/forbidden.png",
  fruits: [
    "./assets/fruit-1.png",
    "./assets/fruit-2.png",
    "./assets/fruit-3.png",
    "./assets/fruit-4.png"
  ]
};

let game;
let pointerPath = [];
let pointerDown = false;
let animationFrameId = 0;

class FlyingItem {
  constructor({ x, y, vx, vy, image, forbidden = false, radius = 42 }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.image = image;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() * 2.1 + 0.8) * (Math.random() > 0.5 ? 1 : -1);
    this.forbidden = forbidden;
    this.sliced = false;
    this.scored = false;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function setupLives() {
  livesContainer.innerHTML = "";
  for (let i = 0; i < MAX_LIVES; i += 1) {
    const heart = document.createElement("img");
    heart.className = "heart";
    heart.alt = "heart";
    heart.src = assetPaths.heart;
    heart.onerror = () => {
      heart.onerror = null;
      heart.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 24 24'%3E%3Cpath fill='%23ff4d6d' d='m12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z'/%3E%3C/svg%3E";
    };
    livesContainer.appendChild(heart);
  }
}

function updateLivesView() {
  const hearts = livesContainer.querySelectorAll(".heart");
  hearts.forEach((heart, index) => {
    heart.classList.toggle("lost", index >= game.lives);
  });
}

function updateTimeView() {
  const minutes = Math.floor(game.timeLeft / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (game.timeLeft % 60).toString().padStart(2, "0");
  timeValue.textContent = `${minutes}:${seconds}`;
}

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function spawnItem() {
  const forbiddenChance = 0.2;
  const isForbidden = Math.random() < forbiddenChance;
  const launchFromLeft = Math.random() < 0.5;
  const margin = 50;
  const startX = launchFromLeft ? -margin : window.innerWidth + margin;
  const startY = randomRange(window.innerHeight * 0.62, window.innerHeight * 0.94);

  const vx = launchFromLeft ? randomRange(120, 240) : randomRange(-240, -120);
  const vy = randomRange(-1140, -880);
  const radius = randomRange(32, 46);
  const image = isForbidden
    ? game.images.forbidden
    : game.images.fruits[Math.floor(Math.random() * game.images.fruits.length)];

  game.items.push(
    new FlyingItem({
      x: startX,
      y: startY,
      vx,
      vy,
      radius,
      image,
      forbidden: isForbidden
    })
  );
}

function segmentHitsCircle(p1, p2, cx, cy, radius) {
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    return false;
  }

  let t = ((cx - p1.x) * vx + (cy - p1.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = p1.x + t * vx;
  const py = p1.y + t * vy;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy <= radius * radius;
}

function addScore(points) {
  game.score += points;
}

function loseLife() {
  if (game.finished) {
    return;
  }
  game.lives -= 1;
  updateLivesView();

  if (game.lives <= 0) {
    finishGame("Жизни закончились");
  }
}

function finishGame(reason) {
  if (game.finished) {
    return;
  }
  game.finished = true;
  overlay.classList.remove("hidden");
  resultTitle.textContent = reason;
  resultText.textContent = `Счет: ${game.score}`;
}

function processSlices() {
  if (pointerPath.length < 2 || game.finished) {
    return;
  }

  for (let i = 1; i < pointerPath.length; i += 1) {
    const prev = pointerPath[i - 1];
    const curr = pointerPath[i];

    for (const item of game.items) {
      if (item.sliced) {
        continue;
      }
      if (segmentHitsCircle(prev, curr, item.x, item.y, item.radius * 0.9)) {
        item.sliced = true;
        if (item.forbidden) {
          loseLife();
        } else {
          addScore(10);
        }
      }
    }
  }
}

function drawItem(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.rotation);

  if (item.image) {
    const size = item.radius * 2.2;
    ctx.drawImage(item.image, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = item.forbidden ? "#fc3c49" : "#52e26f";
    ctx.beginPath();
    ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (item.sliced) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, item.radius * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPointerTrail() {
  if (pointerPath.length < 2) {
    return;
  }
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(174, 240, 255, 0.9)";
  ctx.shadowColor = "rgba(174, 240, 255, 0.75)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pointerPath[0].x, pointerPath[0].y);
  for (let i = 1; i < pointerPath.length; i += 1) {
    ctx.lineTo(pointerPath[i].x, pointerPath[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function updateFrame(nowMs) {
  if (!game) {
    return;
  }
  if (!game.lastTick) {
    game.lastTick = nowMs;
    animationFrameId = requestAnimationFrame(updateFrame);
    return;
  }

  const dt = Math.min((nowMs - game.lastTick) / 1000, 0.05);
  game.lastTick = nowMs;
  game.spawnAccumulator += dt;
  game.timeAccumulator += dt;

  if (!game.finished) {
    const spawnEvery = Math.max(0.25, 0.9 - game.score * 0.0012);
    while (game.spawnAccumulator >= spawnEvery) {
      game.spawnAccumulator -= spawnEvery;
      spawnItem();
    }

    while (game.timeAccumulator >= 1) {
      game.timeAccumulator -= 1;
      game.timeLeft -= 1;
      updateTimeView();
      if (game.timeLeft <= 0) {
        finishGame("Время вышло");
      }
    }
  }

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  processSlices();

  const gravity = 1750;
  for (const item of game.items) {
    item.vy += gravity * dt;
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.rotation += item.rotationSpeed * dt;
    drawItem(item);
  }

  for (const item of game.items) {
    if (!item.scored && !item.sliced && !item.forbidden && item.y - item.radius > window.innerHeight + 22) {
      item.scored = true;
      loseLife();
    }
  }

  game.items = game.items.filter((item) => item.y - item.radius <= window.innerHeight + 80 && item.x > -150 && item.x < window.innerWidth + 150 && !item.sliced);

  if (!pointerDown && pointerPath.length > 0) {
    pointerPath.shift();
  }
  if (pointerPath.length > 12) {
    pointerPath.splice(0, pointerPath.length - 12);
  }
  drawPointerTrail();

  animationFrameId = requestAnimationFrame(updateFrame);
}

function pointerToCanvasPoint(event) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function onPointerDown(event) {
  if (game.finished) {
    return;
  }
  pointerDown = true;
  pointerPath = [pointerToCanvasPoint(event)];
}

function onPointerMove(event) {
  if (!pointerDown || game.finished) {
    return;
  }
  pointerPath.push(pointerToCanvasPoint(event));
}

function onPointerUp() {
  pointerDown = false;
}

async function buildGame() {
  fitCanvas();
  setupLives();

  const [forbidden, ...fruits] = await Promise.all([
    loadImage(assetPaths.forbidden),
    ...assetPaths.fruits.map(loadImage)
  ]);

  game = {
    score: 0,
    lives: MAX_LIVES,
    timeLeft: GAME_TIME_SECONDS,
    items: [],
    spawnAccumulator: 0,
    timeAccumulator: 0,
    lastTick: 0,
    finished: false,
    images: {
      forbidden,
      fruits
    }
  };

  updateLivesView();
  updateTimeView();
  animationFrameId = requestAnimationFrame(updateFrame);
}

function restartGame() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  overlay.classList.add("hidden");
  pointerPath = [];
  pointerDown = false;
  buildGame();
}

restartBtn.addEventListener("click", restartGame);
window.addEventListener("resize", fitCanvas);
window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
window.addEventListener("contextmenu", (event) => event.preventDefault());

logo.onerror = () => {
  logo.onerror = null;
  logo.src =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='160' viewBox='0 0 420 160'%3E%3Crect width='420' height='160' rx='20' fill='%230e1630'/%3E%3Ctext x='210' y='95' fill='white' font-size='46' text-anchor='middle' font-family='Arial'%3EDDoS Ninja%3C/text%3E%3C/svg%3E";
};

buildGame();
