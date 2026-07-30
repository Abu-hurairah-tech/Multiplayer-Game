/**
 * ============================================================================
 * CANVAS ARENA SHOOTER - CLIENT ENGINE
 * ============================================================================
 * Architecture:
 * 1. State/Globals  - Core variables holding the game data.
 * 2. Utilities/VFX  - Math helpers and the Particle System.
 * 3. Audio System   - Synthesized Web Audio API sound effects.
 * 4. Session Mgt    - Local/Session storage for multi-tab stability.
 * 5. Networking     - WebSocket connection and server message handling.
 * 6. Input Handlers - Keyboard and mouse tracking.
 * 7. User Interface - DOM manipulation for menus, HUD, and lobbies.
 * 8. Render Engine  - HTML5 Canvas drawing and the main game loop.
 * ============================================================================
 */

// ============================================================================
// [ SECTION 1: GLOBAL CONFIGURATION & STATE ]
// ============================================================================

// Canvas Setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// UI Element References
const loginOverlay = document.getElementById("login-overlay");
const votingOverlay = document.getElementById("voting-overlay");
const messageOverlay = document.getElementById("message-overlay");
const spectatorHud = document.getElementById("spectator-hud");
const hud = document.getElementById("hud");

// Core Game State Variables
let myId = null; // The player's unique server-assigned ID
let gameState = null; // The current snapshot of the world from the server
let oldState = null; // The previous snapshot (used for detecting damage/death)
let renderPlayers = {}; // Local tracker for smooth interpolation (Lerp)
let keys = { w: false, a: false, s: false, d: false }; // Current keyboard state

// ============================================================================
// [ SECTION 2: UTILITIES & VISUAL EFFECTS (VFX) ]
// ============================================================================

/** Linear Interpolation (Lerp) - Smooths out jerky network movement */
const lerp = (start, end, factor) => start + (end - start) * factor;

/** Generates a random hex color for new players */
function getRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

// Particle System State
let particles = [];

/** Spawns a burst of particles at a specific coordinate */
function createExplosion(x, y, color) {
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 400, // Explode outward in random directions
      vy: (Math.random() - 0.5) * 400,
      life: 1.0, // 1.0 = 100% opacity
      color: color,
      size: Math.random() * 6 + 2, // Varying shard sizes
    });
  }
}

// ============================================================================
// [ SECTION 3: AUDIO SYSTEM (SFX) ]
// ============================================================================

/**
 * Web Audio API Synthesizer
 * Generates all sound effects procedurally without needing external audio files.
 */
const SoundEngine = {
  ctx: new (window.AudioContext || window.webkitAudioContext)(),

  // Standard projectile fire sound (High pitch dropping quickly)
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

  // Player taking damage (Harsh sawtooth wave)
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

  // Player elimination (Deep retro explosion)
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

  // Turret deployment (Brief high-pitched blip)
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

  // Tournament/Match victory fanfare (Arpeggiated chord)
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
    playTone(440, 0); // A4
    playTone(554, 150); // C#5
    playTone(659, 300); // E5
    playTone(880, 450); // A5
  },
};

// Browsers block audio until user interaction. Unlock on first input.
window.addEventListener("mousedown", () => {
  if (SoundEngine.ctx.state === "suspended") SoundEngine.ctx.resume();
});
window.addEventListener("keydown", () => {
  if (SoundEngine.ctx.state === "suspended") SoundEngine.ctx.resume();
});

// ============================================================================
// [ SECTION 4: SESSION & IDENTITY MANAGEMENT ]
// ============================================================================

// 1. Session ID Generation - Prevents multi-tab cloning bugs
let sessionId = localStorage.getItem("arena_session_id");
if (!sessionId) {
  sessionId = Math.random().toString(36).substring(2, 15);
  localStorage.setItem("arena_session_id", sessionId);
}

// 2. Load preferred cosmetcis from previous visits
let savedName = localStorage.getItem("arena_name");
let savedColor = localStorage.getItem("arena_color");

