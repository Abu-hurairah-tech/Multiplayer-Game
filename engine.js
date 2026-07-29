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
let renderPlayers = {};
let keys = { w: false, a: false, s: false, d: false };

function getRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}
document.getElementById("player-color").value = getRandomColor();

let sessionId = sessionStorage.getItem("arena_session_id");
if (!sessionId) {
  sessionId = Math.random().toString(36).substring(2, 15);
  sessionStorage.setItem("arena_session_id", sessionId);
}

document.getElementById("join-btn").addEventListener("click", () => {
  const name = document.getElementById("player-name").value || "Player";
  const color = document.getElementById("player-color").value;

  socket.send(
    JSON.stringify({
      type: "JOIN",
      id: sessionId,
      name: name,
      color: color,
    }),
  );

  loginOverlay.style.display = "none";
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
    showMessage(
      data.type.replace(/_/g, " "),
      data.reason || "Please try again later.",
    );
  } else if (data.type === "STATE_UPDATE") {
    gameState = data.state;
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

      // --- BUILD THE NEW TOURNAMENT LEADERBOARD ---
      let tourneyStats = "";
      if (state.currentMode === "TOURNAMENT" && state.tournament) {
        tourneyStats = `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555;">`;
        tourneyStats += `<div style="margin-bottom: 8px; color: #ffeb3b;"><strong>Tournament Standings</strong></div>`;

        // Sort players logically: Champions first, then Active, then Eliminated
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
}

function gameLoop() {
  requestAnimationFrame(gameLoop);

  if (gameState) {
    drawGame(gameState);
  }
}

requestAnimationFrame(gameLoop);
