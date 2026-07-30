const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const socket = new WebSocket("ws://localhost:3000");

// UI Elements
const loginOverlay = document.getElementById("login-overlay");
const votingOverlay = document.getElementById("voting-overlay");
const messageOverlay = document.getElementById("message-overlay");
const spectatorHud = document.getElementById("spectator-hud");
const hud = document.getElementById("hud");

let myId = null;
let gameState = null;
let oldState = null;
let renderPlayers = {};
let keys = { w: false, a: false, s: false, d: false };

// --- [NEW] VISUAL PARTICLE SYSTEM ---
let particles = [];

function createExplosion(x, y, color) {
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 400, // Explode outward in random directions
      vy: (Math.random() - 0.5) * 400,
      life: 1.0,
      color: color,
      size: Math.random() * 6 + 2, // Different sized shards
    });
  }
}

// --- 1. THE SOUND SYNTHESIZER ---
const SoundEngine = {
  ctx: new (window.AudioContext || window.webkitAudioContext)(),

  shoot: function () {
    if (this.ctx.state === "suspended") return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  },

  hit: function () {
    if (this.ctx.state === "suspended") return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  },

  // [NEW] Retro explosion drop sound
  kill: function () {
    if (this.ctx.state === "suspended") return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  },

  turret: function () {
    if (this.ctx.state === "suspended") return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  },

  win: function () {
    if (this.ctx.state === "suspended") return;
    const playTone = (freq, delay) => {
      setTimeout(() => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          this.ctx.currentTime + 0.3,
        );
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
      }, delay);
    };
    playTone(440, 0);
    playTone(554, 150);
    playTone(659, 300);
    playTone(880, 450);
  },
};

function getRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

// 1. Ensure Player Identity is maintained across tabs
let sessionId = localStorage.getItem("arena_session_id");
if (!sessionId) {
  sessionId = Math.random().toString(36).substring(2, 15);
  localStorage.setItem("arena_session_id", sessionId);
}

// 2. Load previously saved name and color
let savedName = localStorage.getItem("arena_name");
let savedColor = localStorage.getItem("arena_color");
if (savedName) document.getElementById("player-name").value = savedName;
if (savedColor) document.getElementById("player-color").value = savedColor;
else document.getElementById("player-color").value = getRandomColor();

// Helper to actually send the join packet
function attemptJoin(name, color) {
  if (SoundEngine.ctx.state === "suspended") SoundEngine.ctx.resume();

  socket.send(
    JSON.stringify({
      type: "JOIN",
      id: sessionId,
      name: name,
      color: color,
    }),
  );

  loginOverlay.style.display = "none";
}

// 3. Auto-Join if this is just a page refresh
socket.onopen = () => {
  if (sessionStorage.getItem("arena_auto_join") === "true") {
    const name = localStorage.getItem("arena_name") || "Player";
    const color = localStorage.getItem("arena_color") || getRandomColor();
    attemptJoin(name, color);
  }
};

// 4. If connection is completely lost, force them back to the login screen
socket.onclose = () => {
  sessionStorage.removeItem("arena_auto_join"); // Clear the auto-join flag
  loginOverlay.style.display = "flex"; // Show name panel again
};

document.getElementById("join-btn").addEventListener("click", () => {
  const name = document.getElementById("player-name").value || "Player";
  const color = document.getElementById("player-color").value;

  // Save to local storage for future, and flag session storage to auto-join on refresh
  localStorage.setItem("arena_name", name);
  localStorage.setItem("arena_color", color);
  sessionStorage.setItem("arena_auto_join", "true");

  attemptJoin(name, color);
});

// --- QUIT CONFIRMATION LOGIC ---
const quitBtn = document.getElementById("quit-btn");
const quitConfirm = document.getElementById("quit-confirm");
const quitYes = document.getElementById("quit-yes");
const quitNo = document.getElementById("quit-no");

