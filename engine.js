const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// --- SESSION PERSISTENCE (Using sessionStorage) ---
let myId = sessionStorage.getItem("arena_playerId");
let myColor = sessionStorage.getItem("arena_playerColor");
let myName = sessionStorage.getItem("arena_playerName");

// If the player doesn't have a saved ID in this session, generate new ones
if (!myId) {
  myId = Math.random().toString(36).substring(2, 9);
  myColor = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;

  sessionStorage.setItem("arena_playerId", myId);
  sessionStorage.setItem("arena_playerColor", myColor);
}

// Grab UI Elements
const nameOverlay = document.getElementById("name-overlay");
const nameInput = document.getElementById("player-name-input");
const nameError = document.getElementById("name-error");
const joinBtn = document.getElementById("join-btn");

let socket = null; // Declare socket globally so inputs can use it

if (myName) {
  // If they already have a name in this tab (e.g., they just refreshed), connect immediately
  nameOverlay.style.display = "none";
  connectToServer();
} else {
  // If it's a completely new tab/connection, show the overlay
  nameOverlay.style.display = "flex";
  nameInput.value = "";
  nameInput.focus();
}

// Handle the Join Button Click
joinBtn.addEventListener("click", () => {
  const enteredName = nameInput.value.trim().toUpperCase();

  if (enteredName === "") {
    // Show red error if empty
    nameError.style.opacity = "1";
  } else {
    // Hide error, save name to the current session, hide UI, and connect
    nameError.style.opacity = "0";
    myName = enteredName;
    sessionStorage.setItem("arena_playerName", myName);
    nameOverlay.style.display = "none";
    connectToServer();
  }
});

// Allow hitting "Enter" to join
nameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    joinBtn.click();
  }
});

function connectToServer() {
  socket = new WebSocket("ws://localhost:3000");

  // When we connect, perform a handshake with the server
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({ type: "JOIN", id: myId, color: myColor, name: myName }),
    );
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    // 1. Check for Lobby Rejection
    if (message.type === "LOBBY_FULL") {
      document.getElementById("full-screen-overlay").style.display = "flex";
      return;
    }

    if (message.type === "INIT") {
      myId = message.id;
    } else if (message.type === "STATE_UPDATE") {
      const newPlayers = message.state.players;

      // Detect state changes to trigger visual/audio effects
      for (const id in newPlayers) {
        const newP = newPlayers[id];
        const oldP = serverPlayers[id];

        if (oldP) {
          // 1. Damage Taken
          if (newP.health < oldP.health) {
            spawnParticles(oldP.x, oldP.y, "#ff3333", 8, false);
            SoundEngine.playHit();

            if (id === myId) {
              shakeIntensity = 12;
            }
          }

          // 2. Player Death
          if (newP.health > oldP.health && oldP.health <= 25) {
            spawnParticles(oldP.x, oldP.y, oldP.color, 35, true);
            spawnParticles(oldP.x, oldP.y, "#ffff00", 15, true);
            SoundEngine.playExplosion();
          }

          // 3. Powerup Pickup
          if (newP.boostTimer > 0 && oldP.boostTimer === 0) {
            SoundEngine.playPickup();
          }
        }
      }

      matchStatus = message.state.status;
      matchWinner = message.state.winner;
      intermissionTimer = message.state.intermissionTimer;

      serverPlayers = newPlayers;
      serverProjectiles = message.state.projectiles;
      serverTurrets = message.state.turrets;
      serverBoosters = message.state.boosters;
      serverWalls = message.state.walls;

      updateUI();
    }
  });
}

// Match State Variables
let matchStatus = "PLAYING";
let matchWinner = null;
let intermissionTimer = 0;

let serverPlayers = {};
let renderPlayers = {};
let serverProjectiles = {};
let serverTurrets = {};
let serverBoosters = {};
let serverWalls = [];

const LERP_FACTOR = 0.3;

// --- VISUAL JUICE VARIABLES ---
let shakeIntensity = 0;
const particles = [];
let lastFrameTime = performance.now();

// --- SOUND ENGINE (WEB AUDIO API) ---
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

