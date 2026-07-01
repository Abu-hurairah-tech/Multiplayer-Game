console.log("hello");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let lastTime = 0;
const gameState = {
  player: { x: 100, y: 100, size: 20, color: "#00ffcc", speed: 200 },
};

const keys = {
  w: false,
  s: false,
  a: false,
  d: false,
};

window.addEventListener("keydown", (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) {
    keys[e.key.toLowerCase()] = true;
  }
});

window.addEventListener("keyup", (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) {
    keys[e.key.toLowerCase()] = false;
  }
});

function gameLoop(timestamp) {
  let deltaTime = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  update(deltaTime);
  draw();

  requestAnimationFrame(gameLoop);
}

function update(dt) {
  let dx = 0;
  let dy = 0;

  if (keys.w) dy -= 1;
  if (keys.s) dy += 1;
  if (keys.d) dx += 1;
  if (keys.a) dx -= 1;

  if (dx !== 0 && dy !== 0) {
    const length = Math.sqrt(dx * dx + dy * dy);
    dx /= length;
    dy /= length;
  }

  gameState.player.x += dx * gameState.player.speed * dt;
  gameState.player.y += dy * gameState.player.speed * dt;

  const halfSize = gameState.player.size / 2;
  if (gameState.player.x - halfSize < 0) {
    gameState.player.x = halfSize;
  } else if (gameState.player.x + halfSize > canvas.width) {
    gameState.player.x = canvas.width - halfSize;
  }

  if (gameState.player.y - halfSize < 0) {
    gameState.player.y = halfSize;
  } else if (gameState.player.y + halfSize > canvas.height) {
    gameState.player.y = canvas.height - halfSize;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.height);

  ctx.fillStyle = gameState.player.color;
  ctx.fillRect(
    gameState.player.x - gameState.player.size / 2,
    gameState.player.y - gameState.player.size / 2,
    gameState.player.size,
    gameState.player.size,
  );
}

requestAnimationFrame(gameLoop);