if (savedName) document.getElementById("player-name").value = savedName;
if (savedColor) document.getElementById("player-color").value = savedColor;
else document.getElementById("player-color").value = getRandomColor();

// ============================================================================
// [ SECTION 5: NETWORKING (WEBSOCKETS) ]
// ============================================================================

const socket = new WebSocket("wss://multiplayer-game-server-7omz.onrender.com");

/** Formats and sends the initial join packet to the server */
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

// Auto-Join logic for quick page refreshes during gameplay
socket.onopen = () => {
  if (sessionStorage.getItem("arena_auto_join") === "true") {
    const name = localStorage.getItem("arena_name") || "Player";
    const color = localStorage.getItem("arena_color") || getRandomColor();
    attemptJoin(name, color);
  }
};

// Handle complete connection loss
socket.onclose = () => {
  sessionStorage.removeItem("arena_auto_join"); // Prevent auto-join loop on dead server
  loginOverlay.style.display = "flex"; // Throw user back to lobby
};

// Primary Server Message Router
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "INIT") {
    // Server acknowledged our join and assigned us an Entity ID
    myId = data.id;
  } else if (
    data.type === "KICKED" ||
    data.type === "MATCH_IN_PROGRESS" ||
    data.type === "LOBBY_FULL"
  ) {
    // Server rejected our connection
    sessionStorage.removeItem("arena_auto_join");
    loginOverlay.style.display = "flex";
    showMessage(
      data.type.replace(/_/g, " "),
      data.reason || "Please try again later.",
    );
  } else if (data.type === "STATE_UPDATE") {
    // Main 60Hz tick from server containing all game data
    gameState = data.state;
    if (!myId) return;

    // --- EVENT DETECTION (Audio & VFX) ---
    // Compare new state against old state to detect damage, kills, and wins
    if (oldState) {
      for (let pId in gameState.players) {
        const pOld = oldState.players[pId];
        const pNew = gameState.players[pId];

        if (pOld && pNew) {
          const dist = Math.sqrt(
            Math.pow(pNew.x - pOld.x, 2) + Math.pow(pNew.y - pOld.y, 2),
          );

          // Detect death: Player became a spectator, or teleported instantly (respawn)
          if (
            (!pOld.isSpectator && pNew.isSpectator) ||
            (dist > 50 && !pNew.isSpectator)
          ) {
            createExplosion(pOld.x, pOld.y, pOld.color);
            SoundEngine.kill();
          }
          // Detect damage: Health decreased
          else if (pNew.health < pOld.health) {
            SoundEngine.hit();
          }
        }
      }

      // Detect game completion
      if (
        oldState.status !== "CELEBRATION" &&
        gameState.status === "CELEBRATION"
      ) {
        SoundEngine.win();
      }
    }

    // Save state for next frame comparison and update the HUD
    oldState = JSON.parse(JSON.stringify(gameState));
    updateUI(gameState);
  }
};

// ============================================================================
// [ SECTION 6: INPUT & CONTROLS ]
// ============================================================================

/** Emits current movement keys to the server */
function sendInput() {
  // Prevent movement if dead, voting, or game hasn't started
  if (
    !myId ||
    !gameState ||
    ["VOTING", "INTERMISSION", "WAITING"].includes(gameState.status)
  )
    return;
  if (gameState.players[myId] && gameState.players[myId].isSpectator) return;

  socket.send(JSON.stringify({ type: "INPUT", keys }));
}