if (quitBtn) {
  // Show confirmation
  quitBtn.addEventListener("click", () => {
    quitBtn.style.display = "none";
    quitConfirm.style.display = "block";
  });

  // Cancel quit
  quitNo.addEventListener("click", () => {
    quitConfirm.style.display = "none";
    quitBtn.style.display = "block";
  });

  // Confirm quit
  quitYes.addEventListener("click", () => {
    // 1. Tell server to wipe our data immediately (NOW PASSING ID)
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "QUIT", id: sessionId }));
    }

    // 2. Stop the game from auto-joining on refresh
    sessionStorage.removeItem("arena_auto_join");

    // 3. Generate a completely fresh Session ID locally
    sessionId = Math.random().toString(36).substring(2, 15);
    localStorage.setItem("arena_session_id", sessionId);

    // 4. Wipe local tracking variables
    myId = null;
    gameState = null;
    oldState = null;

    // 5. CLEAR THE CANVAS to remove the "ghost" frozen frame
    const canvas = document.getElementById("gameCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 6. Reset UI layout back to login
    quitConfirm.style.display = "none";
    quitBtn.style.display = "block"; // Reset for next time

    hud.style.display = "none";
    spectatorHud.style.display = "none";
    messageOverlay.style.display = "none";
    votingOverlay.style.display = "none";
    loginOverlay.style.display = "flex";

    document.getElementById("player-name").value = "";
  });
}

// Since Auto-Join bypasses the Join button, we must unlock audio on the first click/keypress
window.addEventListener("mousedown", () => {
  if (SoundEngine.ctx.state === "suspended") SoundEngine.ctx.resume();
});
window.addEventListener("keydown", () => {
  if (SoundEngine.ctx.state === "suspended") SoundEngine.ctx.resume();
});

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "INIT") {
    myId = data.id;
  } else if (
    data.type === "KICKED" ||
    data.type === "MATCH_IN_PROGRESS" ||
    data.type === "LOBBY_FULL"
  ) {
    sessionStorage.removeItem("arena_auto_join"); // Don't auto-join if they were kicked
    loginOverlay.style.display = "flex";
    showMessage(
      data.type.replace(/_/g, " "),
      data.reason || "Please try again later.",
    );
  } else if (data.type === "STATE_UPDATE") {
    gameState = data.state;

    if (!myId) return;

    gameState = data.state;
    // --- DEATH, DAMAGE, AND EXPLOSION DETECTION ---
    if (oldState) {
      for (let pId in gameState.players) {
        const pOld = oldState.players[pId];
        const pNew = gameState.players[pId];

        if (pOld && pNew) {
          const dist = Math.sqrt(
            Math.pow(pNew.x - pOld.x, 2) + Math.pow(pNew.y - pOld.y, 2),
          );

          if (
            (!pOld.isSpectator && pNew.isSpectator) ||
            (dist > 50 && !pNew.isSpectator)
          ) {
            createExplosion(pOld.x, pOld.y, pOld.color);
            SoundEngine.kill();
          } else if (pNew.health < pOld.health) {
            SoundEngine.hit();
          }
        }
      }
      if (
        oldState.status !== "CELEBRATION" &&
        gameState.status === "CELEBRATION"
      ) {
        SoundEngine.win();
      }
    }

    oldState = JSON.parse(JSON.stringify(gameState));
    updateUI(gameState);
  }
};

let currentVote = null;

