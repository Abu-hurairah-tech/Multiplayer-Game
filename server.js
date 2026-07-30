const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 3000 });

// Procedural map generation
function generateRandomMap() {
  const walls = [];
  const numWalls = 4 + Math.floor(Math.random() * 4);

  for (let i = 0; i < numWalls; i++) {
    const isVertical = Math.random() > 0.5;
    const w = isVertical ? 40 : 100 + Math.random() * 200;
    const h = isVertical ? 100 + Math.random() * 200 : 40;

    const x = 50 + Math.random() * (800 - w - 100);
    const y = 50 + Math.random() * (600 - h - 100);

    walls.push({ x, y, w, h });
  }
  return walls;
}

// Global Game State
const gameState = {
  status: "WAITING",
  currentMode: null,
  winner: null,
  intermissionTimer: 0,
  voteTimer: 15.0,
  votes: { ffa: 0, tourney: 0 },
  votedPlayers: {},
  tournamentBracket: [],
  activeFighters: [],
  tournament: null,
  players: {},
  projectiles: {},
  walls: generateRandomMap(),
  turrets: {},
  boosters: {},
};

const recentDisconnects = {};
const activeSockets = {}; // [NEW] Tracks which tab is currently controlling the player
let projectileIdCounter = 0;
let boosterIdCounter = 0;
let boosterSpawnTimer = null;
let boosterDespawnTimer = null;

const TICK_RATE = 60;
const TURRET_COST = 3;
const FFA_WIN_SCORE = 15;
const TOURNAMENT_WIN_SCORE = 3;

function getValidSpawnPoint() {
  const MAX_ATTEMPTS = 50;
  const SAFE_DISTANCE = 60;
  const PLAYER_SIZE = 20;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const testX = Math.random() * (800 - 40) + 20;
    const testY = Math.random() * (600 - 40) + 20;
    let isSafe = true;

    for (const wall of gameState.walls) {
      if (
        testX + PLAYER_SIZE > wall.x &&
        testX - PLAYER_SIZE < wall.x + wall.w &&
        testY + PLAYER_SIZE > wall.y &&
        testY - PLAYER_SIZE < wall.y + wall.h
      ) {
        isSafe = false;
        break;
      }
    }
    if (!isSafe) continue;

    for (const pId in gameState.players) {
      if (gameState.players[pId].isSpectator) continue;
      const other = gameState.players[pId];
      const dx = other.x - testX;
      const dy = other.y - testY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < SAFE_DISTANCE) {
        isSafe = false;
        break;
      }
    }
    if (isSafe) return { x: testX, y: testY };
  }
  return { x: 400, y: 50 };
}

function scheduleBooster() {
  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);
  gameState.boosters = {};

  boosterSpawnTimer = setTimeout(() => {
    const pos = getValidSpawnPoint();
    gameState.boosters[boosterIdCounter++] = { x: pos.x, y: pos.y, size: 16 };

    boosterDespawnTimer = setTimeout(() => {
      gameState.boosters = {};
      scheduleBooster();
    }, 10000);
  }, 20000);
}

// --- GAME MODE CONTROLLERS ---

function startWaitingPhase() {
  gameState.status = "WAITING";
  gameState.currentMode = null;
  gameState.winner = null;
  gameState.voteTimer = 15.0;
  gameState.votes = { ffa: 0, tourney: 0 };
  gameState.votedPlayers = {};
  gameState.activeFighters = [];
  gameState.tournamentBracket = [];
  gameState.tournament = null;
  gameState.projectiles = {};
  gameState.turrets = {};

  for (const id in gameState.players) {
    gameState.players[id].isSpectator = false;
    gameState.players[id].health = 100;
  }

  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);
}

function startVotingPhase() {
  gameState.status = "VOTING";
  gameState.currentMode = null;
  gameState.voteTimer = 15.0;
  gameState.votes = { ffa: 0, tourney: 0 };
  gameState.votedPlayers = {};
  gameState.winner = null;
  gameState.projectiles = {};
  gameState.turrets = {};
  gameState.activeFighters = [];
  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);

  for (const id in gameState.players) {
    gameState.players[id].isSpectator = false;
  }
}

