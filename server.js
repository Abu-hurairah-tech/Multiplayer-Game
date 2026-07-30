/**
 * ============================================================================
 * CANVAS ARENA SHOOTER - AUTHORITATIVE SERVER
 * ============================================================================
 * Architecture:
 * 1. Setup & Constants     - Server initialization and game balancing values.
 * 2. Global State          - Central source of truth for all players and entities.
 * 3. World & Spawning      - Procedural map generation and safe spawn logic.
 * 4. Game Phase Management - Transitions between Waiting, Voting, and matches.
 * 5. Network Handlers      - Processing incoming client messages (Join, Input, Quit).
 * 6. Core Game Loop        - 60Hz loop handling physics, collision, and combat.
 * ============================================================================
 */

// ============================================================================
// [ SECTION 1: SETUP & CONSTANTS ]
// ============================================================================

const WebSocket = require("ws");

// Initialize Render-compatible port and WebSocket server
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server started on port ${PORT}`);

// Game Balancing Constants
const TICK_RATE = 60; // Server updates per second
const TURRET_COST = 3; // Kills required to deploy a turret (FFA)
const FFA_WIN_SCORE = 15; // Score limit for Free-For-All mode
const TOURNAMENT_WIN_SCORE = 3; // Score limit for individual Tournament matches

// ============================================================================
// [ SECTION 2: GLOBAL STATE & TRACKERS ]
// ============================================================================

/**
 * The Master Game State
 * This object is serialized and broadcasted to all clients 60 times a second.
 */
const gameState = {
  status: "WAITING", // Current phase (WAITING, VOTING, FFA, TOURNAMENT, INTERMISSION, CELEBRATION)
  currentMode: null, // Selected game mode
  winner: null, // Holds data for the winner of a match/tournament
  intermissionTimer: 0, // Countdown between matches
  voteTimer: 15.0, // Countdown for mode voting
  votes: { ffa: 0, tourney: 0 },
  votedPlayers: {}, // Tracks who has voted to prevent double voting

  tournamentBracket: [], // Queue of players waiting to fight
  activeFighters: [], // The two players currently in the arena
  tournament: null, // Overall tournament metadata and standings

  players: {}, // Dictionary of all connected players
  projectiles: {}, // Dictionary of active bullets
  walls: generateRandomMap(), // Current map layout
  turrets: {}, // Active deployed turrets
  boosters: {}, // Active power-ups on the map
};

// Server Management Trackers (Not sent to clients)
const recentDisconnects = {}; // Grace period tracker for fast reconnects
const activeSockets = {}; // Maps player IDs to their active WebSocket connection (prevents multi-tabbing)

// Entity ID Counters
let projectileIdCounter = 0;
let boosterIdCounter = 0;

// Timers for Power-up drops
let boosterSpawnTimer = null;
let boosterDespawnTimer = null;

// ============================================================================
// [ SECTION 3: WORLD GENERATION & HELPERS ]
// ============================================================================

/**
 * Procedurally generates 4 to 7 rectangular walls of varying orientations.
 * @returns {Array} Array of wall objects {x, y, w, h}
 */
function generateRandomMap() {
  const walls = [];
  const numWalls = 4 + Math.floor(Math.random() * 4);

  for (let i = 0; i < numWalls; i++) {
    const isVertical = Math.random() > 0.5;
    const w = isVertical ? 40 : 100 + Math.random() * 200;
    const h = isVertical ? 100 + Math.random() * 200 : 40;

    // Keep walls away from the absolute edges
    const x = 50 + Math.random() * (800 - w - 100);
    const y = 50 + Math.random() * (600 - h - 100);

    walls.push({ x, y, w, h });
  }
  return walls;
}

/**
 * Finds a safe coordinate to spawn a player or item.
 * Ensures the point is not inside a wall and not too close to active enemies.
 * @returns {Object} Safe {x, y} coordinates
 */
function getValidSpawnPoint() {
  const MAX_ATTEMPTS = 50;
  const SAFE_DISTANCE = 60;
  const PLAYER_SIZE = 20;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const testX = Math.random() * (800 - 40) + 20;
    const testY = Math.random() * (600 - 40) + 20;
    let isSafe = true;

    // 1. Check Wall Collisions
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

    // 2. Check Proximity to other active players
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

    // If it passed all tests, return it
    if (isSafe) return { x: testX, y: testY };
  }

  // Fallback if map is completely clustered
  return { x: 400, y: 50 };
}

/** Handles the cyclical spawning and despawning of speed boosters */
function scheduleBooster() {
  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);
  gameState.boosters = {};

  // Wait 20 seconds, then spawn a booster
  boosterSpawnTimer = setTimeout(() => {
    const pos = getValidSpawnPoint();
    gameState.boosters[boosterIdCounter++] = { x: pos.x, y: pos.y, size: 16 };

    // Booster disappears after 10 seconds if not collected
    boosterDespawnTimer = setTimeout(() => {
      gameState.boosters = {};
      scheduleBooster(); // Restart cycle
    }, 10000);
  }, 20000);
}

// ============================================================================
// [ SECTION 4: GAME PHASE MANAGEMENT ]
// ============================================================================

/** Resets the lobby to wait for at least 2 players */
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

  // Un-spectate everyone and heal them for the lobby
  for (const id in gameState.players) {
    gameState.players[id].isSpectator = false;
    gameState.players[id].health = 100;
  }

  clearTimeout(boosterSpawnTimer);
  clearTimeout(boosterDespawnTimer);
}

/** Initiates the 15-second voting period */
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

/** Evaluates votes and launches the selected mode */
function resolveVotingPhase() {
  if (Object.keys(gameState.players).length < 2) {
    startWaitingPhase(); // Abort if someone left during voting
    return;
  }
  if (gameState.votes.tourney > gameState.votes.ffa) {
    startTournament();
  } else {
    startFFA();
  }
}

/** Initializes Free-For-All mode and spawns all players */
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

/** Initializes Tournament metadata and creates the bracket */
function startTournament() {
  gameState.currentMode = "TOURNAMENT";
  gameState.status = "TOURNAMENT";

  // Shuffle players into a random bracket
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

/** Pulls the next 2 players from the bracket and sets up the arena */
function startNextTournamentMatch() {
  // Check if tournament is over
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

  // Setup Next Match
  gameState.status = "TOURNAMENT";
  gameState.tournament.matchNumber++;

  const p1 = gameState.tournamentBracket.shift();
  const p2 = gameState.tournamentBracket.shift();
  gameState.activeFighters = [p1, p2];

  // Reset Arena
  gameState.projectiles = {};
  gameState.turrets = {};
  gameState.boosters = {};
  gameState.walls = generateRandomMap();
  scheduleBooster();

  // Setup Players (Fighters spawn, everyone else spectates)
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

// ============================================================================
// [ SECTION 5: WEBSOCKET EVENT HANDLERS ]
// ============================================================================

wss.on("connection", (ws) => {
  let playerId = null; // Local scope variable tied to this specific connection

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    // --- 1. HARD QUIT LOGIC ---
    if (data.type === "QUIT") {
      const targetId = data.id || playerId;

      if (targetId && gameState.players[targetId]) {
        if (activeSockets[targetId] === ws) delete activeSockets[targetId];
        delete gameState.players[targetId]; // WIPE IMMEDIATELY

        // Clean up their entities and votes
        for (let tId in gameState.turrets) {
          if (gameState.turrets[tId].ownerId === targetId)
            delete gameState.turrets[tId];
        }
        if (gameState.votedPlayers[targetId]) {
          if (gameState.votedPlayers[targetId] === "FFA") gameState.votes.ffa--;
          if (gameState.votedPlayers[targetId] === "TOURNAMENT")
            gameState.votes.tourney--;
          delete gameState.votedPlayers[targetId];
        }
        if (recentDisconnects[targetId]) {
          clearTimeout(recentDisconnects[targetId].timeout);
          delete recentDisconnects[targetId];
        }

        playerId = null;
        ws.playerId = null;
      }
      return;
    }

    // --- 2. JOIN LOGIC ---
    if (data.type === "JOIN") {
      playerId = data.id;
      ws.playerId = data.id;

      // Kick old tabs to prevent duping
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
      activeSockets[playerId] = ws;

      if (!gameState.players[playerId]) {
        // Enforce max capacity
        if (Object.keys(gameState.players).length >= 8) {
          ws.send(JSON.stringify({ type: "LOBBY_FULL" }));
          ws.close();
          return;
        }

        // Reconnect logic if they recently dropped
        if (recentDisconnects[playerId]) {
          gameState.players[playerId] = recentDisconnects[playerId].state;
          gameState.players[playerId].input = {
            w: false,
            a: false,
            s: false,
            d: false,
          };
          gameState.players[playerId].name =
            data.name || gameState.players[playerId].name;
          gameState.players[playerId].color =
            data.color || gameState.players[playerId].color;
          if (gameState.currentMode === "TOURNAMENT")
            gameState.players[playerId].isSpectator = true;

          clearTimeout(recentDisconnects[playerId].timeout);
          delete recentDisconnects[playerId];
        } else {
          // New Player Join validation
          if (
            gameState.status !== "VOTING" &&
            gameState.status !== "CELEBRATION" &&
            gameState.status !== "WAITING"
          ) {
            ws.send(JSON.stringify({ type: "MATCH_IN_PROGRESS" }));
            ws.close();
            return;
          }

          // Create new player entity
          const spawnPos = getValidSpawnPoint();
          gameState.players[playerId] = {
            id: playerId,
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
        // Tab takeover - update UI aesthetics for existing entity
        gameState.players[playerId].name =
          data.name || gameState.players[playerId].name;
        gameState.players[playerId].color =
          data.color || gameState.players[playerId].color;
      }

      ws.send(JSON.stringify({ type: "INIT", id: playerId }));
      return;
    }

    if (!playerId || !gameState.players[playerId]) return;

    // --- 3. VOTING LOGIC ---
    if (data.type === "VOTE" && gameState.status === "VOTING") {
      if (gameState.votedPlayers[playerId]) return; // Prevent double voting
      if (data.choice === "FFA") gameState.votes.ffa++;
      else if (data.choice === "TOURNAMENT") gameState.votes.tourney++;
      gameState.votedPlayers[playerId] = data.choice;
      return;
    }

    // Ignore combat inputs if spectating
    if (gameState.players[playerId].isSpectator) return;

    // --- 4. GAMEPLAY INPUTS ---
    if (data.type === "INPUT") {
      gameState.players[playerId].input = data.keys;
    } else if (data.type === "SHOOT") {
      const player = gameState.players[playerId];
      const dx = data.targetX - player.x;
      const dy = data.targetY - player.y;
      const angle = Math.atan2(dy, dx);

      // Triple shot if boosted
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

  // --- 5. DISCONNECT LOGIC ---
  ws.on("close", () => {
    const targetId = ws.playerId;

    if (targetId && gameState.players[targetId]) {
      // Save state to allow seamless reconnection if they accidentally close tab
      recentDisconnects[targetId] = {
        state: JSON.parse(JSON.stringify(gameState.players[targetId])),
        timeout: setTimeout(() => {
          delete recentDisconnects[targetId];
        }, 60000), // 1 minute grace period
      };

      delete gameState.players[targetId];
      delete activeSockets[targetId];

      // Remove their vote if they disconnect during voting
      if (gameState.votedPlayers[targetId]) {
        if (gameState.votedPlayers[targetId] === "FFA") gameState.votes.ffa--;
        if (gameState.votedPlayers[targetId] === "TOURNAMENT")
          gameState.votes.tourney--;
        delete gameState.votedPlayers[targetId];
      }
    }
  });
});

// ============================================================================
// [ SECTION 6: CORE GAME LOOP (60Hz) ]
// ============================================================================

setInterval(() => {
  const dt = 1 / TICK_RATE;
  const numPlayers = Object.keys(gameState.players).length;

  // --- 1. LOBBY PHASE MANAGEMENT ---
  if (numPlayers < 2 && gameState.status !== "WAITING") {
    startWaitingPhase();
    return;
  } else if (numPlayers >= 2 && gameState.status === "WAITING") {
    startVotingPhase();
    return;
  }

  // Handle Timers
  if (gameState.status === "VOTING") {
    gameState.voteTimer -= dt;
    if (gameState.voteTimer <= 0) resolveVotingPhase();
  } else if (gameState.status === "INTERMISSION") {
    gameState.intermissionTimer -= dt;
    if (gameState.intermissionTimer <= 0) {
      if (gameState.currentMode === "TOURNAMENT") startNextTournamentMatch();
      else startVotingPhase();
    }
  } else if (gameState.status === "CELEBRATION") {
    gameState.intermissionTimer -= dt;
    if (gameState.intermissionTimer <= 0) startVotingPhase();
  }

  // --- 2. ACTIVE GAMEPLAY LOGIC ---
  else if (gameState.status === "FFA" || gameState.status === "TOURNAMENT") {
    // Check for forfeits in tournament (someone disconnected mid-fight)
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

    // --- 2a. Player Movement & Physics ---
    for (const id in gameState.players) {
      const player = gameState.players[id];
      if (player.isSpectator) continue;

      // Handle Boost duration
      if (player.boostTimer > 0) {
        player.boostTimer -= dt;
        if (player.boostTimer < 0) player.boostTimer = 0;
      }

      // Calculate direction vector based on input
      let dx = 0;
      let dy = 0;
      if (player.input.w) dy -= 1;
      if (player.input.s) dy += 1;
      if (player.input.a) dx -= 1;
      if (player.input.d) dx += 1;

      // Normalize diagonal movement speed
      if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
      }

      const halfSize = player.size / 2;
      const currentSpeed =
        player.boostTimer > 0 ? player.speed * 1.5 : player.speed;
      const eps = 0.1; // Small buffer to prevent getting stuck in walls

      // Process X Movement & Wall Collisions
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

      // Process Y Movement & Wall Collisions
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

      // Map Bounds Collision
      if (player.x - halfSize < 0) player.x = halfSize;
      if (player.x + halfSize > 800) player.x = 800 - halfSize;
      if (player.y - halfSize < 0) player.y = halfSize;
      if (player.y + halfSize > 600) player.y = 600 - halfSize;

      // Check Booster Power-up Pickup
      for (const bId in gameState.boosters) {
        const booster = gameState.boosters[bId];
        const dist = Math.sqrt(
          (player.x - booster.x) ** 2 + (player.y - booster.y) ** 2,
        );
        if (dist < player.size / 2 + booster.size / 2) {
          player.boostTimer = 10.0;
          delete gameState.boosters[bId];
          scheduleBooster(); // Start timer for next booster drop
        }
      }
    }

    // --- 2b. Turret AI Logic ---
    for (const tId in gameState.turrets) {
      const turret = gameState.turrets[tId];
      turret.lifeSpan -= dt;
      if (turret.lifeSpan <= 0) {
        delete gameState.turrets[tId];
        continue;
      }

      turret.cooldown -= dt;
      if (turret.cooldown <= 0) {
        // Find closest valid enemy
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

        // Fire if enemy in range
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

    // --- 2c. Projectile Physics & Damage Logic ---
    for (const pId in gameState.projectiles) {
      const bullet = gameState.projectiles[pId];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.lifeSpan -= dt;

      // Projectile Timeout
      if (bullet.lifeSpan <= 0) {
        delete gameState.projectiles[pId];
        continue;
      }

      // Projectile vs Wall Collision
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

      // Projectile vs Player Collision
      for (const playerId in gameState.players) {
        // Bullets don't hurt the person who shot them (or spectators)
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
          target.health -= 25; // Apply Damage
          delete gameState.projectiles[pId]; // Destroy Bullet

          // Check if target died
          if (target.health <= 0) {
            if (gameState.players[bullet.ownerId]) {
              const attacker = gameState.players[bullet.ownerId];
              attacker.score += 1;
              attacker.turretScore += 1;

              // Check FFA Win Condition
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
              }
              // Check Tournament Win Condition
              else if (
                gameState.currentMode === "TOURNAMENT" &&
                attacker.score >= TOURNAMENT_WIN_SCORE &&
                gameState.status === "TOURNAMENT"
              ) {
                gameState.status = "INTERMISSION";
                gameState.intermissionTimer = 5.0;
                gameState.tournamentBracket.push(bullet.ownerId); // Winner goes to back of line
                gameState.activeFighters = [];

                gameState.tournament.players[bullet.ownerId].status = "Active";
                gameState.tournament.players[playerId].status = "Eliminated";
                gameState.winner = {
                  name: `${attacker.name} wins Match #${gameState.tournament.matchNumber}!`,
                };
              }
            }

            // Respawn killed player
            const respawnPos = getValidSpawnPoint();
            target.x = respawnPos.x;
            target.y = respawnPos.y;
            target.health = 100;
            target.score = Math.max(0, target.score - 1);
            target.turretScore = Math.max(0, target.turretScore - 1);
            target.boostTimer = 0;
          }
          break; // Stop checking other players for this bullet
        }
      }
    }
  }

  // --- 3. STATE BROADCAST ---
  // Send the updated snapshot to all connected clients
  const statePacket = JSON.stringify({
    type: "STATE_UPDATE",
    state: gameState,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(statePacket);
  });
}, 1000 / TICK_RATE);