function updateUI(state) {
  if (state.status === "WAITING") {
    votingOverlay.style.display = "none";
    messageOverlay.style.display = "flex";
    spectatorHud.style.display = "none";
    hud.style.display = "none";
    showMessage("WAITING FOR PLAYERS", "Need at least 2 players to start...");
  } else if (state.status === "VOTING") {
    votingOverlay.style.display = "flex";
    messageOverlay.style.display = "none";
    spectatorHud.style.display = "none";
    hud.style.display = "none";

    document.getElementById("vote-timer").innerText = Math.ceil(
      state.voteTimer,
    );
    document.getElementById("ffa-count").innerText = state.votes.ffa;
    document.getElementById("tourney-count").innerText = state.votes.tourney;
  } else if (
    state.status === "INTERMISSION" ||
    state.status === "CELEBRATION"
  ) {
    votingOverlay.style.display = "none";
    messageOverlay.style.display = "flex";
    hud.style.display = "none";

    if (state.status === "CELEBRATION" && state.winner) {
      showMessage(
        "🏆 TOURNAMENT CHAMPION 🏆",
        `${state.winner.name} wins it all!`,
      );
    } else if (state.winner) {
      showMessage("MATCH OVER", `${state.winner.name}`);
    } else {
      showMessage("INTERMISSION", "Preparing next match...");
    }
  } else {
    votingOverlay.style.display = "none";
    messageOverlay.style.display = "none";
    hud.style.display = "block";

    if (state.players[myId] && state.players[myId].isSpectator) {
      spectatorHud.style.display = "block";
      hud.style.display = "none";
    } else {
      spectatorHud.style.display = "none";
    }

    if (state.players[myId] && !state.players[myId].isSpectator) {
      const p = state.players[myId];

      const turretCost = state.currentMode === "TOURNAMENT" ? 1 : 3;
      const tScore = p.turretScore || 0;
      let turretText =
        tScore >= turretCost
          ? "<span style='color: #4caf50;'>READY (Press SPACE)</span>"
          : `${tScore} / ${turretCost} Kills`;

      let activeTurret = false;
      for (let tId in state.turrets) {
        if (state.turrets[tId].ownerId === myId) activeTurret = true;
      }
      if (activeTurret)
        turretText = "<span style='color: #ff9800;'>DEPLOYED ACTIVE</span>";

      let tourneyStats = "";
      if (state.currentMode === "TOURNAMENT" && state.tournament) {
        tourneyStats = `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555;">`;
        tourneyStats += `<div style="margin-bottom: 8px; color: #ffeb3b;"><strong>Tournament Standings</strong></div>`;

        const playersList = Object.values(state.tournament.players).sort(
          (a, b) => {
            const ranks = { Champion: 1, Active: 2, Eliminated: 3 };
            return ranks[a.status] - ranks[b.status];
          },
        );

        playersList.forEach((pData, index) => {
          let color =
            pData.status === "Active"
              ? "#4caf50"
              : pData.status === "Champion"
                ? "#ffeb3b"
                : "#ff4c4c";
          let statusText =
            pData.status === "Eliminated"
              ? `(Eliminated)`
              : `(Rank ${index + 1})`;
          if (pData.status === "Champion") statusText = `🏆 WINNER`;
          tourneyStats += `<div style="color: ${color}; font-size: 14px; margin-bottom: 4px;">${index + 1}. ${pData.name} ${statusText}</div>`;
        });
        tourneyStats += `</div>`;
      }

      const displayMode =
        state.currentMode === "TOURNAMENT"
          ? `TOURNAMENT (Match ${state.tournament.matchNumber})`
          : "FREE FOR ALL";

      hud.innerHTML = `
                <div style="margin-bottom: 5px;">Health: ${p.health}</div>
                <div style="margin-bottom: 5px;">Kills: ${p.score}</div>
                <div style="margin-bottom: 5px; color: #00ffff;">Mode: ${displayMode}</div>
                <div style="color: #aaa; margin-top: 10px; font-size: 14px;">Turret: ${turretText}</div>
                ${tourneyStats}
            `;
    }
  }
}

function showMessage(title, subtitle) {
  messageOverlay.style.display = "flex";
  document.getElementById("message-title").innerText = title;
  document.getElementById("message-subtitle").innerText = subtitle;
}

document.getElementById("vote-ffa").addEventListener("click", () => {
  if (currentVote || gameState.status !== "VOTING") return;
  currentVote = "FFA";
  document.getElementById("vote-ffa").classList.add("selected");
  socket.send(JSON.stringify({ type: "VOTE", choice: "FFA" }));
});

