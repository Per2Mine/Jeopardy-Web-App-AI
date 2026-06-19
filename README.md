# Jeopardy Web App 🎓🎮

An interactive, real-time Jeopardy multiplayer game built with Angular 19, Node.js, TailwindCSS 4, and PeerJS. It features full game orchestration, buzzer system, scoreboards, character counters, custom avatar creators, and a lobby chat.

Designed to work seamlessly on any network config through a robust, zero-configuration P2P connection layer.

---

## 🚀 Key Features

*   **P2P Multiplayer Engine (WebRTC)**: Real-time, peer-to-peer data channel synchronization for ultra-low latency buzzer locks and gameplay updates.
*   **Transparent HTTP Relay Fallback**: Automatically and silently falls back to an HTTP Long-Polling relay after 3 seconds if WebRTC ICE negotiations fail (essential for restrictive corporate profiles, VPNs, or firewalls).
*   **Multi-Board Campaigns (Up to 3 Rounds)**: Lobby hosts can queue up to 3 quizzes in a custom order. The game seamlessly transitions across rounds with scores carried over, allowing full-length multiplayer tournaments.
*   **Customizable Points System**: Customize points dynamically per category row (clamped from 0 to 10,000 $) instead of standard fixed intervals.
*   **Comprehensive Quiz Creator & Draft Saving**: Create and save quizzes, complete with rich character validation. Save unfinished quizzes as drafts to finish editing them later.
*   **Dynamic Web Audio Synthesizer**: Immersive gameplay sound effects synthesized natively via the Web Audio API (no external asset downloads). Features a hover settings widget to toggle sound muting and volume control.
*   **High-Resolution UI Scaling (2K & 4K)**: Screen-space scaling optimized for standard HD as well as 2K/4K monitors to keep the board fully visible and legible in large venues.
*   **Enhanced Image Uploads (Up to 5MB)**: Supports crisp, high-resolution graphics for quiz questions, leveraging a backend optimized for up to 50MB JSON payloads.
*   **Self-Service Account Recovery & Deletion**:
    *   *Password Recovery*: Local account restore powered by custom security questions and answers (no SMTP server setup needed).
    *   *Account Deletion*: Users can permanently delete their accounts from the settings panel, initiating a cascade deletion of their created quizzes from the database.
*   **Custom Danger & Confirmation Modals**: Standard browser `confirm()` prompts are replaced with premium, dark-themed glassmorphism confirmation dialogs matching the game's aesthetic.
*   **Input Validation & Security Hardening**: Comprehensive validation checks on both frontend and backend against profanity, illegal characters, and excessively long inputs. Fully protected by rate-limiting middleware.
*   **Custom Avatar Creator**: Vector avatar customizer letting players personalize their lobby representation with multiple body shapes, eyes, mouths, accessories, and colors.
*   **Real-time Lobby Chat**: Global chat integrated directly into the room lobbies with custom avatars, tags (e.g., *Host* badge), and unread notifications.
*   **Host Control Panel**: Dedicated view for game hosts to control active questions, lock/unlock buzzers, reward or deduct points, and manage game progression.
*   **Interactive Buzzers**: Simultaneous buzzers with a lockout mechanism that highlights the first player to buzz in with millisecond precision.
*   **Round-Robin Selector**: Smart, automated turn distribution ensuring every player gets an equal chance to pick the next category and question.

---

## 🛠️ Tech Stack

*   **Frontend**:
    *   **Framework**: [Angular 19](https://angular.dev/) (Standalone Components, Signals API)
    *   **Styling**: [TailwindCSS 4](https://tailwindcss.com/) & PostCSS
    *   **Real-time Protocol**: [PeerJS](https://peerjs.com/) (WebRTC DataConnection)
*   **Backend**:
    *   **Server**: [Node.js](https://nodejs.org/) with [Express](https://expressjs.com/)
    *   **P2P Fallback**: Custom In-Memory Message Relay Queue supporting HTTP POST (sending) and long-polling GET (receiving).
*   **DevOps**:
    *   Docker & Docker Compose support.

---

## 📦 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v18 or higher) and [npm](https://www.npmjs.com/) installed.

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/Per2Mine/Jeopardy-Web-App-AI.git
    cd Jeopardy-Web-App-AI
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Running the Development Server

To run both the **Angular Frontend** (port 4200) and **Node.js Backend** (port 3000) concurrently, use the dev script:

```bash
npm run dev
```

*   **Frontend URL**: `http://localhost:4200`
*   **Backend URL**: `http://localhost:3000`

---

## 🐳 Docker Deployment

The application includes full support for containerized deployment using Docker.

1.  Build and run the containers using Docker Compose:
    ```bash
    docker-compose up --build
    ```

2.  The application will be accessible at `http://localhost:4200`, with requests proxied to the Node.js backend running in the same network.

---

## 📂 Project Structure

```text
Jeopardy-Web-App/
├── backend/                  # Node.js backend server
│   └── server.js             # Express server & P2P Long-polling Fallback API
├── src/
│   ├── app/
│   │   ├── core/             # Services & guards (e.g., P2P, game orchestration)
│   │   ├── pages/            # Page layouts (Start, Lobby, Gameplay, Quiz Creator)
│   │   └── shared/           # Reusable UI widgets (Chat, Avatars, Buttons)
│   ├── assets/               # Public images and static assets
│   └── styles.css            # Tailwind CSS rules and animations
├── Dockerfile                # Docker image spec
├── docker-compose.yml        # Multi-container orchestrations
├── angular.json              # Angular CLI config
└── package.json              # App scripts & dependencies
```

---

## ⚖️ License

Private repository. All rights reserved.
