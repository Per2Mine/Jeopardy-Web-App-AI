import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { Peer, DataConnection } from 'peerjs';
import { Category } from './quiz.service';

export interface Player {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  score: number;
  teamId?: number; // 1-indexed team identifier
  isOffline?: boolean;
}

export type GamePhase = 'LOBBY' | 'BOARD' | 'QUESTION' | 'SUMMARY';

export interface GameState {
  phase: GamePhase;
  activeQuestion: {
    categoryIndex: number;
    questionIndex: number;
    value: number;
    text: string;
    answer: string;
  } | null;
  buzzedPlayerId: string | null;
  buzzerLocked: boolean;
  answeredQuestions: string[];
  lockedOutPlayerIds: string[];
  lockedOutTeamIds: number[];
  categories: Category[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
}

export interface P2pMessage {
  type: 'JOIN_ACK' | 'PLAYER_LIST' | 'GAME_STATE' | 'KICK' | 'BUZZ' | 'START_GAME' | 'SELECT_TEAM' | 'CHAT_MSG';
  senderId: string;
  payload: any;
}

@Injectable({
  providedIn: 'root'
})
export class P2pService {
  private router = inject(Router);
  private peer: Peer | null = null;
  private hostConnectionMap = new Map<string, DataConnection>(); // Host only: playerId -> DataConnection
  private clientConnection: DataConnection | null = null; // Client only: connection to host
  private maxPlayersLimit = 8;

  // State Signals
  roomCode = signal<string | null>(null);
  isHost = signal<boolean>(false);
  connectionState = signal<'disconnected' | 'connecting' | 'connected' | 'error'>(
    sessionStorage.getItem('jeopardy_p2p_session') ? 'connecting' : 'disconnected'
  );
  players = signal<Player[]>([]);
  errorMessage = signal<string>('');
  wasKicked = signal<boolean>(false);
  gameState = signal<GameState>({
    phase: 'LOBBY',
    activeQuestion: null,
    buzzedPlayerId: null,
    buzzerLocked: false,
    answeredQuestions: [],
    lockedOutPlayerIds: [],
    lockedOutTeamIds: [],
    categories: []
  });
  chatMessages = signal<ChatMessage[]>([]);

  // Team Mode Signals
  teamMode = signal<boolean>(false);
  maxTeamsLimit = signal<number>(4);
  maxPlayersPerTeam = signal<number>(2);
  teamsArray = computed(() => {
    const limit = this.maxTeamsLimit();
    const arr = [];
    for (let i = 1; i <= limit; i++) {
      arr.push(i);
    }
    return arr;
  });

  // Current user's player ID (peer.id)
  myPlayerId = signal<string | null>(null);

  // Helper signal to get the current player's profile
  me = computed(() => {
    const myId = this.myPlayerId();
    return this.players().find(p => p.id === myId) || null;
  });

  constructor() {
    // Attempt session restoration if there is a saved session
    if (sessionStorage.getItem('jeopardy_p2p_session')) {
      this.tryRestoreSession();
    }

    // Automatically save session state whenever relevant signals change
    effect(() => {
      const state = this.connectionState();
      const code = this.roomCode();
      const isHost = this.isHost();
      const myId = this.myPlayerId();
      const playersList = this.players();
      const gState = this.gameState();
      const tMode = this.teamMode();
      const maxTeams = this.maxTeamsLimit();
      const maxPerTeam = this.maxPlayersPerTeam();

      if (state === 'connected' && code) {
        const me = playersList.find(p => p.id === myId) || null;
        const sessionData = {
          role: isHost ? 'host' : 'client',
          roomCode: code,
          playerName: me ? me.name : (isHost ? 'Host' : 'Spieler'),
          playerColor: me ? me.color : '#f1b814',
          myPlayerId: myId,
          teamMode: tMode,
          maxPlayers: this.maxPlayersLimit,
          maxTeamsLimit: maxTeams,
          maxPlayersPerTeam: maxPerTeam,
          players: playersList,
          gameState: gState
        };
        sessionStorage.setItem('jeopardy_p2p_session', JSON.stringify(sessionData));
      } else if (state === 'disconnected' || state === 'error') {
        sessionStorage.removeItem('jeopardy_p2p_session');
      }
    });
  }

