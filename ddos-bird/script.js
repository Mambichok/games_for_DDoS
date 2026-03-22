const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
const overlayEl = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");

const GAME_TIME_SECONDS = 120;
const PIPE_SPAWN_MS = 1400;

const assets = {
  background: loadImage("./assets/background.svg"),
  bird: loadImage("./assets/bird.svg"),
  pipeRed: loadImage("./assets/pipe-red.svg"),
  pipeGreen: loadImage("./assets/pipe-green.svg")
};

const state = {
  running: false,
  ended: false,
  score: 0,
  timeLeft: GAME_TIME_SECONDS,
  bird: {
    x: 120,
    y: 200,
    radius: 18,
    velocityY: 0
  },
  pipes: [],
  spawnAccumulator: 0
};

let gravity = 1300;
let flapVelocity = -420;
let pipeSpeed = 170;
let pipeGap = 180;
let pipeWidth = 82;
let lastTime = 0;

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

function fitCanvas() {
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const minSizeFactor = Math.min(window.innerWidth / 430, window.innerHeight / 900);
  gravity = 1300 * Math.max(0.82, minSizeFactor + 0.15);
  flapVelocity = -420 * Math.max(0.9, minSizeFactor + 0.2);
  pipeSpeed = 170 * Math.max(0.9, minSizeFactor + 0.1);
  pipeGap = Math.max(145, Math.min(220, window.innerHeight * 0.25));
  pipeWidth = Math.max(60, Math.min(96, window.innerWidth * 0.15));

  if (!state.running) {
    state.bird.x = Math.max(90, window.innerWidth * 0.3);
    state.bird.y = window.innerHeight * 0.45;
  }
}

function resetGame() {
  state.running = true;
  state.ended = false;
  state.score = 0;
  state.timeLeft = GAME_TIME_SECONDS;
  state.bird.x = Math.max(90, window.innerWidth * 0.3);
  state.bird.y = window.innerHeight * 0.45;
  state.bird.velocityY = 0;
  state.pipes = [];
  state.spawnAccumulator = 0;
  lastTime = performance.now();

  scoreEl.textContent = "0";
  updateTimeText();
}

function spawnPipe() {
  const margin = 80;
  const minTop = margin;
  const maxTop = window.innerHeight - margin - pipeGap;
  const topHeight = minTop + Math.random() * (maxTop - minTop);

  state.pipes.push({
    x: window.innerWidth + pipeWidth,
    width: pipeWidth,
    topHeight,
    bottomY: topHeight + pipeGap,
    passed: false
  });
}

function flap() {
  if (!state.running || state.ended) return;
  state.bird.velocityY = flapVelocity;
}

function endGame() {
  state.ended = true;
  state.running = false;
  overlayEl.classList.remove("hidden");
  overlayEl.querySelector("h1").textContent = "Игра окончена";
  overlayEl.querySelector("p").textContent = `Твой счет: ${state.score}`;
  startBtn.textContent = "Играть снова";
}

function update(dt) {
  if (!state.running || state.ended) return;

  state.timeLeft = Math.max(0, state.timeLeft - dt);
  updateTimeText();

  if (state.timeLeft <= 0) {
    endGame();
    return;
  }

  state.bird.velocityY += gravity * dt;
  state.bird.y += state.bird.velocityY * dt;

  state.spawnAccumulator += dt * 1000;
  if (state.spawnAccumulator >= PIPE_SPAWN_MS) {
    state.spawnAccumulator = 0;
    spawnPipe();
  }

  for (const pipe of state.pipes) {
    pipe.x -= pipeSpeed * dt;

    if (!pipe.passed && state.bird.x > pipe.x + pipe.width) {
      pipe.passed = true;
      state.score += 1;
      scoreEl.textContent = String(state.score);
    }
  }

  state.pipes = state.pipes.filter((pipe) => pipe.x + pipe.width > -40);

  const birdTop = state.bird.y - state.bird.radius;
  const birdBottom = state.bird.y + state.bird.radius;
  const birdLeft = state.bird.x - state.bird.radius;
  const birdRight = state.bird.x + state.bird.radius;

  if (birdTop <= 0 || birdBottom >= window.innerHeight) {
    endGame();
    return;
  }

  for (const pipe of state.pipes) {
    const inPipeX = birdRight > pipe.x && birdLeft < pipe.x + pipe.width;
    const hitTop = birdTop < pipe.topHeight;
    const hitBottom = birdBottom > pipe.bottomY;

    if (inPipeX && (hitTop || hitBottom)) {
      endGame();
      return;
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (assets.background.complete) {
    ctx.drawImage(assets.background, 0, 0, window.innerWidth, window.innerHeight);
  } else {
    ctx.fillStyle = "#74c2ff";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  for (const pipe of state.pipes) {
    const pipeImage = pipe.passed ? assets.pipeGreen : assets.pipeRed;

    if (pipeImage.complete) {
      ctx.drawImage(pipeImage, pipe.x, 0, pipe.width, pipe.topHeight);
      ctx.save();
      ctx.translate(pipe.x + pipe.width / 2, pipe.bottomY);
      ctx.scale(1, -1);
      ctx.drawImage(pipeImage, -pipe.width / 2, 0, pipe.width, window.innerHeight - pipe.bottomY);
      ctx.restore();
    } else {
      ctx.fillStyle = pipe.passed ? "#22c55e" : "#ef4444";
      ctx.fillRect(pipe.x, 0, pipe.width, pipe.topHeight);
      ctx.fillRect(pipe.x, pipe.bottomY, pipe.width, window.innerHeight - pipe.bottomY);
    }
  }

  if (assets.bird.complete) {
    const size = state.bird.radius * 2.5;
    ctx.drawImage(
      assets.bird,
      state.bird.x - size / 2,
      state.bird.y - size / 2,
      size,
      size
    );
  } else {
    ctx.beginPath();
    ctx.fillStyle = "#ffd900";
    ctx.arc(state.bird.x, state.bird.y, state.bird.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.034);
  lastTime = timestamp;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function updateTimeText() {
  const total = Math.ceil(state.timeLeft);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  timeEl.textContent = `${mm}:${ss}`;
}

startBtn.addEventListener("click", () => {
  overlayEl.classList.add("hidden");
  overlayEl.querySelector("h1").textContent = "Flappy Bird";
  overlayEl.querySelector("p").textContent = "Нажми на экран, чтобы лететь вверх";
  startBtn.textContent = "Начать игру";
  resetGame();
});

window.addEventListener("pointerdown", flap);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" || event.code === "ArrowUp") flap();
});
window.addEventListener("resize", fitCanvas);

fitCanvas();
updateTimeText();
draw();
lastTime = performance.now();
requestAnimationFrame(loop);
