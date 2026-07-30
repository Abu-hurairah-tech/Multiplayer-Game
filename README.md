<div align="center">

# 🎯 Canvas Arena Shooter

**A hyper-fast, real-time multiplayer arena shooter built from scratch.**

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#)
[![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](#)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](#)

*Procedural maps, buttery-smooth client interpolation, and bulletproof server authority.*

**[🚀 PLAY THE LIVE DEMO NOW](https://abu-hurairah-tech.github.io/Multiplayer-Game/)**

---

</div>

## ✨ Features

### ⚔️ Dynamic Game Modes
* **Free-For-All (FFA):** Pure chaos. The first player to reach 15 kills claims victory.
* **Tournament Bracket:** A fully automated, 1v1 single-elimination system. Waiting players are automatically transitioned into a live spectator mode with a live standings HUD.

### 💥 Audio-Visual Polish
* **Kinetic Particle System:** Enemies shatter into dynamically generated, physics-based particle explosions upon elimination.
* **Retro Synthesizer Audio:** A completely custom, zero-dependency sound engine utilizing the **Web Audio API** to procedurally generate 8-bit sound effects (lasers, hits, explosions, and victory fanfares) in real-time.

### 🗺️ Procedural Generation
Say goodbye to static levels. The arena's obstacles and walls are **procedurally generated** at the start of every single match, forcing players to constantly adapt their lines of sight and movement strategies.

### 🛠️ Tactical Combat
* **Turret Economy:** Earn "Turret Score" by securing kills. Spend it to deploy auto-aiming turrets that lock down map zones and suppress enemies.
* **Power-Ups:** Scramble for randomly spawning boosters that grant a massive temporary speed boost and a devastating triple-shot spread.

---

## 🧠 Technical Architecture

This project was built to master real-time multiplayer networking. It features a completely custom authoritative server architecture and a highly modularized, strictly documented codebase.

> **Server Authority & State:** 
> The Node.js server runs a strict 60Hz tick rate. It calculates all physics, collision, and logic, preventing any client-side manipulation.

> **Bulletproof Connections:** 
> Features advanced WebSocket state management including **tab-takeover protection** (preventing multi-tab cloning), **auto-reconnection grace periods**, and instant entity purging to prevent "ghost" frames.

> **Client Smoothing (Lerp):** 
> The frontend utilizes linear interpolation and `requestAnimationFrame` to ensure rendering stays flawless and jitter-free, even when network latency fluctuates.

---

## 💻 Tech Stack & Deployment

| Domain | Technology | Hosting |
| :--- | :--- | :--- |
| **Backend** | Node.js, `ws` (WebSockets) | ☁️ **Render** (`wss://` secure layer) |
| **Frontend** | Vanilla JavaScript, HTML5 Canvas, CSS3 | 🌐 **GitHub Pages** |
| **Audio/VFX**| Web Audio API, Custom Canvas Particle Engine | Client-Side |

---

## 🚀 Getting Started

### Play Online
Simply visit the [Live Deployment](https://abu-hurairah-tech.github.io/Multiplayer-Game/) to jump into the arena.

### Run Locally (Development)
Want to run the arena locally to modify the code? Follow these steps:

**1. Clone the Repository**
```bash
git clone [https://github.com/Abu-hurairah-tech/Multiplayer-Game.git](https://github.com/Abu-hurairah-tech/Multiplayer-Game.git)
cd Multiplayer-Game