  /**
   * Attempt to restore session from sessionStorage
   */
  tryRestoreSession(): Promise<boolean> {
    const dataStr = sessionStorage.getItem('jeopardy_p2p_session');
    if (!dataStr) return Promise.resolve(false);

    try {
      const session = JSON.parse(dataStr);
      if (!session || !session.roomCode) {
        sessionStorage.removeItem('jeopardy_p2p_session');
        this.connectionState.set('disconnected');
        return Promise.resolve(false);
      }

      this.connectionState.set('connecting');

      if (session.role === 'host') {
        return this.restoreHostRoom(session);
      } else {
        return this.restoreClientRoom(session);
      }
    } catch (e) {
      console.error('Failed to parse saved session:', e);
      sessionStorage.removeItem('jeopardy_p2p_session');
      this.connectionState.set('disconnected');
      return Promise.resolve(false);
    }
  }

  private restoreHostRoom(session: any): Promise<boolean> {
    return new Promise((resolve) => {
      this.disconnect(); // Clear any existing instance state first
      this.maxPlayersLimit = session.maxPlayers;
      this.teamMode.set(session.teamMode);
      this.maxTeamsLimit.set(session.maxTeamsLimit);
      this.maxPlayersPerTeam.set(session.maxPlayersPerTeam);
      this.wasKicked.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = session.roomCode.toUpperCase().trim();
      
      // Initialize Peer with host room code
      this.peer = new Peer(formattedCode, {
        debug: 1
      });

      this.peer.on('open', (id) => {
        this.isHost.set(true);
        this.roomCode.set(id);
        this.myPlayerId.set(id);
        
        // Restore players, but mark everyone else as offline (waiting for them to reconnect)
        const restoredPlayers = (session.players || []).map((p: Player) => {
          if (p.id === id) {
            return p; // Host is online
          }
          return { ...p, isOffline: true };
        });
        this.players.set(restoredPlayers);

        // Restore game state
        if (session.gameState) {
          this.gameState.set(session.gameState);
        }

        this.connectionState.set('connected');

        // Setup host connection listeners
        this.setupHostListeners();

        // If game was already in progress, navigate to /game
        if (this.gameState().phase !== 'LOBBY') {
          this.router.navigate(['/game']);
        }
        resolve(true);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Restore Host Error:', err);
        this.connectionState.set('error');
        if (err.type === 'unavailable-id') {
          this.errorMessage.set(`Wiederherstellung fehlgeschlagen: Raumcode "${formattedCode}" belegt.`);
        } else {
          this.errorMessage.set('Verbindung zum Signalisierungsserver bei Wiederherstellung fehlgeschlagen.');
        }
        sessionStorage.removeItem('jeopardy_p2p_session');
        resolve(false);
      });
    });
  }

  private restoreClientRoom(session: any): Promise<boolean> {
    return new Promise((resolve) => {
      this.disconnect();
      this.wasKicked.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = session.roomCode.toUpperCase().trim();

      // Initialize Peer with a random ID
      this.peer = new Peer({
        debug: 1
      });

      this.peer.on('open', (myId) => {
        this.myPlayerId.set(myId);
        
        // Connect to the Host using the room code
        // We pass the player's profile AND the original player ID in metadata
        const conn = this.peer!.connect(formattedCode, {
          metadata: { 
            name: session.playerName, 
            color: session.playerColor, 
            originalPlayerId: session.myPlayerId // This tells the Host who we were!
          },
          reliable: true
        });

        this.setupClientListeners(conn, formattedCode, () => {
          resolve(true);
        }, (err) => {
          sessionStorage.removeItem('jeopardy_p2p_session');
          resolve(false);
        });
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Restore Client Error:', err);
        this.connectionState.set('error');
        sessionStorage.removeItem('jeopardy_p2p_session');
        resolve(false);
      });
    });
  }