const SoundEngine = {
  playShoot: () => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = "square";
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.1,
    );

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  },

  playHit: () => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.1,
    );

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  },

  playExplosion: () => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.4);

    gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.4,
    );

    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  },

  playPickup: () => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = "sine";
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.setValueAtTime(600, audioCtx.currentTime + 0.1);
    osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  },
};

function spawnParticles(x, y, color, count, isExplosion = false) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = isExplosion
      ? 120 + Math.random() * 280
      : 40 + Math.random() * 120;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: color,
      size: isExplosion ? 3 + Math.random() * 5 : 2 + Math.random() * 3,
      life: isExplosion
        ? 0.4 + Math.random() * 0.3
        : 0.15 + Math.random() * 0.2,
      maxLife: isExplosion ? 0.7 : 0.35,
    });
  }
}

function updateUI() {
  const scoreList = document.getElementById("score-list");
  const turretStatus = document.getElementById("turret-status");

  if (!scoreList || !turretStatus) return;

  if (serverPlayers[myId]) {
    const me = serverPlayers[myId];
    if (me.score >= 3) {
      turretStatus.style.color = "#00FF00";
      turretStatus.innerText = "TURRET READY (E)";
    } else {
      turretStatus.style.color = "rgba(255, 255, 255, 0.7)";
      turretStatus.innerText = `Turret: ${me.score}/3 Kills`;
    }
  }

  const sortedPlayers = Object.entries(serverPlayers).sort(
    (a, b) => b[1].score - a[1].score,
  );

  let html = "";
  for (const [id, player] of sortedPlayers) {
    const isMe = id === myId;
    const fontWeight = isMe ? "bold" : "normal";
    const textAppend = isMe ? " (You)" : "";

    html += `
      <div class="player-row" style="font-weight: ${fontWeight};">
        <div class="color-box" style="background-color: ${player.color};"></div>
        <span>${player.name || "UNKNOWN"}${textAppend}: ${player.score} / 15 pts</span>
      </div>
    `;
  }
  scoreList.innerHTML = html;
}

let isShooting = false;
let aimX = 0;
let aimY = 0;
let lastShotTime = 0;
const FIRE_RATE_MS = 200;

// Update aiming coordinates on mouse move
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  aimX = (e.clientX - rect.left) * scaleX;
  aimY = (e.clientY - rect.top) * scaleY;
});

canvas.addEventListener("mousedown", (e) => {
  initAudio();
  if (e.button === 0) isShooting = true;
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) isShooting = false;
});

const keys = { w: false, a: false, s: false, d: false };

function sendInput() {
  if (matchStatus !== "PLAYING") return;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "INPUT", keys: keys }));
  }
}

window.addEventListener("keydown", (e) => {
  initAudio();
  // Prevent sending game inputs if typing in the name box or if game is paused
  if (document.activeElement === nameInput || matchStatus !== "PLAYING") return;

  const key = e.key.toLowerCase();

  if (key === " ") {
    e.preventDefault();
    isShooting = true;
  }

  if (keys.hasOwnProperty(key) && !keys[key]) {
    keys[key] = true;
    sendInput();
  }

  if (key === "e" && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "DROP_TURRET" }));
  }
});

window.addEventListener("keyup", (e) => {
  if (document.activeElement === nameInput) return;
  const key = e.key.toLowerCase();

  if (key === " ") {
    isShooting = false;
  }

  if (keys.hasOwnProperty(key)) {
    keys[key] = false;
    sendInput();
  }
});