function resolveVotingPhase() {
  if (Object.keys(gameState.players).length < 2) {
    startWaitingPhase();
    return;
  }

  if (gameState.votes.tourney > gameState.votes.ffa) {
    startTournament();
  } else {
    startFFA();
  }
}

function startFFA() {
  gameState.currentMode = "FFA";
  gameState.status = "FFA";
  gameState.walls = generateRandomMap();
  scheduleBooster();

  for (const id in gameState.players) {
    const player = gameState.players[id];
    player.score = 0;
    player.turretScore = 0;
    player.health = 100;
    player.boostTimer = 0;
    player.isSpectator = false;
    const spawnPos = getValidSpawnPoint();
    player.x = spawnPos.x;
    player.y = spawnPos.y;
  }
}

function startTournament() {
  gameState.currentMode = "TOURNAMENT";
  gameState.status = "TOURNAMENT";

  gameState.tournamentBracket = Object.keys(gameState.players).sort(
    () => Math.random() - 0.5,
  );

  gameState.tournament = {
    matchNumber: 0,
    players: {},
  };

  for (const id in gameState.players) {
    gameState.tournament.players[id] = {
      name: gameState.players[id].name,
      status: "Active",
    };
  }

  startNextTournamentMatch();
}

function startNextTournamentMatch() {
  if (gameState.tournamentBracket.length <= 1) {
    gameState.status = "CELEBRATION";
    gameState.intermissionTimer = 10.0;

    if (gameState.tournamentBracket.length === 1) {
      const winnerId = gameState.tournamentBracket[0];
      gameState.winner = {
        id: winnerId,
        color: gameState.players[winnerId].color,
        name: gameState.players[winnerId].name,
      };
      if (gameState.tournament && gameState.tournament.players[winnerId]) {
        gameState.tournament.players[winnerId].status = "Champion";
      }
    }
    return;
  }

  // [CRITICAL FIX] We MUST tell the game it is out of intermission and back in a match!
  gameState.status = "TOURNAMENT";

  gameState.tournament.matchNumber++;
  const p1 = gameState.tournamentBracket.shift();
  const p2 = gameState.tournamentBracket.shift();
  gameState.activeFighters = [p1, p2];

  gameState.projectiles = {};
  gameState.turrets = {};
  gameState.boosters = {};
  gameState.walls = generateRandomMap();
  scheduleBooster();

  for (const id in gameState.players) {
    const p = gameState.players[id];
    if (id === p1 || id === p2) {
      p.isSpectator = false;
      p.health = 100;
      p.score = 0;
      p.turretScore = 0;
      p.boostTimer = 0;
      const pos = getValidSpawnPoint();
      p.x = pos.x;
      p.y = pos.y;
    } else {
      p.isSpectator = true;
    }
  }
}