  /**
   * Initialize a new room as Host
   */
  hostRoom(roomCode: string, hostName: string, hostColor: string, maxPlayers: number, teamMode: boolean, maxPlayersPerTeam: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.maxPlayersLimit = maxPlayers;
      this.teamMode.set(teamMode);
      this.maxTeamsLimit.set(maxPlayers);
      this.maxPlayersPerTeam.set(maxPlayersPerTeam);
      this.wasKicked.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = roomCode.toUpperCase().trim();
      
      // Initialize Peer with the custom room code
      this.peer = new Peer(formattedCode, {
        debug: 1 // Only print errors/warnings
      });

      this.peer.on('open', (id) => {
        this.isHost.set(true);
        this.roomCode.set(id);
        this.myPlayerId.set(id);
        this.connectionState.set('connected');

        // Add host as the first player in the list
        this.players.set([{
          id: id,
          name: hostName,
          color: hostColor,
          isHost: true,
          score: 0
        }]);

        // Listen for incoming player connections
        this.setupHostListeners();
        resolve();
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        this.connectionState.set('error');
        if (err.type === 'unavailable-id') {
          this.errorMessage.set(`Raumcode "${formattedCode}" wird bereits verwendet.`);
        } else {
          this.errorMessage.set('Verbindung zum Signalisierungsserver fehlgeschlagen.');
        }
        reject(err);
      });
    });
  }

  /**
   * Connect to an existing room as Client
   */
  joinRoom(roomCode: string, playerName: string, playerColor: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.wasKicked.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = roomCode.toUpperCase().trim();

      // Initialize Peer with a random ID
      this.peer = new Peer({
        debug: 1
      });

      this.peer.on('open', (myId) => {
        this.myPlayerId.set(myId);
        
        // Connect to the Host using the room code
        // We pass the player's profile in metadata
        const conn = this.peer!.connect(formattedCode, {
          metadata: { name: playerName, color: playerColor },
          reliable: true
        });

        this.setupClientListeners(conn, formattedCode, resolve, reject);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Client Error:', err);
        this.connectionState.set('error');
        if (err.type === 'peer-unavailable') {
          this.errorMessage.set('Keine Lobby unter diesem Raumcode gefunden.');
        } else {
          this.errorMessage.set('Konnte keine P2P-Sitzung initiieren.');
        }
        reject(err);
      });
    });
  }

  /**
   * Disconnect and cleanup all connections
   */
  disconnect() {
    // Client disconnect
    if (this.clientConnection) {
      this.clientConnection.close();
      this.clientConnection = null;
    }

    // Host disconnect
    this.hostConnectionMap.forEach(conn => conn.close());
    this.hostConnectionMap.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // Reset state
    this.roomCode.set(null);
    this.isHost.set(false);
    this.connectionState.set('disconnected');
    this.players.set([]);
    this.myPlayerId.set(null);
    this.teamMode.set(false);
    this.maxTeamsLimit.set(4);
    this.maxPlayersPerTeam.set(2);
    this.chatMessages.set([]);
  }

  /**
   * Host Connection Listener: handle incoming guests
   */
  private setupHostListeners() {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        const metadata = conn.metadata || {};
        const playerId = conn.peer;
        const playerName = metadata.name || 'Unbekannt';
        const playerColor = metadata.color || '#0052cc';

        // Check if player is reconnecting with an existing session
        const originalPlayerId = metadata.originalPlayerId;
        if (originalPlayerId) {
          const existingPlayerIndex = this.players().findIndex(p => p.id === originalPlayerId);
          if (existingPlayerIndex !== -1) {
            const existingPlayer = this.players()[existingPlayerIndex];
            
            // Update the connection in map
            this.hostConnectionMap.set(playerId, conn);
            
            // Update player list with new Peer ID, clear isOffline
            const updatedPlayers = [...this.players()];
            updatedPlayers[existingPlayerIndex] = {
              ...existingPlayer,
              id: playerId, // Update to new Peer ID
              isOffline: false
            };
            this.players.set(updatedPlayers);

            // Update game state references if they reference originalPlayerId
            const currentGameState = this.gameState();
            let stateChanged = false;
            let updatedBuzzedPlayerId = currentGameState.buzzedPlayerId;
            let updatedLockedOutPlayerIds = [...currentGameState.lockedOutPlayerIds];

            if (currentGameState.buzzedPlayerId === originalPlayerId) {
              updatedBuzzedPlayerId = playerId;
              stateChanged = true;
            }
            if (currentGameState.lockedOutPlayerIds.includes(originalPlayerId)) {
              updatedLockedOutPlayerIds = currentGameState.lockedOutPlayerIds.map(id => id === originalPlayerId ? playerId : id);
              stateChanged = true;
            }

            if (stateChanged) {
              this.gameState.set({
                ...currentGameState,
                buzzedPlayerId: updatedBuzzedPlayerId,
                lockedOutPlayerIds: updatedLockedOutPlayerIds
              });
            }

            // Acknowledge the connection and send initial welcome with the current game state and chat
            const ackMessage: P2pMessage = {
              type: 'JOIN_ACK',
              senderId: this.myPlayerId()!,
              payload: { 
                success: true,
                teamMode: this.teamMode(),
                maxTeamsLimit: this.maxTeamsLimit(),
                maxPlayersPerTeam: this.maxPlayersPerTeam(),
                gameState: this.gameState(),
                chatHistory: this.chatMessages()
              }
            };
            conn.send(ackMessage);

            // Broadcast updated player list & game state to everyone
            this.broadcastPlayerList();
            this.broadcast({
              type: 'GAME_STATE',
              senderId: this.myPlayerId()!,
              payload: this.gameState()
            });

            // Handle messages from this client
            this.setupMessageListener(conn, playerId);
            return;
          }
        }

        // Check if player limit is reached (excludes the host/owner)
        const maxAllowed = this.teamMode() 
          ? this.maxTeamsLimit() * this.maxPlayersPerTeam()
          : this.maxPlayersLimit;

        if (this.hostConnectionMap.size >= maxAllowed) {
          conn.send({
            type: 'JOIN_ACK',
            senderId: this.myPlayerId()!,
            payload: { success: false, reason: 'lobby_full' }
          });
          setTimeout(() => conn.close(), 500);
          return;
        }
        
        // 1. Add connection to host map
        this.hostConnectionMap.set(playerId, conn);

        // 2. Assign to first team with empty slot if in team mode
        let teamId: number | undefined = undefined;
        if (this.teamMode()) {
          for (let t = 1; t <= this.maxTeamsLimit(); t++) {
            const teamCount = this.players().filter(p => p.teamId === t).length;
            if (teamCount < this.maxPlayersPerTeam()) {
              teamId = t;
              break;
            }
          }
          if (teamId === undefined) teamId = 1;
        }

        // 3. Add player to the list
        const updatedPlayers = [
          ...this.players(),
          { id: playerId, name: playerName, color: playerColor, isHost: false, score: 0, teamId, isOffline: false }
        ];
        this.players.set(updatedPlayers);

        // 4. Acknowledge the connection and send initial welcome
        const ackMessage: P2pMessage = {
          type: 'JOIN_ACK',
          senderId: this.myPlayerId()!,
          payload: { 
            success: true,
            teamMode: this.teamMode(),
            maxTeamsLimit: this.maxTeamsLimit(),
            maxPlayersPerTeam: this.maxPlayersPerTeam()
          }
        };
        conn.send(ackMessage);

        // 5. Broadcast updated player list to everyone
        this.broadcastPlayerList();

        // 6. Handle messages from this client
        this.setupMessageListener(conn, playerId);
      });
    });
  }

  /**
   * Client Connection Listener: handle connection to Host
   */
  private setupClientListeners(
    conn: DataConnection,
    targetRoomCode: string,
    resolve: () => void,
    reject: (err: any) => void
  ) {
    this.clientConnection = conn;

    conn.on('open', () => {
      // We are connected at WebRTC level, but wait for Host JOIN_ACK to be fully active
      this.setupClientMessageListener(conn, resolve, reject);
    });

    conn.on('close', () => {
      const hasSavedSession = sessionStorage.getItem('jeopardy_p2p_session');
      if (hasSavedSession && !this.wasKicked()) {
        console.log('Connection closed unexpectedly. Attempting to reconnect...');
        this.connectionState.set('connecting');
        setTimeout(() => {
          this.tryRestoreSession();
        }, 2000);
      } else {
        this.disconnect();
      }
    });

    conn.on('error', (err) => {
      console.error('DataConnection Error:', err);
      this.connectionState.set('error');
      this.errorMessage.set('Verbindung zum Spielraum abgebrochen.');
      reject(err);
    });

    // Timeout if Host does not respond within 6 seconds
    setTimeout(() => {
      if (this.connectionState() === 'connecting') {
        this.disconnect();
        this.errorMessage.set('Spielraum antwortet nicht oder existiert nicht.');
        reject(new Error('Timeout connecting to host'));
      }
    }, 6000);
  }

  /**
   * Message handling for Host
   */
  private setupMessageListener(conn: DataConnection, playerId: string) {
    conn.on('data', (data: any) => {
      const msg = data as P2pMessage;
      if (!msg) return;

      console.log(`Host received [${msg.type}] from player ${playerId}:`, msg.payload);
      
      switch (msg.type) {
        case 'BUZZ':
          // Handle Buzzer events (Host handles timing conflict resolution)
          this.handleHostBuzzer(playerId);
          break;
        case 'SELECT_TEAM':
          this.handleHostSelectTeam(playerId, msg.payload.teamId);
          break;
        case 'CHAT_MSG':
          this.handleHostChatMessage(msg);
          break;
        default:
          break;
      }
    });

    conn.on('close', () => {
      this.hostConnectionMap.delete(playerId);
      const updatedPlayers = this.players().map(p => {
        if (p.id === playerId) {
          return { ...p, isOffline: true };
        }
        return p;
      });
      this.players.set(updatedPlayers);
      this.broadcastPlayerList();
    });
  }

  /**
   * Message handling for Client
   */
  private setupClientMessageListener(
    conn: DataConnection,
    resolve: () => void,
    reject: (err: any) => void
  ) {
    conn.on('data', (data: any) => {
      const msg = data as P2pMessage;
      if (!msg) return;

      console.log(`Client received [${msg.type}] from Host:`, msg.payload);

      switch (msg.type) {
        case 'JOIN_ACK':
          if (msg.payload?.success) {
            this.connectionState.set('connected');
            this.roomCode.set(this.clientConnection?.peer || null);
            this.teamMode.set(msg.payload.teamMode || false);
            this.maxTeamsLimit.set(msg.payload.maxTeamsLimit || 4);
            this.maxPlayersPerTeam.set(msg.payload.maxPlayersPerTeam || 2);
            if (msg.payload.gameState) {
              this.gameState.set(msg.payload.gameState);
              if (msg.payload.gameState.phase !== 'LOBBY') {
                this.router.navigate(['/game']);
              }
            }
            if (msg.payload.chatHistory) {
              this.chatMessages.set(msg.payload.chatHistory);
            }
            resolve();
          } else {
            this.disconnect();
            if (msg.payload?.reason === 'lobby_full') {
              this.errorMessage.set('Diese Lobby ist leider bereits voll.');
            } else {
              this.errorMessage.set('Verbindung von der Lobby abgelehnt.');
            }
            reject(new Error(msg.payload?.reason || 'declined'));
          }
          break;
        case 'PLAYER_LIST':
          this.players.set(msg.payload as Player[]);
          break;
        case 'START_GAME':
          this.gameState.set(msg.payload as GameState);
          this.router.navigate(['/game']);
          break;
        case 'GAME_STATE':
          this.gameState.set(msg.payload as GameState);
          break;
        case 'KICK':
          this.disconnect();
          this.wasKicked.set(true);
          break;
        case 'CHAT_MSG':
          const chatMsg = msg.payload as ChatMessage;
          this.chatMessages.update(msgs => [...msgs, chatMsg]);
          break;
        default:
          break;
      }
    });
  }

  /**
   * Host: Broadcast player list to all connected clients
   */
  private broadcastPlayerList() {
    this.broadcast({
      type: 'PLAYER_LIST',
      senderId: this.myPlayerId()!,
      payload: this.players()
    });
  }

  /**
   * Host: Send a message to all connected clients
   */
  broadcast(message: P2pMessage) {
    if (!this.isHost()) return;
    this.hostConnectionMap.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  /**
   * Client: Send a message to the Host
   */
  sendToHost(message: P2pMessage) {
    if (this.isHost() || !this.clientConnection || !this.clientConnection.open) return;
    this.clientConnection.send(message);
  }

  /**
   * Client: Trigger buzzer
   */
  buzz() {
    this.sendToHost({
      type: 'BUZZ',
      senderId: this.myPlayerId()!,
      payload: {}
    });
  }

  /**
   * Host: Kick a player from the lobby
   */
  kickPlayer(playerId: string) {
    if (!this.isHost()) return;
    const conn = this.hostConnectionMap.get(playerId);
    if (conn) {
      conn.send({
        type: 'KICK',
        senderId: this.myPlayerId()!,
        payload: {}
      });
      conn.close();
      this.hostConnectionMap.delete(playerId);
      this.players.set(this.players().filter(p => p.id !== playerId));
      this.broadcastPlayerList();
    }
  }

  private handleHostBuzzer(playerId: string) {
    if (!this.isHost()) return;
    const current = this.gameState();

    // Check if player is locked out
    if (current.lockedOutPlayerIds && current.lockedOutPlayerIds.includes(playerId)) {
      return;
    }
    
    // Check if player's team is locked out
    const player = this.players().find(p => p.id === playerId);
    if (this.teamMode() && player && player.teamId && current.lockedOutTeamIds && current.lockedOutTeamIds.includes(player.teamId)) {
      return;
    }

    // Only accept buzzer if in QUESTION phase, no one has buzzed yet, and buzzer isn't locked
    if (current.phase === 'QUESTION' && current.buzzedPlayerId === null && !current.buzzerLocked) {
      const nextState: GameState = {
        ...current,
        buzzedPlayerId: playerId,
        buzzerLocked: true
      };
      this.gameState.set(nextState);
      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: nextState
      });
    }
  }

  startGame(categories: Category[]) {
    if (!this.isHost()) return;
    
    // Reset all player scores to 0
    const resetPlayers = this.players().map(p => ({ ...p, score: 0 }));
    this.players.set(resetPlayers);
    this.broadcastPlayerList();

    const initialState: GameState = {
      phase: 'BOARD',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      categories
    };
    this.gameState.set(initialState);
    
    this.broadcast({
      type: 'START_GAME',
      senderId: this.myPlayerId()!,
      payload: initialState
    });

    this.router.navigate(['/game']);
  }

  selectQuestion(categoryIndex: number, questionIndex: number, value: number, text: string, answer: string) {
    if (!this.isHost()) return;
    const current = this.gameState();
    const nextState: GameState = {
      ...current,
      phase: 'QUESTION',
      activeQuestion: { categoryIndex, questionIndex, value, text, answer },
      buzzedPlayerId: null,
      buzzerLocked: false,
      lockedOutPlayerIds: [],
      lockedOutTeamIds: []
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  awardPoints(playerId: string, correct: boolean) {
    if (!this.isHost()) return;
    const current = this.gameState();
    if (!current.activeQuestion) return;

    // 1. Update score of target player
    const value = current.activeQuestion.value;
    const updatedPlayers = this.players().map(p => {
      if (p.id === playerId) {
        return { ...p, score: p.score + (correct ? value : -value) };
      }
      return p;
    });
    this.players.set(updatedPlayers);
    this.broadcastPlayerList();

    // 2. Compute next game state
    let nextState: GameState;
    if (correct) {
      // Correct answer: question resolved, return to board
      const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
      nextState = {
        ...current,
        phase: 'BOARD',
        activeQuestion: null,
        buzzedPlayerId: null,
        buzzerLocked: false,
        answeredQuestions: [...current.answeredQuestions, questionKey],
        lockedOutPlayerIds: [],
        lockedOutTeamIds: []
      };
    } else {
      // Incorrect answer: lock this player / team out of buzzing
      const lockedOutPlayers = [...(current.lockedOutPlayerIds || [])];
      if (!lockedOutPlayers.includes(playerId)) {
        lockedOutPlayers.push(playerId);
      }

      const lockedOutTeams = [...(current.lockedOutTeamIds || [])];
      const player = this.players().find(p => p.id === playerId);
      if (this.teamMode() && player && player.teamId !== undefined) {
        if (!lockedOutTeams.includes(player.teamId)) {
          lockedOutTeams.push(player.teamId);
        }
      }

      nextState = {
        ...current,
        buzzedPlayerId: null,
        buzzerLocked: false,
        lockedOutPlayerIds: lockedOutPlayers,
        lockedOutTeamIds: lockedOutTeams
      };
    }

    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  skipQuestion() {
    if (!this.isHost()) return;
    const current = this.gameState();
    if (!current.activeQuestion) return;

    const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
    const nextState: GameState = {
      ...current,
      phase: 'BOARD',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [...current.answeredQuestions, questionKey]
    };

    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  endGame() {
    if (!this.isHost()) return;
    const current = this.gameState();
    const nextState: GameState = {
      ...current,
      phase: 'SUMMARY',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  private handleHostSelectTeam(playerId: string, teamId: number) {
    if (!this.isHost()) return;
    
    // Check space limit
    const teamCount = this.players().filter(p => p.teamId === teamId).length;
    if (teamCount < this.maxPlayersPerTeam()) {
      const updated = this.players().map(p => {
        if (p.id === playerId) {
          return { ...p, teamId };
        }
        return p;
      });
      this.players.set(updated);
      this.broadcastPlayerList();
    }
  }

  selectTeam(teamId: number) {
    if (this.isHost()) return;
    this.sendToHost({
      type: 'SELECT_TEAM',
      senderId: this.myPlayerId()!,
      payload: { teamId }
    });
  }

  sendChatMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const me = this.me();
    const senderName = me ? me.name : (this.isHost() ? 'Host' : 'Spieler');
    const senderColor = me ? me.color : '#f1b814';

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: this.myPlayerId() || 'unknown',
      senderName,
      senderColor,
      text: trimmed,
      timestamp: Date.now()
    };

    if (this.isHost()) {
      // Host: Add directly to own log and broadcast
      this.chatMessages.update(msgs => [...msgs, chatMsg]);
      this.broadcast({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: chatMsg
      });
    } else {
      // Client: Send to Host
      this.sendToHost({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: {
          senderName,
          senderColor,
          text: trimmed
        }
      });
    }
  }

  private handleHostChatMessage(msg: P2pMessage) {
    if (!this.isHost()) return;
    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: msg.senderId,
      senderName: msg.payload.senderName,
      senderColor: msg.payload.senderColor,
      text: msg.payload.text,
      timestamp: Date.now()
    };

    // Add to Host's list
    this.chatMessages.update(msgs => [...msgs, chatMsg]);

    // Broadcast to everyone else (including the client who sent it)
    this.broadcast({
      type: 'CHAT_MSG',
      senderId: this.myPlayerId()!,
      payload: chatMsg
    });
  }
}