function gameLoop() {
  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  if (shakeIntensity > 0) {
    const shakeX = (Math.random() - 0.5) * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(shakeX, shakeY);

    shakeIntensity *= 0.85;
    if (shakeIntensity < 0.2) shakeIntensity = 0;
  }

  // 1. Draw Walls
  ctx.fillStyle = "#4a4a4a";
  for (const wall of serverWalls) {
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  }

  // 2. Draw Boosters
  for (const bId in serverBoosters) {
    const booster = serverBoosters[bId];
    ctx.save();
    ctx.translate(booster.x, booster.y);
    ctx.rotate(Math.PI / 4);

    ctx.shadowBlur = 15;
    ctx.shadowColor = "#00FFFF";
    ctx.fillStyle = "#00FFFF";
    ctx.fillRect(
      -booster.size / 2,
      -booster.size / 2,
      booster.size,
      booster.size,
    );
    ctx.restore();
  }

  // 3. Draw Turrets
  for (const tId in serverTurrets) {
    const turret = serverTurrets[tId];
    ctx.beginPath();
    ctx.arc(turret.x, turret.y, turret.range, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.stroke();

    ctx.fillStyle = turret.color;
    ctx.beginPath();
    ctx.arc(turret.x, turret.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 4. Draw Projectiles
  ctx.fillStyle = "yellow";
  for (const pId in serverProjectiles) {
    const bullet = serverProjectiles[pId];
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Draw Players
  for (const id in serverPlayers) {
    const target = serverPlayers[id];

    if (!renderPlayers[id]) {
      renderPlayers[id] = {
        x: target.x,
        y: target.y,
        size: target.size,
        color: target.color,
      };
    }

    const renderObj = renderPlayers[id];

    if (matchStatus === "PLAYING") {
      renderObj.x += (target.x - renderObj.x) * LERP_FACTOR;
      renderObj.y += (target.y - renderObj.y) * LERP_FACTOR;
    }

    if (target.boostTimer > 0) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#00FFFF";
    } else {
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = renderObj.color;
    ctx.fillRect(
      renderObj.x - renderObj.size / 2,
      renderObj.y - renderObj.size / 2,
      renderObj.size,
      renderObj.size,
    );

    ctx.shadowBlur = 0;

    if (id === myId) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        renderObj.x - renderObj.size / 2,
        renderObj.y - renderObj.size / 2,
        renderObj.size,
        renderObj.size,
      );
    }

    // DRAW NAME BELOW PLAYER
    ctx.fillStyle = "white";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      target.name || "UNKNOWN",
      renderObj.x,
      renderObj.y + renderObj.size / 2 + 15,
    );

    if (target.boostTimer > 0) {
      ctx.fillStyle = "#00FFFF";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        target.boostTimer.toFixed(1) + "s",
        renderObj.x,
        renderObj.y - 28,
      );
    }

    ctx.fillStyle = "red";
    ctx.fillRect(
      renderObj.x - renderObj.size / 2,
      renderObj.y - 22,
      renderObj.size,
      4,
    );

    ctx.fillStyle = "green";
    ctx.fillRect(
      renderObj.x - renderObj.size / 2,
      renderObj.y - 22,
      renderObj.size * (target.health / 100),
      4,
    );
  }

  // Cleanup disconnected players
  for (const id in renderPlayers) {
    if (!serverPlayers[id]) delete renderPlayers[id];
  }

  // 6. --- RENDER PARTICLES ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1.0;

  ctx.restore();

  // Auto-fire loop
  if (
    isShooting &&
    matchStatus === "PLAYING" &&
    socket &&
    socket.readyState === WebSocket.OPEN &&
    nameOverlay.style.display === "none" // Don't shoot while name overlay is open
  ) {
    const nowMs = Date.now();
    if (nowMs - lastShotTime > FIRE_RATE_MS) {
      socket.send(
        JSON.stringify({ type: "SHOOT", targetX: aimX, targetY: aimY }),
      );
      SoundEngine.playShoot();
      lastShotTime = nowMs;
    }
  }

  // 7. Draw Intermission Overlay
  if (matchStatus === "INTERMISSION") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (matchWinner) {
      const isMe = matchWinner.id === myId;
      const titleText = isMe ? "VICTORY!" : "MATCH OVER";
      const subText = isMe
        ? "You reached 15 kills."
        : "An opponent has reached 15 kills.";

      ctx.fillStyle = matchWinner.color;
      ctx.font = "bold 56px Arial";
      ctx.textAlign = "center";
      ctx.fillText(titleText, canvas.width / 2, canvas.height / 2 - 20);

      ctx.fillStyle = "white";
      ctx.font = "24px Arial";
      ctx.fillText(subText, canvas.width / 2, canvas.height / 2 + 25);
    }

    ctx.fillStyle = "#aaaaaa";
    ctx.font = "20px Arial";
    ctx.fillText(
      `Next match starting in ${Math.ceil(intermissionTimer)}...`,
      canvas.width / 2,
      canvas.height / 2 + 70,
    );
  }

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