document.getElementById("vote-tourney").addEventListener("click", () => {
  if (currentVote || gameState.status !== "VOTING") return;
  currentVote = "TOURNAMENT";
  document.getElementById("vote-tourney").classList.add("selected");
  socket.send(JSON.stringify({ type: "VOTE", choice: "TOURNAMENT" }));
});

setInterval(() => {
  if (gameState && gameState.status !== "VOTING" && currentVote) {
    currentVote = null;
    document.getElementById("vote-ffa").classList.remove("selected");
    document.getElementById("vote-tourney").classList.remove("selected");
  }
}, 1000);

window.addEventListener("keydown", (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) {
    keys[e.key.toLowerCase()] = true;
    sendInput();
  }
  if (e.code === "Space") {
    e.preventDefault();
    socket.send(JSON.stringify({ type: "DROP_TURRET" }));
    SoundEngine.turret();
  }
});

window.addEventListener("keyup", (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) {
    keys[e.key.toLowerCase()] = false;
    sendInput();
  }
});

function sendInput() {
  if (
    !myId ||
    !gameState ||
    gameState.status === "VOTING" ||
    gameState.status === "INTERMISSION" ||
    gameState.status === "WAITING"
  )
    return;
  if (gameState.players[myId] && gameState.players[myId].isSpectator) return;
  socket.send(JSON.stringify({ type: "INPUT", keys }));
}

canvas.addEventListener("mousedown", (e) => {
  if (
    !myId ||
    !gameState ||
    gameState.status === "VOTING" ||
    gameState.status === "INTERMISSION" ||
    gameState.status === "WAITING"
  )
    return;
  if (gameState.players[myId] && gameState.players[myId].isSpectator) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const targetX = (e.clientX - rect.left) * scaleX;
  const targetY = (e.clientY - rect.top) * scaleY;

  socket.send(JSON.stringify({ type: "SHOOT", targetX, targetY }));
  SoundEngine.shoot();
});

const lerp = (start, end, factor) => start + (end - start) * factor;

function drawGame(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#555";
  state.walls.forEach((w) => ctx.fillRect(w.x, w.y, w.w, w.h));

  ctx.fillStyle = "#00ffff";
  for (const bId in state.boosters) {
    const b = state.boosters[bId];
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const tId in state.turrets) {
    const t = state.turrets[tId];
    ctx.fillStyle = t.color;
    ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
    ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const id in renderPlayers) {
    if (!state.players[id]) delete renderPlayers[id];
  }

  for (const pId in state.players) {
    const p = state.players[pId];

    if (!renderPlayers[pId]) {
      renderPlayers[pId] = { x: p.x, y: p.y };
    } else {
      renderPlayers[pId].x = lerp(renderPlayers[pId].x, p.x, 0.3);
      renderPlayers[pId].y = lerp(renderPlayers[pId].y, p.y, 0.3);
    }

    const rx = renderPlayers[pId].x;
    const ry = renderPlayers[pId].y;

    ctx.globalAlpha = p.isSpectator ? 0.3 : 1.0;

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(rx, ry, p.size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.name, rx, ry - 15);

    if (!p.isSpectator) {
      ctx.fillStyle = "red";
      ctx.fillRect(rx - 15, ry + 15, 30, 4);
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(rx - 15, ry + 15, 30 * (p.health / 100), 4);
    }
    ctx.globalAlpha = 1.0;
  }

  ctx.fillStyle = "yellow";
  for (const pId in state.projectiles) {
    const bullet = state.projectiles[pId];
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- [NEW] DRAW AND UPDATE PARTICLES ---
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx * 0.016; // Simulate movement based on 60fps
    p.y += p.vy * 0.016;
    p.life -= 0.025; // Fade out over time

    if (p.life <= 0) {
      particles.splice(i, 1);
    } else {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1.0;
}

function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (gameState) {
    drawGame(gameState);
  }
}

requestAnimationFrame(gameLoop);