// Keyboard Listeners
window.addEventListener("keydown", (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) {
    keys[e.key.toLowerCase()] = true;
    sendInput();
  }
  if (e.code === "Space") {
    e.preventDefault(); // Prevent scrolling
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

// Mouse Listener (Shooting)
canvas.addEventListener("mousedown", (e) => {
  // Prevent shooting if dead or in menus
  if (
    !myId ||
    !gameState ||
    ["VOTING", "INTERMISSION", "WAITING"].includes(gameState.status)
  )
    return;
  if (gameState.players[myId] && gameState.players[myId].isSpectator) return;

  // Calculate mouse position relative to canvas scaling
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const targetX = (e.clientX - rect.left) * scaleX;
  const targetY = (e.clientY - rect.top) * scaleY;

  socket.send(JSON.stringify({ type: "SHOOT", targetX, targetY }));
  SoundEngine.shoot();
});

// ============================================================================
// [ SECTION 7: USER INTERFACE (UI) & MENUS ]
// ============================================================================

// Join Button Logic
document.getElementById("join-btn").addEventListener("click", () => {
  const name = document.getElementById("player-name").value || "Player";
  const color = document.getElementById("player-color").value;

  localStorage.setItem("arena_name", name);
  localStorage.setItem("arena_color", color);
  sessionStorage.setItem("arena_auto_join", "true"); // Enable fast reconnect

  attemptJoin(name, color);
});

// Quit Button Sequence (with confirmation step)
const quitBtn = document.getElementById("quit-btn");
const quitConfirm = document.getElementById("quit-confirm");
const quitYes = document.getElementById("quit-yes");
const quitNo = document.getElementById("quit-no");

if (quitBtn) {
  quitBtn.addEventListener("click", () => {
    quitBtn.style.display = "none";
    quitConfirm.style.display = "block";
  });

  quitNo.addEventListener("click", () => {
    quitConfirm.style.display = "none";
    quitBtn.style.display = "block";
  });

  quitYes.addEventListener("click", () => {
    // 1. Tell server to wipe our data immediately
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "QUIT", id: sessionId }));
    }

    // 2. Wipe local session data and trackers
    sessionStorage.removeItem("arena_auto_join");
    sessionId = Math.random().toString(36).substring(2, 15);
    localStorage.setItem("arena_session_id", sessionId);

    myId = null;
    gameState = null;
    oldState = null;

    // 3. Clear canvas to remove frozen "ghost" frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 4. Reset UI back to login screen
    quitConfirm.style.display = "none";
    quitBtn.style.display = "block";
    hud.style.display = "none";
    spectatorHud.style.display = "none";
    messageOverlay.style.display = "none";
    votingOverlay.style.display = "none";
    loginOverlay.style.display = "flex";
    document.getElementById("player-name").value = "";
  });
}

// Generic Message Overlay Helper
function showMessage(title, subtitle) {
  messageOverlay.style.display = "flex";
  document.getElementById("message-title").innerText = title;
  document.getElementById("message-subtitle").innerText = subtitle;
}

// Voting System Logic
let currentVote = null;

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

// Clear vote selection when voting phase ends
setInterval(() => {
  if (gameState && gameState.status !== "VOTING" && currentVote) {
    currentVote = null;
    document.getElementById("vote-ffa").classList.remove("selected");
    document.getElementById("vote-tourney").classList.remove("selected");
  }
}, 1000);

