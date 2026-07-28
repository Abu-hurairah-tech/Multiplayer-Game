const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 3000 });

// Procedural map generation
function generateRandomMap() {
  const walls = [];
  const numWalls = 4 + Math.floor(Math.random() * 4); // 4 to 7 walls

  for (let i = 0; i < numWalls; i++) {
    // 50/50 chance for horizontal or vertical wall
    const isVertical = Math.random() > 0.5;
    const w = isVertical ? 40 : 100 + Math.random() * 200;
    const h = isVertical ? 100 + Math.random() * 200 : 40;

    // Keep walls away from the absolute edges to prevent spawn trapping
    const x = 50 + Math.random() * (800 - w - 100);
    const y = 50 + Math.random() * (600 - h - 100);

    walls.push({ x, y, w, h });
  }
  return walls;
}

const gameState = {
  status: "PLAYING",
  winner: null,
  intermissionTimer: 0,
  players: {},
  projectiles: {},
  walls: generateRandomMap(),
  turrets: {},
  boosters: {},
};

// Temporary memory for players who disconnect or refresh
const recentDisconnects = {};

let projectileIdCounter = 0;
let boosterIdCounter = 0;

// NEW: Booster timers for the single-booster cycle
let boosterSpawnTimer = null;
let boosterDespawnTimer = null;

const TICK_RATE = 30;
const TURRET_COST = 3;
const WIN_SCORE = 15;

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

// NEW: Automated Booster Cycle
function scheduleBooster() {
  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);

  // Clear any existing boosters just in case
  gameState.boosters = {};

  // 1. Wait 20 seconds, then spawn a booster
  boosterSpawnTimer = setTimeout(() => {
    const pos = getValidSpawnPoint();
    gameState.boosters[boosterIdCounter++] = {
      x: pos.x,
      y: pos.y,
      size: 16,
    };
    console.log("Booster spawned!");

    // 2. If it sits there for 10 seconds uncollected, make it disappear
    boosterDespawnTimer = setTimeout(() => {
      gameState.boosters = {};
      console.log("Booster despawned. Scheduling next one...");
      scheduleBooster(); // Restart the cycle
    }, 10000); // 10 seconds lifespan
  }, 20000); // 20 seconds between spawns
}

// Start the first booster cycle
scheduleBooster();

function resetMatch() {
  gameState.status = "PLAYING";
  gameState.winner = null;
  gameState.projectiles = {};
  gameState.turrets = {};
  gameState.boosters = {};
  gameState.walls = generateRandomMap();

  scheduleBooster(); // Restart booster cycle for new match

  for (const id in gameState.players) {
    const player = gameState.players[id];
    player.score = 0;
    player.health = 100;
    player.boostTimer = 0;
    const spawnPos = getValidSpawnPoint();
    player.x = spawnPos.x;
    player.y = spawnPos.y;
  }
}

