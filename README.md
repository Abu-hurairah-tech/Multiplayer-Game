<div align="center">

# 🎯 Canvas Arena Shooter

**A hyper-fast, real-time multiplayer arena shooter built from scratch.**

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#)
[![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](#)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](#)

*Procedural maps, buttery-smooth client interpolation, and bulletproof server authority.*

---

</div>

## ✨ Features

### ⚔️ Dynamic Game Modes
* **Free-For-All (FFA):** Pure chaos. The first player to reach 15 kills claims victory.
* **Tournament Bracket:** A fully automated, 1v1 single-elimination system. Waiting players are automatically transitioned into a live spectator mode.

### 🗺️ Procedural Generation
Say goodbye to static levels. The arena's obstacles and walls are **procedurally generated** at the start of every single match, forcing players to constantly adapt their lines of sight and movement strategies.

### 🛠️ Tactical Combat
* **Turret Economy:** Earn "Turret Score" by securing kills. Spend it to deploy auto-aiming turrets that lock down map zones and suppress enemies.
* **Power-Ups:** Scramble for randomly spawning boosters that grant a massive temporary speed boost and a devastating triple-shot spread.

---

## 🧠 Technical Architecture

This project was built to master real-time multiplayer networking. It features a completely custom authoritative server architecture.

> **Server Authority & State:** 
> The Node.js server runs a strict 60Hz tick rate. It calculates all physics, collision, and logic, preventing any client-side manipulation.

> **Bulletproof Connections:** 
> Features advanced WebSocket state management including **tab-takeover protection** (preventing multi-tab cloning), **auto-reconnection grace periods**, and instant entity purging to prevent "ghost" players.

> **Client Smoothing (Lerp):** 
> The frontend utilizes linear interpolation and `requestAnimationFrame` to ensure rendering stays flawless and jitter-free, even when network latency fluctuates.

---

## 💻 Tech Stack

| Domain | Technology |
| :--- | :--- |
| **Backend** | Node.js, `ws` (WebSockets) |
| **Frontend** | Vanilla JavaScript, HTML5 Canvas, CSS3 |
| **Audio** | Web Audio API (Synthesized Sound Effects) |

---

## 🚀 Getting Started

Want to run the arena locally? Follow these steps:

### 1. Clone the Repository
```bash
git clone [https://github.com/yourusername/canvas-arena-shooter.git](https://github.com/yourusername/canvas-arena-shooter.git)
cd canvas-arena-shooter