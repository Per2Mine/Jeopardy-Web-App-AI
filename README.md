# Jeopardy Web App 🎓🎮

An interactive, real-time Jeopardy multiplayer game built with Angular 19, Node.js, TailwindCSS 4, and PeerJS. It features full game orchestration, buzzer system, scoreboards, character counters, custom avatar creators, and a lobby chat.

Designed to work seamlessly on any network config through a robust, zero-configuration P2P connection layer.

---

## 🚀 Key Features

*   **P2P Multiplayer Engine (WebRTC)**: Real-time, peer-to-peer data channel synchronization for ultra-low latency buzzer locks and gameplay updates.
*   **Transparent HTTP Relay Fallback**: Automatically and silently falls back to an HTTP Long-Polling relay after 3 seconds if WebRTC ICE negotiations fail (essential for restrictive corporate profiles, VPNs, or firewalls).
*   **Custom Avatar Creator**: Vector avatar customizer letting players personalize their lobby representation with multiple body shapes, eyes, mouths, accessories, and colors.
*   **Real-time Lobby Chat**: Global chat integrated directly into the room lobbies with custom avatars, tags (e.g., *Host* badge), and unread notifications.
*   **Host Control Panel**: Dedicated view for game hosts to control active questions, lock/unlock buzzers, reward or deduct points, and manage game progression.
*   **Interactive Buzzers**: Simultaneous buzzers with a lockout mechanism that highlights the first player to buzz in with millisecond precision.
*   **Comprehensive Quiz Creator**: Create and save custom quizzes with graphical character limits (160 characters for questions), Category setups, and double-checking systems.
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