wss.on("connection", (ws) => {
  let playerId = null; // Track this specific WebSocket's player ID

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    // 1. Handle the Session Handshake
    if (data.type === "JOIN") {
      playerId = data.id;

      if (!gameState.players[playerId]) {
        // Enforce the 8-player maximum limit
        if (Object.keys(gameState.players).length >= 8) {
          // Make sure this is 8, not 3!
          console.log(`Connection rejected: Lobby is full.`);
          ws.send(JSON.stringify({ type: "LOBBY_FULL" }));
          ws.close();
          return;
        }

        // Check if this player recently disconnected
        if (recentDisconnects[playerId]) {
          console.log(`Player ${playerId} reconnected. Restoring state.`);
          // Restore their old position, health, and score
          gameState.players[playerId] = recentDisconnects[playerId].state;
          gameState.players[playerId].input = {
            w: false,
            a: false,
            s: false,
            d: false,
          };

          // Clear their deletion timer so they aren't erased
          clearTimeout(recentDisconnects[playerId].timeout);
          delete recentDisconnects[playerId];
        } else {
          // Brand new player - spawn randomly
          const spawnPos = getValidSpawnPoint();
          gameState.players[playerId] = {
            x: spawnPos.x,
            y: spawnPos.y,
            size: 20,
            speed: 200,
            color: data.color,
            name: data.name || "UNKNOWN", // NEW: Save the player's name
            input: { w: false, a: false, s: false, d: false },
            health: 100,
            score: 0,
            boostTimer: 0,
            connected: true,
          };
        }
      }

      ws.send(JSON.stringify({ type: "INIT", id: playerId }));
      return;
    }

    if (gameState.status !== "PLAYING" || !playerId) return;

    const player = gameState.players[playerId];
    if (!player) return;

    // 2. Handle standard inputs using the stored playerId
    if (data.type === "INPUT") {
      player.input = data.keys;
    } else if (data.type === "SHOOT") {
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
      // Must have achieved 3 kills to unlock the turret
      if (player.score >= TURRET_COST) {
        // Prevent infinite spam: Check if they ALREADY have a turret on the map
        let hasActiveTurret = false;
        for (let tId in gameState.turrets) {
          if (gameState.turrets[tId].ownerId === playerId) {
            hasActiveTurret = true;
            break;
          }
        }

        // Only place it if they don't have one active
        if (!hasActiveTurret) {
          const turretId = Math.random().toString(36).substr(2, 9);
          gameState.turrets[turretId] = {
            x: player.x,
            y: player.y,
            ownerId: playerId,
            color: player.color,

            // CHANGED: Reduced from 250 down to 125 for better arena balance
            range: 125,

            fireRate: 0.5,
            cooldown: 0,
            lifeSpan: 15.0,
          };
          // SCORE IS NO LONGER SUBTRACTED HERE
        }
      }
    }
  });

  ws.on("close", () => {
    if (playerId && gameState.players[playerId]) {
      // 1. Copy their exact current state (position, health, etc.)
      const savedState = { ...gameState.players[playerId] };

      // 2. Start a 60-second timer. If they don't return, permanently delete them.
      const timeout = setTimeout(() => {
        delete recentDisconnects[playerId];

        // Clean up their turrets ONLY when they are permanently gone
        for (let tId in gameState.turrets) {
          if (gameState.turrets[tId].ownerId === playerId) {
            delete gameState.turrets[tId];
          }
        }
        console.log(`Player ${playerId} memory wiped after 60 seconds.`);
      }, 60000); // 60,000 milliseconds = 60 seconds

      // 3. Save the state and the timer into our temporary cache
      recentDisconnects[playerId] = {
        state: savedState,
        timeout: timeout,
      };

      // 4. Delete from the active game to immediately free up the lobby slot!
      delete gameState.players[playerId];
      console.log(
        `Player ${playerId} disconnected. State saved for 60s. Slot freed.`,
      );
    }
  });
});

setInterval(() => {
  const dt = 1 / TICK_RATE;

  if (gameState.status === "INTERMISSION") {
    gameState.intermissionTimer -= dt;
    if (gameState.intermissionTimer <= 0) {
      resetMatch();
    }
  } else if (gameState.status === "PLAYING") {
    // 1. Move Players
    for (const id in gameState.players) {
      const player = gameState.players[id];

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

      // X Movement & Collision
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

      // Y Movement & Collision
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

      // Check Booster Pickups
      for (const bId in gameState.boosters) {
        const booster = gameState.boosters[bId];
        const dist = Math.sqrt(
          (player.x - booster.x) ** 2 + (player.y - booster.y) ** 2,
        );

        if (dist < player.size / 2 + booster.size / 2) {
          player.boostTimer = 10.0;
          delete gameState.boosters[bId];

          // NEW: Restart the spawn cycle immediately upon collection
          scheduleBooster();
        }
      }
    }

    // 2. Turret Logic
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
          if (pId === turret.ownerId) continue;
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

    // 3. Projectiles & Hit Registration
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
        if (playerId === bullet.ownerId) continue;
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

              if (attacker.score >= WIN_SCORE) {
                gameState.status = "INTERMISSION";
                gameState.intermissionTimer = 5.0;
                gameState.winner = {
                  id: bullet.ownerId,
                  color: attacker.color,
                };
              }
            }

            const respawnPos = getValidSpawnPoint();
            target.x = respawnPos.x;
            target.y = respawnPos.y;
            target.health = 100;
            target.score = 0;
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