wss.on("connection", (ws) => {
  let playerId = null;

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "JOIN") {
      playerId = data.id;
      ws.playerId = playerId;

      // [NEW] If this player is already playing in another tab, kick the old tab!
      if (activeSockets[playerId] && activeSockets[playerId] !== ws) {
        try {
          activeSockets[playerId].send(
            JSON.stringify({
              type: "KICKED",
              reason: "Game opened in another tab",
            }),
          );
          activeSockets[playerId].close();
        } catch (e) {}
      }
      activeSockets[playerId] = ws; // Assign the current tab as the active one

      if (!gameState.players[playerId]) {
        if (Object.keys(gameState.players).length >= 8) {
          ws.send(JSON.stringify({ type: "LOBBY_FULL" }));
          ws.close();
          return;
        }

        if (recentDisconnects[playerId]) {
          gameState.players[playerId] = recentDisconnects[playerId].state;
          gameState.players[playerId].input = {
            w: false,
            a: false,
            s: false,
            d: false,
          };

          if (gameState.currentMode === "TOURNAMENT") {
            gameState.players[playerId].isSpectator = true;
          }

          clearTimeout(recentDisconnects[playerId].timeout);
          delete recentDisconnects[playerId];
        } else {
          if (
            gameState.status !== "VOTING" &&
            gameState.status !== "CELEBRATION" &&
            gameState.status !== "WAITING"
          ) {
            ws.send(JSON.stringify({ type: "MATCH_IN_PROGRESS" }));
            ws.close();
            return;
          }

          const spawnPos = getValidSpawnPoint();
          gameState.players[playerId] = {
            x: spawnPos.x,
            y: spawnPos.y,
            size: 20,
            speed: 200,
            color: data.color,
            name: data.name || "UNKNOWN",
            input: { w: false, a: false, s: false, d: false },
            health: 100,
            score: 0,
            turretScore: 0,
            boostTimer: 0,
            connected: true,
            isSpectator: false,
          };
        }
      } else {
        // [NEW] If the player already exists (tab takeover), just update their name/color
        gameState.players[playerId].name =
          data.name || gameState.players[playerId].name;
        gameState.players[playerId].color =
          data.color || gameState.players[playerId].color;
      }

      ws.send(JSON.stringify({ type: "INIT", id: playerId }));
      return;
    }

    if (!playerId || !gameState.players[playerId]) return;

    if (data.type === "VOTE" && gameState.status === "VOTING") {
      if (gameState.votedPlayers[playerId]) return;

      if (data.choice === "FFA") gameState.votes.ffa++;
      else if (data.choice === "TOURNAMENT") gameState.votes.tourney++;

      gameState.votedPlayers[playerId] = data.choice;
      return;
    }

    if (gameState.players[playerId].isSpectator) return;

    if (data.type === "INPUT") {
      gameState.players[playerId].input = data.keys;
    } else if (data.type === "SHOOT") {
      const player = gameState.players[playerId];
      const dx = data.targetX - player.x;
      const dy = data.targetY - player.y;
      const angle = Math.atan2(dy, dx);
      const anglesToShoot =
        player.boostTimer > 0 ? [angle - 0.2, angle, angle + 0.2] : [angle];

      for (let a of anglesToShoot) {
        gameState.projectiles[projectileIdCounter++] = {
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * 500,
          vy: Math.sin(a) * 500,
          ownerId: playerId,
          lifeSpan: 2.0,
        };
      }
    } else if (data.type === "DROP_TURRET") {
      const player = gameState.players[playerId];

      const requiredKills =
        gameState.currentMode === "TOURNAMENT" ? 1 : TURRET_COST;

      if (player.turretScore >= requiredKills) {
        let hasActiveTurret = false;
        for (let tId in gameState.turrets) {
          if (gameState.turrets[tId].ownerId === playerId)
            hasActiveTurret = true;
        }
        if (!hasActiveTurret) {
          player.turretScore -= requiredKills;

          const turretId = Math.random().toString(36).substr(2, 9);
          gameState.turrets[turretId] = {
            x: player.x,
            y: player.y,
            ownerId: playerId,
            color: player.color,
            range: 125,
            fireRate: 0.5,
            cooldown: 0,
            lifeSpan: 15.0,
          };
        }
      }
    }
  });

  ws.on("close", () => {
    // [NEW] Only trigger the disconnect sequence if the CLOSING tab is the active one
    if (playerId && activeSockets[playerId] === ws) {
      delete activeSockets[playerId];

      if (gameState.players[playerId]) {
        const savedState = { ...gameState.players[playerId] };
        const timeout = setTimeout(() => {
          delete recentDisconnects[playerId];
          for (let tId in gameState.turrets) {
            if (gameState.turrets[tId].ownerId === playerId)
              delete gameState.turrets[tId];
          }
        }, 60000);

        recentDisconnects[playerId] = { state: savedState, timeout: timeout };
        delete gameState.players[playerId];

        if (gameState.votedPlayers[playerId]) {
          if (gameState.votedPlayers[playerId] === "FFA") gameState.votes.ffa--;
          if (gameState.votedPlayers[playerId] === "TOURNAMENT")
            gameState.votes.tourney--;
          delete gameState.votedPlayers[playerId];
        }
      }
    }
  });
});