/** Core HUD update logic - called every server tick */
function updateUI(state) {
  // Phase 1: Waiting for players
  if (state.status === "WAITING") {
    votingOverlay.style.display = "none";
    messageOverlay.style.display = "flex";
    spectatorHud.style.display = "none";
    hud.style.display = "none";
    showMessage("WAITING FOR PLAYERS", "Need at least 2 players to start...");
  }
  // Phase 2: Voting on game mode
  else if (state.status === "VOTING") {
    votingOverlay.style.display = "flex";
    messageOverlay.style.display = "none";
    spectatorHud.style.display = "none";
    hud.style.display = "none";
    document.getElementById("vote-timer").innerText = Math.ceil(
      state.voteTimer,
    );
    document.getElementById("ffa-count").innerText = state.votes.ffa;
    document.getElementById("tourney-count").innerText = state.votes.tourney;
  }
  // Phase 3 & 4: Matches ending
  else if (state.status === "INTERMISSION" || state.status === "CELEBRATION") {
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
  }
  // Phase 5: Active Gameplay
  else {
    votingOverlay.style.display = "none";
    messageOverlay.style.display = "none";
    hud.style.display = "block";

    // Show Spectator HUD if player is dead/waiting in tournament
    if (state.players[myId] && state.players[myId].isSpectator) {
      spectatorHud.style.display = "block";
      hud.style.display = "none";
    } else {
      spectatorHud.style.display = "none";
    }

    // Render Active Player HUD
    if (state.players[myId] && !state.players[myId].isSpectator) {
      const p = state.players[myId];

      // Calculate Turret Economy
      const turretCost = state.currentMode === "TOURNAMENT" ? 1 : 3;
      const tScore = p.turretScore || 0;
      let turretText =
        tScore >= turretCost
          ? "<span style='color: #4caf50;'>READY (Press SPACE)</span>"
          : `${tScore} / ${turretCost} Kills`;

      // Check if player already has an active turret
      let activeTurret = false;
      for (let tId in state.turrets) {
        if (state.turrets[tId].ownerId === myId) activeTurret = true;
      }
      if (activeTurret)
        turretText = "<span style='color: #ff9800;'>DEPLOYED ACTIVE</span>";

      // Build Tournament Standings UI block
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

      // Inject HUD HTML
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

// ============================================================================
// [ SECTION 8: RENDERING ENGINE ]
// ============================================================================

/** Core Draw Call - Paints all entities to the HTML5 Canvas */
function drawGame(state) {
  // Clear previous frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Map/Walls
  ctx.fillStyle = "#555";
  state.walls.forEach((w) => ctx.fillRect(w.x, w.y, w.w, w.h));

  // 2. Draw Boosters (Power-ups)
  ctx.fillStyle = "#00ffff";
  for (const bId in state.boosters) {
    const b = state.boosters[bId];
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Draw Turrets and their range rings
  for (const tId in state.turrets) {
    const t = state.turrets[tId];
    ctx.fillStyle = t.color;
    ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
    ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Clean up disconnected players from the interpolation tracker
  for (const id in renderPlayers) {
    if (!state.players[id]) delete renderPlayers[id];
  }

  // 4. Draw Players
  for (const pId in state.players) {
    const p = state.players[pId];

    // Handle Client-Side Interpolation (Lerp) for smooth movement between server ticks
    if (!renderPlayers[pId]) {
      renderPlayers[pId] = { x: p.x, y: p.y };
    } else {
      renderPlayers[pId].x = lerp(renderPlayers[pId].x, p.x, 0.3);
      renderPlayers[pId].y = lerp(renderPlayers[pId].y, p.y, 0.3);
    }

    const rx = renderPlayers[pId].x;
    const ry = renderPlayers[pId].y;

    // Dim spectators
    ctx.globalAlpha = p.isSpectator ? 0.3 : 1.0;

    // Draw Player Body
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(rx, ry, p.size / 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw Player Name
    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.name, rx, ry - 15);

    // Draw Health Bar (if active)
    if (!p.isSpectator) {
      ctx.fillStyle = "red";
      ctx.fillRect(rx - 15, ry + 15, 30, 4); // Background (Lost health)
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(rx - 15, ry + 15, 30 * (p.health / 100), 4); // Foreground (Current health)
    }

    ctx.globalAlpha = 1.0; // Reset alpha for other entities
  }

  // 5. Draw Projectiles
  ctx.fillStyle = "yellow";
  for (const pId in state.projectiles) {
    const bullet = state.projectiles[pId];
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Draw and Update Particles (Explosions)
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];

    // Simulate kinetic movement based on standard 60fps timing
    p.x += p.vx * 0.016;
    p.y += p.vy * 0.016;
    p.life -= 0.025; // Fade out over time

    if (p.life <= 0) {
      particles.splice(i, 1); // Remove dead particles
    } else {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1.0; // Reset alpha
}

/** Main rendering loop locked to browser refresh rate */
function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (gameState) {
    drawGame(gameState);
  }
}

// Ignite the engine
requestAnimationFrame(gameLoop);