setInterval(() => {
  const dt = 1 / TICK_RATE;
  const numPlayers = Object.keys(gameState.players).length;

  if (numPlayers < 2 && gameState.status !== "WAITING") {
    startWaitingPhase();
    return;
  } else if (numPlayers >= 2 && gameState.status === "WAITING") {
    startVotingPhase();
    return;
  }

  if (gameState.status === "VOTING") {
    gameState.voteTimer -= dt;
    if (gameState.voteTimer <= 0) {
      resolveVotingPhase();
    }
  } else if (gameState.status === "INTERMISSION") {
    gameState.intermissionTimer -= dt;
    if (gameState.intermissionTimer <= 0) {
      if (gameState.currentMode === "TOURNAMENT") {
        startNextTournamentMatch();
      } else {
        startVotingPhase();
      }
    }
  } else if (gameState.status === "CELEBRATION") {
    gameState.intermissionTimer -= dt;
    if (gameState.intermissionTimer <= 0) {
      startVotingPhase();
    }
  } else if (gameState.status === "FFA" || gameState.status === "TOURNAMENT") {
    if (
      gameState.status === "TOURNAMENT" &&
      gameState.activeFighters.length === 2
    ) {
      const [p1, p2] = gameState.activeFighters;
      const p1Exists = !!gameState.players[p1];
      const p2Exists = !!gameState.players[p2];

      if (!p1Exists || !p2Exists) {
        gameState.status = "INTERMISSION";
        gameState.intermissionTimer = 5.0;

        if (p1Exists) {
          gameState.tournamentBracket.push(p1);
          gameState.winner = {
            name: `${gameState.players[p1].name} wins Match #${gameState.tournament.matchNumber} by forfeit!`,
          };
        }
        if (p2Exists) {
          gameState.tournamentBracket.push(p2);
          gameState.winner = {
            name: `${gameState.players[p2].name} wins Match #${gameState.tournament.matchNumber} by forfeit!`,
          };
        }

        if (!p1Exists && gameState.tournament.players[p1])
          gameState.tournament.players[p1].status = "Eliminated";
        if (!p2Exists && gameState.tournament.players[p2])
          gameState.tournament.players[p2].status = "Eliminated";

        gameState.activeFighters = [];
        return;
      }
    }

    for (const id in gameState.players) {
      const player = gameState.players[id];
      if (player.isSpectator) continue;

      if (player.boostTimer > 0) {
        player.boostTimer -= dt;
        if (player.boostTimer < 0) player.boostTimer = 0;
      }

      let dx = 0;
      let dy = 0;
      if (player.input.w) dy -= 1;
      if (player.input.s) dy += 1;
      if (player.input.a) dx -= 1;
      if (player.input.d) dx += 1;

      if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
      }

      const halfSize = player.size / 2;
      const currentSpeed =
        player.boostTimer > 0 ? player.speed * 1.5 : player.speed;
      const eps = 0.1;

      player.x += dx * currentSpeed * dt;
      for (const wall of gameState.walls) {
        if (
          player.x + halfSize > wall.x + eps &&
          player.x - halfSize < wall.x + wall.w - eps &&
          player.y + halfSize > wall.y + eps &&
          player.y - halfSize < wall.y + wall.h - eps
        ) {
          if (dx > 0) player.x = wall.x - halfSize;
          else if (dx < 0) player.x = wall.x + wall.w + halfSize;
        }
      }

      player.y += dy * currentSpeed * dt;
      for (const wall of gameState.walls) {
        if (
          player.x + halfSize > wall.x + eps &&
          player.x - halfSize < wall.x + wall.w - eps &&
          player.y + halfSize > wall.y + eps &&
          player.y - halfSize < wall.y + wall.h - eps
        ) {
          if (dy > 0) player.y = wall.y - halfSize;
          else if (dy < 0) player.y = wall.y + wall.h + halfSize;
        }
      }

      if (player.x - halfSize < 0) player.x = halfSize;
      if (player.x + halfSize > 800) player.x = 800 - halfSize;
      if (player.y - halfSize < 0) player.y = halfSize;
      if (player.y + halfSize > 600) player.y = 600 - halfSize;

      for (const bId in gameState.boosters) {
        const booster = gameState.boosters[bId];
        const dist = Math.sqrt(
          (player.x - booster.x) ** 2 + (player.y - booster.y) ** 2,
        );
        if (dist < player.size / 2 + booster.size / 2) {
          player.boostTimer = 10.0;
          delete gameState.boosters[bId];
          scheduleBooster();
        }
      }
    }

    for (const tId in gameState.turrets) {
      const turret = gameState.turrets[tId];
      turret.lifeSpan -= dt;
      if (turret.lifeSpan <= 0) {
        delete gameState.turrets[tId];
        continue;
      }
      turret.cooldown -= dt;
      if (turret.cooldown <= 0) {
        let closestEnemy = null;
        let minDistance = turret.range;
        for (const pId in gameState.players) {
          if (pId === turret.ownerId || gameState.players[pId].isSpectator)
            continue;

          const enemy = gameState.players[pId];
          const distX = enemy.x - turret.x;
          const distY = enemy.y - turret.y;
          const distance = Math.sqrt(distX * distX + distY * distY);
          if (distance < minDistance) {
            minDistance = distance;
            closestEnemy = enemy;
          }
        }
        if (closestEnemy) {
          const aimX = closestEnemy.x - turret.x;
          const aimY = closestEnemy.y - turret.y;
          const angle = Math.atan2(aimY, aimX);
          gameState.projectiles[projectileIdCounter++] = {
            x: turret.x,
            y: turret.y,
            vx: Math.cos(angle) * 500,
            vy: Math.sin(angle) * 500,
            ownerId: turret.ownerId,
            lifeSpan: 1.0,
          };
          turret.cooldown = turret.fireRate;
        }
      }
    }

    for (const pId in gameState.projectiles) {
      const bullet = gameState.projectiles[pId];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.lifeSpan -= dt;

      if (bullet.lifeSpan <= 0) {
        delete gameState.projectiles[pId];
        continue;
      }

      let hitWall = false;
      for (const wall of gameState.walls) {
        if (
          bullet.x > wall.x &&
          bullet.x < wall.x + wall.w &&
          bullet.y > wall.y &&
          bullet.y < wall.y + wall.h
        ) {
          hitWall = true;
          break;
        }
      }
      if (hitWall) {
        delete gameState.projectiles[pId];
        continue;
      }

      for (const playerId in gameState.players) {
        if (
          playerId === bullet.ownerId ||
          gameState.players[playerId].isSpectator
        )
          continue;

        const target = gameState.players[playerId];
        const halfSize = target.size / 2;

        if (
          bullet.x > target.x - halfSize &&
          bullet.x < target.x + halfSize &&
          bullet.y > target.y - halfSize &&
          bullet.y < target.y + halfSize
        ) {
          target.health -= 25;
          delete gameState.projectiles[pId];

          if (target.health <= 0) {
            if (gameState.players[bullet.ownerId]) {
              const attacker = gameState.players[bullet.ownerId];
              attacker.score += 1;
              attacker.turretScore += 1;

              if (
                gameState.currentMode === "FFA" &&
                attacker.score >= FFA_WIN_SCORE &&
                gameState.status === "FFA"
              ) {
                gameState.status = "INTERMISSION";
                gameState.intermissionTimer = 5.0;
                gameState.winner = {
                  id: bullet.ownerId,
                  color: attacker.color,
                  name: attacker.name,
                };
              } else if (
                gameState.currentMode === "TOURNAMENT" &&
                attacker.score >= TOURNAMENT_WIN_SCORE &&
                gameState.status === "TOURNAMENT"
              ) {
                gameState.status = "INTERMISSION";
                gameState.intermissionTimer = 5.0;
                gameState.tournamentBracket.push(bullet.ownerId);
                gameState.activeFighters = [];

                gameState.tournament.players[bullet.ownerId].status = "Active";
                gameState.tournament.players[playerId].status = "Eliminated";
                gameState.winner = {
                  name: `${attacker.name} wins Match #${gameState.tournament.matchNumber}!`,
                };
              }
            }

            const respawnPos = getValidSpawnPoint();
            target.x = respawnPos.x;
            target.y = respawnPos.y;
            target.health = 100;
            target.score = 0;
            target.turretScore = 0;
            target.boostTimer = 0;
          }
          break;
        }
      }
    }
  }

  const statePacket = JSON.stringify({
    type: "STATE_UPDATE",
    state: gameState,
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(statePacket);
  });
}, 1000 / TICK_RATE);
