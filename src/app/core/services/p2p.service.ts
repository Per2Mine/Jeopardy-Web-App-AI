import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Peer, DataConnection } from 'peerjs';
import { Category } from './quiz.service';
import { safeSessionStorageGet, safeSessionStorageSet, safeSessionStorageRemove } from '../utils/storage.util';

export interface Player {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  isHost: boolean;
  score: number;
  teamId?: number; // 1-indexed team identifier
  isOffline?: boolean;
  ping?: number;
}

export interface GameEvent {
  type: 'BUZZ' | 'AWARD';
  timestamp: number;
  playerId: string;
  playerName: string;
  value: number; // reactionTime in ms for BUZZ, score delta for AWARD
  categoryName?: string;
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
    image?: string;
    pixelate?: boolean;
    pixelateStrength?: number;
    reducePixelationOnWrong?: boolean;
    reducePixelationAmount?: number;
    zoom?: number;
    rotation?: number;
    audio?: string;
    audioStart?: number;
    audioEnd?: number;
    audioSpeed?: number;
    audioPitch?: number;
  } | null;
  buzzedPlayerId: string | null;
  buzzerLocked: boolean;
  answeredQuestions: string[];
  lockedOutPlayerIds: string[];
  lockedOutTeamIds: number[];
  categories: Category[];
  activeSelectorId: string | null;
  votes: { [questionKey: string]: string[] };
  showAnswer: boolean;
  lastAnswerResult: {
    correct: boolean;
    playerName: string;
    value: number;
  } | null;
  buzzerTimeout: number;
  deductPointsOnTimeout: boolean;
  timerSeconds: number | null;
  autoStartTimer?: boolean;
  timerActive?: boolean;
  isInitialTurn: boolean;
  audioPlaying: boolean;
  boards?: Category[][];
  currentBoardIndex?: number;
  totalBoardsCount?: number;
  history?: GameEvent[];
  selectedQuizzes?: {
    id: string;
    name: string;
    icon: string;
    categoriesCount: number;
    questionsCount: number;
  }[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
  teamId?: number;
}

export interface P2pMessage {
  type: 'JOIN_ACK' | 'PLAYER_LIST' | 'GAME_STATE' | 'KICK' | 'BUZZ' | 'START_GAME' | 'SELECT_TEAM' | 'CHAT_MSG' | 'VOTE_QUESTION' | 'JOIN_REQ' | 'HEARTBEAT' | 'PING' | 'PONG';
  senderId: string;
  payload: any;
}

export class HttpRelayConnection {
  open = true;
  private listeners: { [key: string]: Function[] } = {};

  constructor(
    public peer: string,
    private myPeerId: string,
    private http: HttpClient,
    public metadata?: any
  ) {}

  send(data: any) {
    if (!this.open) return;
    this.http.post('/api/p2p/send', {
      senderId: this.myPeerId,
      receiverId: this.peer,
      message: data
    }).subscribe({
      error: (err) => console.error('Failed to send HTTP relay message:', err)
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.trigger('close');
  }

  on(event: 'open' | 'data' | 'close' | 'error', callback: (data?: any) => void) {
    if (event === 'open') {
      setTimeout(() => {
        if (this.open) callback();
      }, 0);
      return;
    }
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  trigger(event: string, data?: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

@Injectable({
  providedIn: 'root'
})
export class P2pService {
  private router = inject(Router);
  private http = inject(HttpClient);
  private peer: Peer | null = null;
  private hostConnectionMap = new Map<string, any>(); // Host only: playerId -> DataConnection or HttpRelayConnection
  private clientConnection: any = null; // Client only: connection to host
  private hostFullBoards: Category[][] = []; // Host only: complete local copy of quiz templates/boards
  private maxPlayersLimit = 8;
  
  private iceServers: any[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Open Relay Project (Free STUN/TURN servers powered by Metered.ca)
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];


  // State Signals
  roomCode = signal<string | null>(null);
  isHost = signal<boolean>(false);
  connectionState = signal<'disconnected' | 'connecting' | 'connected' | 'error'>(
    safeSessionStorageGet('jeopardy_p2p_session') ? 'connecting' : 'disconnected'
  );
  players = signal<Player[]>([]);
  errorMessage = signal<string>('');
  wasKicked = signal<boolean>(false);
  myPing = signal<number>(0);
  hostDisconnected = signal<boolean>(false);
  private createInitialGameState(): GameState {
    return {
      phase: 'LOBBY',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      categories: [],
      activeSelectorId: null,
      votes: {},
      showAnswer: false,
      lastAnswerResult: null,
      buzzerTimeout: 20,
      deductPointsOnTimeout: false,
      timerSeconds: null,
      autoStartTimer: true,
      timerActive: false,
      isInitialTurn: false,
      audioPlaying: false,
      history: []
    };
  }

  private sanitizeColor(color: any, fallback: string = '#f1b814'): string {
    return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())
      ? color.trim()
      : fallback;
  }

  private sanitizeAvatar(avatar: any): string {
    if (typeof avatar !== 'string') return 'b2e0m0a0';
    const trimmed = avatar.trim();
    return /^b\d{1,2}e\d{1,2}m\d{1,2}a\d{1,2}$/.test(trimmed) ? trimmed : 'b2e0m0a0';
  }

  private sanitizeGameStateForClients(state: GameState): GameState {
    if (!state || !state.activeQuestion || state.showAnswer) {
      return state;
    }
    return {
      ...state,
      activeQuestion: {
        ...state.activeQuestion,
        answer: ''
      }
    };
  }

  private getFilteredChatForPlayer(teamId?: number): ChatMessage[] {
    return this.chatMessages().filter(m => m.teamId === undefined || (teamId !== undefined && m.teamId === teamId));
  }

  gameState = signal<GameState>(this.createInitialGameState());
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

  private getPeerOptions(): any {
    const host = window.location.hostname;
    const secure = window.location.protocol === 'https:';

    const options: any = {
      host: host,
      path: '/peerjs',
      secure: secure,
      debug: 1,
      config: {
        iceServers: this.iceServers
      }
    };

    if (window.location.port) {
      options.port = parseInt(window.location.port, 10);
    }

    return options;
  }

  private fetchIceServers() {
    this.http.get<{ iceServers: any[] }>('/api/webrtc/ice-servers').subscribe({
      next: (res) => {
        if (res && res.iceServers) {
          this.iceServers = res.iceServers;
        }
      },
      error: (err) => {
        console.warn('Could not fetch custom ICE servers from backend, using default STUN', err);
      }
    });
  }

  private stripCategories(categories: Category[]): Category[] {
    return categories.map(cat => ({
      name: cat.name,
      questions: (cat.questions || []).map(q => ({
        value: q.value,
        text: '',
        answer: '',
      }))
    }));
  }

  private stripBoards(boards: Category[][]): Category[][] {
    return boards.map(board => this.stripCategories(board));
  }

  // Debounce timer for broadcastPlayerList during rapid joins
  private broadcastPlayerListTimer: any = null;
  private readonly BROADCAST_DEBOUNCE_MS = 300;
  private buzzerActiveTime: number = 0; // Host: tracks when buzzer was activated for current question/unlock

  // HTTP Polling Fallback System
  private isPolling = false;
  private pollTimer: any = null;
  private reconnectingOldIds = new Set<string>();

  private startPolling(myId: string) {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollNext(myId);
  }

  private stopPolling() {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pollNext(myId: string) {
    if (!this.isPolling || !this.peer) return;

    this.http.get<{ messages: Array<{ senderId: string, message: any }> }>(`/api/p2p/poll/${encodeURIComponent(myId)}`).subscribe({
      next: (res) => {
        if (!this.isPolling) return;
        if (res && res.messages) {
          for (const item of res.messages) {
            this.handleRelayedMessage(item.senderId, item.message);
          }
        }
        this.pollTimer = setTimeout(() => this.pollNext(myId), 100);
      },
      error: (err) => {
        if (!this.isPolling) return;
        console.warn('HTTP poll failed, retrying in 2s...', err);
        this.pollTimer = setTimeout(() => this.pollNext(myId), 2000);
      }
    });
  }

  private handleRelayedMessage(senderId: string, msg: any) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isHost()) {
      if (msg.type === 'JOIN_REQ') {
        const relayConn = new HttpRelayConnection(
          senderId,
          this.myPlayerId()!,
          this.http,
          msg.payload
        );
        this.handleIncomingConnection(relayConn);
      } else {
        const conn = this.hostConnectionMap.get(senderId);
        if (conn && conn instanceof HttpRelayConnection) {
          conn.trigger('data', msg);
        }
      }
    } else {
      if (this.clientConnection && this.clientConnection instanceof HttpRelayConnection && senderId === this.clientConnection.peer) {
        this.clientConnection.trigger('data', msg);
      }
    }
  }

  private handleIncomingConnection(conn: any) {
    const metadata = conn.metadata || {};
    const playerId = conn.peer;
    const rawName = typeof metadata.name === 'string' ? metadata.name : 'Unbekannt';
    const playerName = rawName.trim() || 'Unbekannt';
    const playerColor = this.sanitizeColor(metadata.color, '#0052cc');
    const playerAvatar = this.sanitizeAvatar(metadata.avatar);

    // Validate player name length and characters (Host authority validation — applies to all joins and reconnects)
    const nameRegex = /^[a-zA-Z0-9_\-\säöüÄÖÜß]+$/;
    if (playerName.length < 2 || playerName.length > 14 || !nameRegex.test(playerName)) {
      conn.send({
        type: 'JOIN_ACK',
        senderId: this.myPlayerId()!,
        payload: { success: false, reason: 'invalid_name' }
      });
      setTimeout(() => conn.close(), 500);
      return;
    }

    // Check if an OFFLINE non-host player is reconnecting (never allow overwriting the Host or an active online player)
    const originalPlayerId = typeof metadata.originalPlayerId === 'string' ? metadata.originalPlayerId : '';
    let existingPlayerIndex = -1;

    if (originalPlayerId) {
      existingPlayerIndex = this.players().findIndex(
        p => !p.isHost && p.isOffline && p.id === originalPlayerId
      );
    }

    if (existingPlayerIndex === -1 && playerName) {
      existingPlayerIndex = this.players().findIndex(
        p => !p.isHost && p.isOffline && p.name.trim().toLowerCase() === playerName.toLowerCase()
      );
    }

    if (existingPlayerIndex !== -1) {
      const existingPlayer = this.players()[existingPlayerIndex];
      const oldPlayerId = existingPlayer.id;

      // Mark old ID as reconnecting so closing oldConn doesn't wipe votes/selector
      this.reconnectingOldIds.add(oldPlayerId);

      // Update the connection in map (remove old, add new) BEFORE closing oldConn
      const oldConn = this.hostConnectionMap.get(oldPlayerId);
      this.hostConnectionMap.delete(oldPlayerId);
      this.hostConnectionMap.set(playerId, conn);

      this.lastSeenMap.delete(oldPlayerId);
      this.lastSeenMap.set(playerId, Date.now());

      if (oldConn) {
        try {
          oldConn.close();
        } catch (e) {
          console.warn('Error closing old connection during reconnect:', e);
        }
      }
      setTimeout(() => this.reconnectingOldIds.delete(oldPlayerId), 1000);

      // Update player list with new Peer ID, clear isOffline
      const updatedPlayers = [...this.players()];
      updatedPlayers[existingPlayerIndex] = {
        ...existingPlayer,
        id: playerId,
        name: playerName,
        color: playerColor,
        avatar: playerAvatar,
        isOffline: false
      };
      this.players.set(updatedPlayers);

      // Migrate ALL game state references from oldPlayerId -> playerId
      const currentGameState = this.gameState();
      let stateChanged = false;
      let updatedBuzzedPlayerId = currentGameState.buzzedPlayerId;
      let updatedLockedOutPlayerIds = [...currentGameState.lockedOutPlayerIds];
      let updatedActiveSelectorId = currentGameState.activeSelectorId;
      const updatedVotes: { [key: string]: string[] } = {};
      let updatedHistory = currentGameState.history || [];

      if (currentGameState.buzzedPlayerId === oldPlayerId) {
        updatedBuzzedPlayerId = playerId;
        stateChanged = true;
      }
      if (currentGameState.lockedOutPlayerIds.includes(oldPlayerId)) {
        updatedLockedOutPlayerIds = currentGameState.lockedOutPlayerIds.map(id => id === oldPlayerId ? playerId : id);
        stateChanged = true;
      }
      if (currentGameState.activeSelectorId === oldPlayerId) {
        updatedActiveSelectorId = playerId;
        stateChanged = true;
      }
      for (const [k, voters] of Object.entries(currentGameState.votes || {})) {
        if (voters.includes(oldPlayerId)) {
          updatedVotes[k] = voters.map(id => id === oldPlayerId ? playerId : id);
          stateChanged = true;
        } else {
          updatedVotes[k] = voters;
        }
      }
      if (updatedHistory.some(ev => ev.playerId === oldPlayerId)) {
        updatedHistory = updatedHistory.map(ev => ev.playerId === oldPlayerId ? { ...ev, playerId } : ev);
        stateChanged = true;
      }

      if (stateChanged) {
        this.gameState.set({
          ...currentGameState,
          buzzedPlayerId: updatedBuzzedPlayerId,
          lockedOutPlayerIds: updatedLockedOutPlayerIds,
          activeSelectorId: updatedActiveSelectorId,
          votes: updatedVotes,
          history: updatedHistory
        });
      }

      // Acknowledge the connection with sanitized gameState and team-filtered chatHistory
      const ackMessage: P2pMessage = {
        type: 'JOIN_ACK',
        senderId: this.myPlayerId()!,
        payload: {
          success: true,
          teamMode: this.teamMode(),
          maxTeamsLimit: this.maxTeamsLimit(),
          maxPlayersPerTeam: this.maxPlayersPerTeam(),
          gameState: this.sanitizeGameStateForClients(this.gameState()),
          chatHistory: this.getFilteredChatForPlayer(existingPlayer.teamId)
        }
      };
      conn.send(ackMessage);

      this.debouncedBroadcastPlayerList();
      this.debouncedBroadcastGameState();
      this.setupMessageListener(conn, playerId);
      return;
    }

    // Check if there is an ACTIVE player with the same name (case-insensitive)
    const isNameTaken = this.players().some(
      p => !p.isOffline && p.name.trim().toLowerCase() === playerName.toLowerCase()
    );

    if (isNameTaken) {
      conn.send({
        type: 'JOIN_ACK',
        senderId: this.myPlayerId()!,
        payload: { success: false, reason: 'name_taken' }
      });
      setTimeout(() => conn.close(), 500);
      return;
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
    this.lastSeenMap.set(playerId, Date.now());

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
      { id: playerId, name: playerName, color: playerColor, avatar: playerAvatar, isHost: false, score: 0, teamId, isOffline: false, ping: 0 }
    ];
    this.players.set(updatedPlayers);

    // 4. Acknowledge the connection with sanitized gameState and team-filtered chatHistory
    const ackMessage: P2pMessage = {
      type: 'JOIN_ACK',
      senderId: this.myPlayerId()!,
      payload: {
        success: true,
        teamMode: this.teamMode(),
        maxTeamsLimit: this.maxTeamsLimit(),
        maxPlayersPerTeam: this.maxPlayersPerTeam(),
        gameState: this.sanitizeGameStateForClients(this.gameState()),
        chatHistory: this.getFilteredChatForPlayer(teamId)
      }
    };
    conn.send(ackMessage);

    // 5. Broadcast updated player list to everyone (debounced to avoid O(n²) broadcast storm)
    this.debouncedBroadcastPlayerList();

    // 6. Handle messages from this client
    this.setupMessageListener(conn, playerId);
  }




  constructor() {
    this.fetchIceServers();
    
    // Attempt session restoration if there is a saved session
    if (safeSessionStorageGet('jeopardy_p2p_session')) {
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
          playerAvatar: me ? (me.avatar || '') : '',
          myPlayerId: myId,
          teamMode: tMode,
          maxPlayers: this.maxPlayersLimit,
          maxTeamsLimit: maxTeams,
          maxPlayersPerTeam: maxPerTeam,
          players: playersList,
          gameState: isHost ? gState : this.sanitizeGameStateForClients(gState)
        };
        try {
          safeSessionStorageSet('jeopardy_p2p_session', JSON.stringify(sessionData));
        } catch (err) {
          console.warn('Could not persist session to sessionStorage (quota exceeded):', err);
        }
      } else if (state === 'disconnected' || state === 'error') {
        safeSessionStorageRemove('jeopardy_p2p_session');
      }
    });

    // Ping/Pong Interval for Clients to monitor latency to the Host
    let pingInterval: any = null;
    effect(() => {
      const state = this.connectionState();
      const isHost = this.isHost();
      
      if (state === 'connected' && !isHost) {
        if (!pingInterval) {
          pingInterval = setInterval(() => {
            this.sendPingToHost();
          }, 3000);
        }
      } else {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
          this.myPing.set(0);
        }
      }
    });
  }

  /**
   * Attempt to restore session from sessionStorage
   */
  tryRestoreSession(): Promise<boolean> {
    const dataStr = safeSessionStorageGet('jeopardy_p2p_session');
    this.logDebug('tryRestoreSession called. Session data from storage:', dataStr);
    if (!dataStr) return Promise.resolve(false);

    try {
      const session = JSON.parse(dataStr);
      if (!session || !session.roomCode) {
        this.logDebug('Session data invalid, removing session.');
        safeSessionStorageRemove('jeopardy_p2p_session');
        this.connectionState.set('disconnected');
        return Promise.resolve(false);
      }

      this.connectionState.set('connecting');

      if (session.role === 'host') {
        this.logDebug('Restoring host room...');
        return this.restoreHostRoom(session);
      } else {
        this.logDebug('Restoring client room...');
        return this.restoreClientRoom(session);
      }
    } catch (e: any) {
      this.logDebug('Failed to parse saved session, error:', e.message);
      console.error('Failed to parse saved session:', e);
      safeSessionStorageRemove('jeopardy_p2p_session');
      this.connectionState.set('disconnected');
      return Promise.resolve(false);
    }
  }

  private restoreHostRoom(session: any): Promise<boolean> {
    return new Promise((resolve) => {
      this.cleanupForReconnection(); // Clear any existing instance state first
      
      // Restore hostFullBoards
      const fullBoardsStr = safeSessionStorageGet('jeopardy_host_full_boards');
      if (fullBoardsStr) {
        try {
          this.hostFullBoards = JSON.parse(fullBoardsStr);
        } catch (e) {
          console.warn('Failed to parse hostFullBoards from sessionStorage', e);
        }
      }

      this.maxPlayersLimit = session.maxPlayers;
      this.teamMode.set(session.teamMode);
      this.maxTeamsLimit.set(session.maxTeamsLimit);
      this.maxPlayersPerTeam.set(session.maxPlayersPerTeam);
      this.wasKicked.set(false);
      this.hostDisconnected.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = session.roomCode.toUpperCase().trim();
      
      // Initialize Peer with host room code
      this.peer = new Peer(formattedCode, this.getPeerOptions());

      this.peer.on('open', (id) => {
        this.isHost.set(true);
        this.roomCode.set(id);
        this.myPlayerId.set(id);
        this.startPolling(id);
        
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
        this.startHostHeartbeatCheck();

        // If game was already in progress, navigate to /game
        if (this.gameState().phase !== 'LOBBY') {
          this.router.navigate(['/game']);
        }
        resolve(true);
      });

      this.peer.on('error', (err: any) => {
        const isNonFatal = err.type === 'negotiation-failed' || 
                            err.type === 'webrtc' || 
                            err.type === 'connection-closed' ||
                            (err.message && (err.message.includes('Negotiation') || err.message.includes('ICE') || err.message.includes('WebRTC')));
        if (isNonFatal) {
          console.warn('Ignoring non-fatal PeerJS Restore Host error:', err);
          return;
        }

        console.error('PeerJS Restore Host Error:', err);
        this.connectionState.set('error');
        if (err.type === 'unavailable-id') {
          this.errorMessage.set(`Wiederherstellung fehlgeschlagen: Raumcode "${formattedCode}" belegt.`);
        } else {
          this.errorMessage.set('Verbindung zum Signalisierungsserver bei Wiederherstellung fehlgeschlagen.');
        }
        safeSessionStorageRemove('jeopardy_p2p_session');
        resolve(false);
      });
    });
  }

  private restoreClientRoom(session: any): Promise<boolean> {
    this.logDebug('[Client] restoreClientRoom started with session:', session);
    return new Promise((resolve) => {
      this.cleanupForReconnection();
      this.wasKicked.set(false);
      this.hostDisconnected.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = session.roomCode.toUpperCase().trim();

      // Initialize Peer with a random ID
      this.peer = new Peer(this.getPeerOptions());

      this.peer.on('open', (myId) => {
        this.logDebug('[Client] Peer opened. New peer ID:', myId);
        this.myPlayerId.set(myId);
        
        // Connect to the Host using the room code
        this.logDebug(`[Client] Initiating connection to host: ${formattedCode} with originalPlayerId: ${session.myPlayerId}`);
        const conn = this.peer!.connect(formattedCode, {
          metadata: { 
            name: session.playerName, 
            color: session.playerColor, 
            avatar: session.playerAvatar || '',
            originalPlayerId: session.myPlayerId
          },
          reliable: true
        });

        let webRtcOk = false;
        conn.on('open', () => {
          this.logDebug('[Client] WebRTC connection open events fired. Setting setupClientListeners...');
          webRtcOk = true;
          this.setupClientListeners(conn, formattedCode, () => {
            this.logDebug('[Client] Session restore successful!');
            resolve(true);
          }, (err) => {
            this.logDebug('[Client] Session restore failed in listeners:', err);
            safeSessionStorageRemove('jeopardy_p2p_session');
            resolve(false);
          });
        });

        // 3 second WebRTC timeout -> HTTP relay fallback
        setTimeout(() => {
          if (!webRtcOk && this.connectionState() === 'connecting') {
            console.warn('WebRTC session restore timed out, falling back to HTTP relay...');
            
            conn.close();

            const relayConn = new HttpRelayConnection(
              formattedCode,
              myId,
              this.http,
              { 
                name: session.playerName, 
                color: session.playerColor, 
                avatar: session.playerAvatar || '',
                originalPlayerId: session.myPlayerId
              }
            );
            
            this.clientConnection = relayConn;
            this.startPolling(myId);

            this.setupClientListeners(relayConn as any, formattedCode, () => {
              resolve(true);
            }, (err) => {
              safeSessionStorageRemove('jeopardy_p2p_session');
              resolve(false);
            });

            relayConn.send({
              type: 'JOIN_REQ',
              senderId: myId,
              payload: {
                name: session.playerName,
                color: session.playerColor,
                avatar: session.playerAvatar || '',
                originalPlayerId: session.myPlayerId
              }
            });
          }
        }, 3000);
      });

      this.peer.on('error', (err: any) => {
        // Treat all errors during restoration as non-fatal to allow HTTP relay fallback
        this.logDebug('Ignoring PeerJS Restore Client Error (treating as non-fatal to allow HTTP relay fallback):', err);
      });
    });
  }

  /**
   * Initialize a new room as Host
   */
  hostRoom(
    roomCode: string, 
    hostName: string, 
    hostColor: string, 
    hostAvatar: string, 
    maxPlayers: number, 
    teamMode: boolean, 
    maxPlayersPerTeam: number,
    buzzerTimeout: number,
    deductPointsOnTimeout: boolean,
    autoStartTimer: boolean,
    selectedQuizzes: { id: string; name: string; icon: string; categoriesCount: number; questionsCount: number; }[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.maxPlayersLimit = maxPlayers;
      this.teamMode.set(teamMode);
      this.maxTeamsLimit.set(maxPlayers);
      this.maxPlayersPerTeam.set(maxPlayersPerTeam);

      this.gameState.set({
        ...this.createInitialGameState(),
        buzzerTimeout,
        deductPointsOnTimeout,
        autoStartTimer,
        timerActive: false,
        selectedQuizzes
      });

      this.wasKicked.set(false);
      this.hostDisconnected.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = roomCode.toUpperCase().trim();
      const safeHostColor = this.sanitizeColor(hostColor, '#f1b814');
      const safeHostAvatar = this.sanitizeAvatar(hostAvatar);
      
      // Initialize Peer with the custom room code
      this.peer = new Peer(formattedCode, this.getPeerOptions());

      this.peer.on('open', (id) => {
        this.isHost.set(true);
        this.roomCode.set(id);
        this.myPlayerId.set(id);

        // Log lobby creation on the backend
        this.http.post('/api/lobby/create', { roomCode: id }).subscribe({
          error: (err) => console.warn('Failed to log lobby creation:', err)
        });

        this.startPolling(id);
        this.connectionState.set('connected');
        this.startHostHeartbeatCheck();

        // Add host as the first player in the list
        this.players.set([{
          id: id,
          name: hostName,
          color: safeHostColor,
          avatar: safeHostAvatar,
          isHost: true,
          score: 0,
          ping: 0
        }]);

        // Listen for incoming player connections
        this.setupHostListeners();
        resolve();
      });

      this.peer.on('error', (err: any) => {
        const isNonFatal = err.type === 'negotiation-failed' || 
                            err.type === 'webrtc' || 
                            err.type === 'connection-closed' ||
                            (err.message && (err.message.includes('Negotiation') || err.message.includes('ICE') || err.message.includes('WebRTC')));
        if (isNonFatal) {
          console.warn('Ignoring non-fatal PeerJS Host error:', err);
          return;
        }

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
  joinRoom(roomCode: string, playerName: string, playerColor: string, playerAvatar: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.wasKicked.set(false);
      this.hostDisconnected.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = roomCode.toUpperCase().trim();

      // Initialize Peer with a random ID
      this.peer = new Peer(this.getPeerOptions());

      this.peer.on('open', (myId) => {
        this.myPlayerId.set(myId);
        
        // Connect to the Host using the room code
        const conn = this.peer!.connect(formattedCode, {
          metadata: { name: playerName, color: playerColor, avatar: playerAvatar },
          reliable: true
        });

        let webRtcOk = false;
        conn.on('open', () => {
          webRtcOk = true;
          this.setupClientListeners(conn, formattedCode, resolve, reject);
        });

        // 1.5 second WebRTC timeout -> HTTP relay fallback (reduced from 3s for faster connection)
        setTimeout(() => {
          if (!webRtcOk && this.connectionState() === 'connecting') {
            console.warn('WebRTC connection to host timed out, falling back to HTTP relay...');
            
            conn.close();

            const relayConn = new HttpRelayConnection(
              formattedCode,
              myId,
              this.http,
              { name: playerName, color: playerColor, avatar: playerAvatar }
            );
            
            this.clientConnection = relayConn;
            this.startPolling(myId);

            this.setupClientListeners(relayConn as any, formattedCode, resolve, reject);

            relayConn.send({
              type: 'JOIN_REQ',
              senderId: myId,
              payload: {
                name: playerName,
                color: playerColor,
                avatar: playerAvatar
              }
            });
          }
        }, 1500);
      });

      this.peer.on('error', (err: any) => {
        const isNonFatal = err.type === 'negotiation-failed' || 
                            err.type === 'webrtc' || 
                            err.type === 'connection-closed' ||
                            err.type === 'peer-unavailable' ||
                            (err.message && (err.message.includes('Negotiation') || err.message.includes('ICE') || err.message.includes('WebRTC')));
        if (this.clientConnection instanceof HttpRelayConnection || isNonFatal) {
          console.warn('Ignoring non-fatal PeerJS Client Error:', err);
          return;
        }

        console.error('PeerJS Client Error:', err);
        this.connectionState.set('error');
        this.errorMessage.set('Konnte keine P2P-Sitzung initiieren.');
        reject(err);
      });
    });
  }

  /**
   * Disconnect and cleanup all connections
   */
  disconnect() {
    this.stopHostTimer();
    this.stopPolling();
    this.stopHeartbeat();
    this.stopHostHeartbeatCheck();
    if (this.broadcastPlayerListTimer) {
      clearTimeout(this.broadcastPlayerListTimer);
      this.broadcastPlayerListTimer = null;
    }
    if (this.broadcastGameStateTimer) {
      clearTimeout(this.broadcastGameStateTimer);
      this.broadcastGameStateTimer = null;
    }
    
    // Client disconnect
    if (this.clientConnection) {
      this.clientConnection.close();
      this.clientConnection = null;
    }

    // Host disconnect
    this.hostConnectionMap.forEach(conn => conn.close());
    this.hostConnectionMap.clear();
    this.reconnectingOldIds.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // Reset state cleanly so subsequent lobbies never inherit stale game phase
    this.roomCode.set(null);
    this.isHost.set(false);
    this.connectionState.set('disconnected');
    this.players.set([]);
    this.myPlayerId.set(null);
    this.teamMode.set(false);
    this.maxTeamsLimit.set(4);
    this.maxPlayersPerTeam.set(2);
    this.chatMessages.set([]);
    this.gameState.set(this.createInitialGameState());
    this.hostFullBoards = [];
    safeSessionStorageRemove('jeopardy_host_full_boards');
  }

  cleanupForReconnection() {
    this.stopHostTimer();
    this.stopPolling();
    this.stopHeartbeat();
    this.stopHostHeartbeatCheck();
    
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
  }

  /**
   * Host Connection Listener: handle incoming guests
   */
  private setupHostListeners() {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      if (conn.open) {
        this.handleIncomingConnection(conn);
      } else {
        conn.on('open', () => {
          this.handleIncomingConnection(conn);
        });
      }
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

    const setup = () => {
      this.setupClientMessageListener(conn, resolve, reject);
      this.startHeartbeat();
    };

    if (conn.open) {
      setup();
    } else {
      conn.on('open', setup);
    }

    conn.on('close', () => {
      this.stopHeartbeat();
      // If we never reached 'connected' state, the close was caused by a rejected join (name_taken, lobby_full, etc.)
      // In that case, do NOT set hostDisconnected — the correct error is already in errorMessage from JOIN_ACK.
      if (this.connectionState() === 'connecting' || this.errorMessage()) {
        this.disconnect();
        return;
      }
      const hasSavedSession = safeSessionStorageGet('jeopardy_p2p_session');
      if (hasSavedSession && !this.wasKicked()) {
        console.log('Connection closed unexpectedly. Attempting to reconnect...');
        this.connectionState.set('connecting');
        
        const reconnectTimeout = setTimeout(() => {
          if (this.connectionState() === 'connecting') {
            console.log('Reconnection failed (host unavailable). Disconnecting.');
            this.disconnect();
            this.hostDisconnected.set(true);
          }
        }, 3500);

        this.tryRestoreSession().then((success) => {
          if (!success) {
            clearTimeout(reconnectTimeout);
            this.disconnect();
            this.hostDisconnected.set(true);
          }
        });
      } else {
        this.disconnect();
        if (!this.wasKicked()) {
          this.hostDisconnected.set(true);
        }
      }
    });

    conn.on('error', (err) => {
      this.stopHeartbeat();
      console.error('DataConnection Error:', err);
      this.connectionState.set('error');
      this.errorMessage.set('Verbindung zum Spielraum abgebrochen.');
      reject(err);
    });

    // Timeout if Host does not respond within 15 seconds
    setTimeout(() => {
      if (this.connectionState() === 'connecting') {
        this.disconnect();
        this.errorMessage.set('Spielraum antwortet nicht oder existiert nicht.');
        reject(new Error('Timeout connecting to host'));
      }
    }, 15000);
  }

  /**
   * Message handling for Host
   */
  private setupMessageListener(conn: DataConnection, playerId: string) {
    conn.on('data', (data: any) => {
      const msg = data as P2pMessage;
      if (!msg || typeof msg !== 'object') return;
      const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

      this.lastSeenMap.set(playerId, Date.now());

      if ((msg.type as any) === 'HEARTBEAT' || (msg.type as any) === 'PING' || (msg.type as any) === 'PONG') {
        if (msg.type === 'PING' && typeof payload.timestamp === 'number') {
          const pongMsg: P2pMessage = {
            type: 'PONG' as any,
            senderId: this.myPlayerId() || 'HOST',
            payload: { timestamp: payload.timestamp }
          };
          conn.send(pongMsg);

          if (typeof payload.lastPing === 'number' && Number.isFinite(payload.lastPing)) {
            const safePing = Math.max(0, Math.min(9999, Math.round(payload.lastPing)));
            const updatedPlayers = this.players().map(p => {
              if (p.id === playerId) {
                return { ...p, ping: safePing };
              }
              return p;
            });
            this.players.set(updatedPlayers);
            this.debouncedBroadcastPlayerList();
          }
        }
        return;
      }

      switch (msg.type) {
        case 'BUZZ':
          this.handleHostBuzzer(playerId);
          break;
        case 'SELECT_TEAM':
          if (typeof payload.teamId === 'number') {
            this.handleHostSelectTeam(playerId, payload.teamId);
          }
          break;
        case 'CHAT_MSG':
          this.handleHostChatMessage(playerId, msg);
          break;
        case 'VOTE_QUESTION':
          if (typeof payload.categoryIndex === 'number' && typeof payload.questionIndex === 'number') {
            this.handleHostVoteQuestion(playerId, payload.categoryIndex, payload.questionIndex);
          }
          break;
        default:
          break;
      }
    });

    conn.on('close', () => {
      if (this.reconnectingOldIds.has(playerId)) {
        return;
      }
      if (this.hostConnectionMap.get(playerId) !== conn) {
        return;
      }
      this.lastSeenMap.delete(playerId);
      this.hostConnectionMap.delete(playerId);
      const updatedPlayers = this.players().map(p => {
        if (p.id === playerId) {
          return { ...p, isOffline: true };
        }
        return p;
      });
      this.players.set(updatedPlayers);
      this.broadcastPlayerList();
      this.handlePlayerDisconnect(playerId);
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
      if (!msg || typeof msg !== 'object') return;

      if ((msg.type as any) === 'HEARTBEAT' || (msg.type as any) === 'PONG') {
        if (msg.type === 'PONG' && msg.payload && typeof msg.payload.timestamp === 'number') {
          const rtt = Math.max(0, Date.now() - msg.payload.timestamp);
          this.myPing.set(Math.round(rtt / 2));
        }
        return;
      }

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
            } else if (msg.payload?.reason === 'name_taken') {
              this.errorMessage.set('Dieser Name ist in dieser Lobby bereits vergeben.');
            } else if (msg.payload?.reason === 'invalid_name') {
              this.errorMessage.set('Der Name ist ungültig (2-14 Zeichen, nur Buchstaben, Zahlen, Leerzeichen, _ und -).');
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
          this.router.navigate(['/']);
          break;
        case 'CHAT_MSG':
          if (msg.payload) {
            this.chatMessages.update(msgs => [...msgs.slice(-199), msg.payload as ChatMessage]);
          }
          break;
        default:
          break;
      }
    });
  }

  private sendPingToHost() {
    if (!this.clientConnection || !this.clientConnection.open) return;
    const msg: P2pMessage = {
      type: 'PING' as any,
      senderId: this.myPlayerId() || '',
      payload: {
        timestamp: Date.now(),
        lastPing: this.myPing()
      }
    };
    this.clientConnection.send(msg);
  }

  /**
   * Host: Debounced broadcast of the player list.
   * When many players join in rapid succession, this batches all updates
   * into a single broadcast after a 300ms quiet period, avoiding O(n²) message storms.
   */
  private debouncedBroadcastPlayerList() {
    if (this.broadcastPlayerListTimer) {
      clearTimeout(this.broadcastPlayerListTimer);
    }
    this.broadcastPlayerListTimer = setTimeout(() => {
      this.broadcastPlayerListTimer = null;
      this.broadcastPlayerList();
    }, this.BROADCAST_DEBOUNCE_MS);
  }

  /**
   * Host: Debounced broadcast of the game state.
   * Same debounce logic as player list to batch rapid reconnection state updates.
   */
  private broadcastGameStateTimer: any = null;
  private debouncedBroadcastGameState() {
    if (this.broadcastGameStateTimer) {
      clearTimeout(this.broadcastGameStateTimer);
    }
    this.broadcastGameStateTimer = setTimeout(() => {
      this.broadcastGameStateTimer = null;
      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: this.gameState()
      });
    }, this.BROADCAST_DEBOUNCE_MS);
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

    const outboundMessage: P2pMessage =
      (message.type === 'GAME_STATE' || message.type === 'START_GAME') && message.payload
        ? { ...message, payload: this.sanitizeGameStateForClients(message.payload as GameState) }
        : message;

    // Collect HTTP relay receivers for batch sending
    const httpRelayReceivers: string[] = [];

    this.hostConnectionMap.forEach((conn) => {
      if (conn.open) {
        if (conn instanceof HttpRelayConnection) {
          httpRelayReceivers.push(conn.peer);
        } else {
          conn.send(outboundMessage);
        }
      }
    });

    // Batch send to all HTTP relay players in a single request
    if (httpRelayReceivers.length > 0) {
      this.http.post('/api/p2p/send-batch', {
        senderId: this.myPlayerId()!,
        receiverIds: httpRelayReceivers,
        message: outboundMessage
      }).subscribe({
        error: (err) => console.error('Failed to send batch HTTP relay message:', err)
      });
    }
  }

  broadcastToTeam(message: P2pMessage, teamId: number) {
    if (!this.isHost()) return;

    const httpRelayReceivers: string[] = [];
    const teamPlayerIds = this.players()
      .filter(p => !p.isHost && p.teamId === teamId)
      .map(p => p.id);

    this.hostConnectionMap.forEach((conn) => {
      if (conn.open && teamPlayerIds.includes(conn.peer)) {
        if (conn instanceof HttpRelayConnection) {
          httpRelayReceivers.push(conn.peer);
        } else {
          conn.send(message);
        }
      }
    });

    if (httpRelayReceivers.length > 0) {
      this.http.post('/api/p2p/send-batch', {
        senderId: this.myPlayerId()!,
        receiverIds: httpRelayReceivers,
        message: message
      }).subscribe({
        error: (err) => console.error('Failed to send team batch HTTP relay message:', err)
      });
    }
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
    this.hostConnectionMap.delete(playerId);
    this.lastSeenMap.delete(playerId);
    this.players.set(this.players().filter(p => p.id !== playerId));
    this.broadcastPlayerList();
    this.handlePlayerDisconnect(playerId);

    if (conn) {
      try {
        conn.send({
          type: 'KICK',
          senderId: this.myPlayerId()!,
          payload: {}
        });
        setTimeout(() => {
          try { conn.close(); } catch (e) {}
        }, 300);
      } catch (e) {
        console.warn('Error sending KICK message or closing connection:', e);
      }
    }
  }

  private timerId: any = null;

  unlockBuzzer() {
    if (!this.isHost()) return;
    this.buzzerActiveTime = Date.now();
    const current = this.gameState();
    const nextState: GameState = {
      ...current,
      buzzerLocked: false,
      audioPlaying: false
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  toggleQuestionAudio() {
    if (!this.isHost()) return;
    const current = this.gameState();
    if (!current.activeQuestion) return;

    const nextState: GameState = {
      ...current,
      audioPlaying: !current.audioPlaying
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  startHostTimer() {
    this.stopHostTimer();
    const current = this.gameState();
    
    // If buzzerTimeout is 0 (disabled), do not start interval/timer
    if (current.buzzerTimeout === 0) {
      const nextState = {
        ...current,
        timerSeconds: null,
        timerActive: false
      };
      this.gameState.set(nextState);
      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: nextState
      });
      return;
    }

    // Set initial timer seconds
    const nextState = {
      ...current,
      timerSeconds: current.buzzerTimeout,
      timerActive: true
    };
    this.gameState.set(nextState);

    this.timerId = setInterval(() => {
      const state = this.gameState();
      if (state.timerSeconds !== null && state.timerSeconds > 0) {
        const updatedState = {
          ...state,
          timerSeconds: state.timerSeconds - 1,
          timerActive: true
        };
        this.gameState.set(updatedState);

        if (updatedState.timerSeconds <= 0) {
          this.handleHostTimerTimeout();
        } else {
          this.broadcast({
            type: 'GAME_STATE',
            senderId: this.myPlayerId()!,
            payload: updatedState
          });
        }
      } else {
        this.stopHostTimer();
      }
    }, 1000);

    // Initial broadcast of starting timer state
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  stopHostTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    const current = this.gameState();
    if (current.timerSeconds !== null || current.timerActive) {
      const nextState = {
        ...current,
        timerSeconds: null,
        timerActive: false
      };
      this.gameState.set(nextState);
    }
  }

  startTimerManually() {
    if (!this.isHost()) return;
    this.startHostTimer();
  }

  private handleHostTimerTimeout() {
    this.stopHostTimer();
    const current = this.gameState();
    const playerId = current.buzzedPlayerId;
    if (!playerId || !current.activeQuestion || current.showAnswer) return;

    const shouldDeduct = !current.isInitialTurn || current.deductPointsOnTimeout;
    const value = current.activeQuestion.value;

    if (shouldDeduct && value > 0) {
      const updatedPlayers = this.players().map(p => {
        if (p.id === playerId) {
          return { ...p, score: p.score - value };
        }
        return p;
      });
      this.players.set(updatedPlayers);
      this.broadcastPlayerList();
    }

    // Reduce pixelation if enabled on wrong/timeout
    let updatedActiveQuestion = current.activeQuestion;
    if (updatedActiveQuestion.pixelate && updatedActiveQuestion.reducePixelationOnWrong) {
      const currentStrength = updatedActiveQuestion.pixelateStrength ?? 80;
      const amount = updatedActiveQuestion.reducePixelationAmount ?? 5;
      updatedActiveQuestion = {
        ...updatedActiveQuestion,
        pixelateStrength: Math.max(1, currentStrength - amount)
      };
    }

    // Add to lock out lists
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

    const activePlayers = this.players().filter(p => !p.isHost && !p.isOffline);
    const allLockedOut = this.teamMode()
      ? this.teamsArray().every(teamId => {
          const teamPlayers = activePlayers.filter(p => p.teamId === teamId);
          if (teamPlayers.length === 0) return true;
          return lockedOutTeams.includes(teamId);
        })
      : activePlayers.every(p => lockedOutPlayers.includes(p.id));

    let nextState: GameState;
    if (allLockedOut) {
      const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
      const answeredQuestions = current.answeredQuestions.includes(questionKey)
        ? current.answeredQuestions
        : [...current.answeredQuestions, questionKey];
      nextState = {
        ...current,
        activeQuestion: updatedActiveQuestion,
        showAnswer: true,
        buzzedPlayerId: null,
        buzzerLocked: true,
        timerSeconds: null,
        isInitialTurn: false,
        lockedOutPlayerIds: lockedOutPlayers,
        lockedOutTeamIds: lockedOutTeams,
        answeredQuestions,
        lastAnswerResult: {
          correct: false,
          playerName: '',
          value
        }
      };
    } else {
      if (!current.isInitialTurn) {
        this.buzzerActiveTime = Date.now();
      }
      nextState = {
        ...current,
        activeQuestion: updatedActiveQuestion,
        buzzedPlayerId: null,
        buzzerLocked: current.isInitialTurn,
        timerSeconds: null,
        isInitialTurn: false,
        lockedOutPlayerIds: lockedOutPlayers,
        lockedOutTeamIds: lockedOutTeams,
        audioPlaying: false
      };
    }

    if (shouldDeduct && value > 0) {
      const categoryName = current.categories[current.activeQuestion.categoryIndex]?.name || 'Unbekannt';
      const timeoutEvent: GameEvent = {
        type: 'AWARD',
        timestamp: Date.now(),
        playerId,
        playerName: player ? player.name : 'Spieler',
        value: -value,
        categoryName
      };

      nextState = {
        ...nextState,
        history: [...(nextState.history || []), timeoutEvent]
      };
    }

    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  private handleHostBuzzer(playerId: string) {
    if (!this.isHost()) return;
    const current = this.gameState();

    if (current.isInitialTurn || current.buzzerLocked) return;

    if (current.lockedOutPlayerIds && current.lockedOutPlayerIds.includes(playerId)) {
      return;
    }

    const player = this.players().find(p => p.id === playerId);
    if (this.teamMode() && player && player.teamId && current.lockedOutTeamIds && current.lockedOutTeamIds.includes(player.teamId)) {
      return;
    }

    if (current.phase === 'QUESTION' && current.buzzedPlayerId === null) {
      const reactionTime = Date.now() - this.buzzerActiveTime;
      const buzzEvent: GameEvent = {
        type: 'BUZZ',
        timestamp: Date.now(),
        playerId,
        playerName: player ? player.name : 'Spieler',
        value: reactionTime
      };

      const nextState: GameState = {
        ...current,
        buzzedPlayerId: playerId,
        buzzerLocked: true,
        audioPlaying: true,
        history: [...(current.history || []), buzzEvent]
      };
      this.gameState.set(nextState);

      // Start countdown timer (which updates gameState and broadcasts with timerSeconds set)
      if (current.buzzerTimeout > 0) {
        this.startHostTimer();
      } else {
        this.broadcast({
          type: 'GAME_STATE',
          senderId: this.myPlayerId()!,
          payload: this.gameState()
        });
      }
    }
  }

  getNextSelectorId(currentState: GameState): string | null {
    const activePlayers = this.players().filter(p => !p.isHost && !p.isOffline);
    if (activePlayers.length === 0) return this.myPlayerId(); // Fallback to host

    if (this.teamMode()) {
      // Rotate through teams that have active players
      const activeTeams = [...new Set(activePlayers.filter(p => p.teamId !== undefined).map(p => p.teamId!))].sort((a, b) => a - b);
      if (activeTeams.length === 0) return this.myPlayerId();

      const currentSelector = currentState.activeSelectorId;
      if (!currentSelector || !currentSelector.startsWith('team-')) {
        return `team-${activeTeams[0]}`;
      }

      const currentTeamId = parseInt(currentSelector.replace('team-', ''), 10);
      const currentIndex = activeTeams.indexOf(currentTeamId);
      if (currentIndex === -1) {
        return `team-${activeTeams[0]}`;
      }
      const nextIndex = (currentIndex + 1) % activeTeams.length;
      return `team-${activeTeams[nextIndex]}`;
    } else {
      // Rotate through active players
      const currentSelector = currentState.activeSelectorId;
      const currentIndex = activePlayers.findIndex(p => p.id === currentSelector);
      if (currentIndex === -1) {
        return activePlayers[0].id;
      }
      const nextIndex = (currentIndex + 1) % activePlayers.length;
      return activePlayers[nextIndex].id;
    }
  }

  handlePlayerDisconnect(playerId: string) {
    if (!this.isHost()) return;
    const current = this.gameState();
    
    // Remove their votes
    const nextVotes = { ...current.votes };
    let votesChanged = false;
    for (const key in nextVotes) {
      if (nextVotes[key] && nextVotes[key].includes(playerId)) {
        nextVotes[key] = nextVotes[key].filter(id => id !== playerId);
        votesChanged = true;
      }
    }

    let nextSelector = current.activeSelectorId;
    let selectorChanged = false;

    if (this.teamMode()) {
      const player = this.players().find(p => p.id === playerId);
      if (player && player.teamId !== undefined) {
        const teamPlayers = this.players().filter(p => !p.isHost && !p.isOffline && p.teamId === player.teamId);
        if (teamPlayers.length === 0 && current.activeSelectorId === `team-${player.teamId}`) {
          nextSelector = this.getNextSelectorId(current);
          selectorChanged = true;
        }
      }
    } else {
      if (current.activeSelectorId === playerId) {
        nextSelector = this.getNextSelectorId(current);
        selectorChanged = true;
      }
    }

    if (votesChanged || selectorChanged) {
      const nextState: GameState = {
        ...current,
        activeSelectorId: nextSelector,
        votes: nextVotes
      };
      this.gameState.set(nextState);
      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: nextState
      });
    }
  }

  private handleHostVoteQuestion(playerId: string, categoryIndex: number, questionIndex: number) {
    if (!this.isHost()) return;
    const current = this.gameState();
    if (current.phase !== 'BOARD') return;

    // Validate integer bounds against active categories
    if (
      !Number.isInteger(categoryIndex) ||
      !Number.isInteger(questionIndex) ||
      categoryIndex < 0 ||
      categoryIndex >= current.categories.length ||
      questionIndex < 0 ||
      questionIndex >= (current.categories[categoryIndex]?.questions?.length || 0)
    ) {
      return;
    }

    const player = this.players().find(p => p.id === playerId);
    if (!player) return;

    let authorized = false;
    if (this.teamMode()) {
      const activeTeamStr = current.activeSelectorId;
      if (activeTeamStr) {
        const activeTeamId = parseInt(activeTeamStr.replace('team-', ''), 10);
        authorized = player.teamId === activeTeamId;
      }
    } else {
      authorized = current.activeSelectorId === playerId;
    }

    if (!authorized) return;

    const questionKey = `${categoryIndex}-${questionIndex}`;
    if (current.answeredQuestions.includes(questionKey)) return;

    const nextVotes = { ...current.votes };

    if (this.teamMode()) {
      for (const key in nextVotes) {
        if (nextVotes[key] && nextVotes[key].includes(playerId)) {
          nextVotes[key] = nextVotes[key].filter(id => id !== playerId);
        }
      }
      if (!nextVotes[questionKey]) {
        nextVotes[questionKey] = [];
      }
      if (!nextVotes[questionKey].includes(playerId)) {
        nextVotes[questionKey].push(playerId);
      }
    } else {
      for (const key in nextVotes) {
        delete nextVotes[key];
      }
      nextVotes[questionKey] = [playerId];
    }

    const nextState: GameState = {
      ...current,
      votes: nextVotes
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  voteQuestion(categoryIndex: number, questionIndex: number) {
    this.sendToHost({
      type: 'VOTE_QUESTION',
      senderId: this.myPlayerId()!,
      payload: { categoryIndex, questionIndex }
    });
  }

  startGame(boards: Category[][]) {
    if (!this.isHost()) return;
    
    // Save host full boards (wrapped in try/catch to avoid QuotaExceededError with large media)
    this.hostFullBoards = boards;
    try {
      safeSessionStorageSet('jeopardy_host_full_boards', JSON.stringify(boards));
    } catch (err) {
      console.warn('Could not persist full boards to sessionStorage (quota exceeded):', err);
    }

    // Reset all player scores to 0
    const resetPlayers = this.players().map(p => ({ ...p, score: 0 }));
    this.players.set(resetPlayers);
    this.broadcastPlayerList();

    const current = this.gameState();
    const categories = boards[0] || [];

    // Strip categories and boards to keep the network payload tiny
    const strippedCategories = this.stripCategories(categories);
    const strippedBoards = this.stripBoards(boards);

    const tempStateForSelector: GameState = {
      phase: 'BOARD',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      categories: strippedCategories,
      activeSelectorId: null,
      votes: {},
      showAnswer: false,
      lastAnswerResult: null,
      buzzerTimeout: current.buzzerTimeout,
      deductPointsOnTimeout: current.deductPointsOnTimeout,
      autoStartTimer: current.autoStartTimer,
      timerActive: false,
      timerSeconds: null,
      isInitialTurn: false,
      audioPlaying: false,
      boards: strippedBoards,
      currentBoardIndex: 0,
      history: []
    };
    const firstSelector = this.getNextSelectorId(tempStateForSelector);

    const initialState: GameState = {
      ...tempStateForSelector,
      activeSelectorId: firstSelector
    };
    this.gameState.set(initialState);
    
    this.broadcast({
      type: 'START_GAME',
      senderId: this.myPlayerId()!,
      payload: initialState
    });

    this.router.navigate(['/game']);
  }

  updateSelectedQuizzes(quizzes: { id: string; name: string; icon: string; categoriesCount: number; questionsCount: number; }[]) {
    if (!this.isHost()) return;
    const current = this.gameState();
    const nextState = {
      ...current,
      selectedQuizzes: quizzes
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  nextBoard() {
    if (!this.isHost()) return;
    
    const current = this.gameState();
    if (!current.boards || current.currentBoardIndex === undefined) return;
    const nextIdx = current.currentBoardIndex + 1;
    if (nextIdx >= current.boards.length) return;

    const categories = current.boards[nextIdx];

    // Fix turn changing twice: preserve the current active selector when transitioning to the next board.
    // Fall back to calculating next selector if the current active selector is not set.
    const nextSelector = current.activeSelectorId || this.getNextSelectorId({
      ...current,
      categories,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      currentBoardIndex: nextIdx,
      votes: {}
    });

    const nextState: GameState = {
      ...current,
      phase: 'BOARD',
      activeQuestion: null,
      showAnswer: false,
      buzzedPlayerId: null,
      buzzerLocked: false,
      timerSeconds: null,
      timerActive: false,
      isInitialTurn: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      votes: {},
      categories,
      currentBoardIndex: nextIdx,
      activeSelectorId: nextSelector,
      lastAnswerResult: null,
      audioPlaying: false
    };

    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  selectQuestion(categoryIndex: number, questionIndex: number) {
    if (!this.isHost()) return;
    const current = this.gameState();

    // Find the player representing the active selector
    let initialBuzzedPlayerId: string | null = null;
    if (this.teamMode()) {
      const activeTeamStr = current.activeSelectorId;
      if (activeTeamStr) {
        const teamId = parseInt(activeTeamStr.replace('team-', ''), 10);
        const player = this.players().find(p => !p.isHost && !p.isOffline && p.teamId === teamId);
        initialBuzzedPlayerId = player ? player.id : null;
      }
    } else {
      initialBuzzedPlayerId = current.activeSelectorId;
    }

    // Lookup full question from our local complete copy
    const currentBoardIndex = current.currentBoardIndex || 0;
    const fullCategory = this.hostFullBoards[currentBoardIndex]?.[categoryIndex];
    const question = fullCategory?.questions?.[questionIndex];
    
    if (!question) {
      console.error('Question not found in hostFullBoards:', { currentBoardIndex, categoryIndex, questionIndex });
      return;
    }

    this.buzzerActiveTime = Date.now();
    const value = question.value;
    const text = question.text;
    const answer = question.answer;
    const image = question.image || undefined;
    const pixelate = question.pixelate || false;
    const pixelateStrength = question.pixelateStrength || 80;
    const reducePixelationOnWrong = question.reducePixelationOnWrong || false;
    const reducePixelationAmount = question.reducePixelationAmount || 5;
    const zoom = question.zoom || 1.0;
    const rotation = question.rotation || 0;
    const audio = question.audio || undefined;
    const audioStart = question.audioStart;
    const audioEnd = question.audioEnd;
    const audioSpeed = question.audioSpeed;
    const audioPitch = question.audioPitch;

    const nextState: GameState = {
      ...current,
      phase: 'QUESTION',
      activeQuestion: { 
        categoryIndex, 
        questionIndex, 
        value, 
        text, 
        answer, 
        image, 
        pixelate, 
        pixelateStrength, 
        reducePixelationOnWrong, 
        reducePixelationAmount,
        zoom,
        rotation,
        audio,
        audioStart,
        audioEnd,
        audioSpeed,
        audioPitch
      },
      buzzedPlayerId: initialBuzzedPlayerId,
      buzzerLocked: true, // Lock the buzzer so others cannot buzz yet
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      showAnswer: false,
      lastAnswerResult: null,
      isInitialTurn: true, // Initial turn is active
      timerSeconds: current.buzzerTimeout === 0 ? null : current.buzzerTimeout,
      timerActive: current.buzzerTimeout > 0 ? (current.autoStartTimer !== false) : false,
      audioPlaying: true
    };
    this.gameState.set(nextState);

    // Start timer for the initial selector player if auto start is enabled
    if (current.buzzerTimeout > 0 && current.autoStartTimer !== false) {
      this.startHostTimer();
    } else {
      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: nextState
      });
    }
  }

  awardPoints(playerId: string, correct: boolean) {
    if (!this.isHost()) return;
    const current = this.gameState();
    if (!current.activeQuestion || current.showAnswer) return;

    this.stopHostTimer(); // STOP TIMEOUT COUNTDOWN

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
    const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
    const withAnswered = current.answeredQuestions.includes(questionKey)
      ? current.answeredQuestions
      : [...current.answeredQuestions, questionKey];

    let nextState: GameState;
    if (correct) {
      const winnerName = this.players().find(p => p.id === playerId)?.name || 'Ein Spieler';
      nextState = {
        ...current,
        showAnswer: true,
        buzzedPlayerId: null,
        buzzerLocked: true,
        timerSeconds: null,
        isInitialTurn: false,
        answeredQuestions: withAnswered,
        lastAnswerResult: {
          correct: true,
          playerName: winnerName,
          value
        }
      };
    } else {
      let updatedActiveQuestion = current.activeQuestion;
      if (updatedActiveQuestion && updatedActiveQuestion.pixelate && updatedActiveQuestion.reducePixelationOnWrong) {
        const currentStrength = updatedActiveQuestion.pixelateStrength ?? 80;
        const amount = updatedActiveQuestion.reducePixelationAmount ?? 5;
        const newStrength = Math.max(1, currentStrength - amount);
        updatedActiveQuestion = {
          ...updatedActiveQuestion,
          pixelateStrength: newStrength
        };
      }

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

      const activePlayers = this.players().filter(p => !p.isHost && !p.isOffline);
      const allLockedOut = this.teamMode()
        ? this.teamsArray().every(teamId => {
            const teamPlayers = activePlayers.filter(p => p.teamId === teamId);
            if (teamPlayers.length === 0) return true;
            return lockedOutTeams.includes(teamId);
          })
        : activePlayers.every(p => lockedOutPlayers.includes(p.id));

      if (allLockedOut) {
        nextState = {
          ...current,
          activeQuestion: updatedActiveQuestion,
          showAnswer: true,
          buzzedPlayerId: null,
          buzzerLocked: true,
          timerSeconds: null,
          isInitialTurn: false,
          lockedOutPlayerIds: lockedOutPlayers,
          lockedOutTeamIds: lockedOutTeams,
          answeredQuestions: withAnswered,
          lastAnswerResult: {
            correct: false,
            playerName: '',
            value
          }
        };
      } else {
        if (!current.isInitialTurn) {
          this.buzzerActiveTime = Date.now();
        }
        nextState = {
          ...current,
          activeQuestion: updatedActiveQuestion,
          buzzedPlayerId: null,
          buzzerLocked: current.isInitialTurn,
          timerSeconds: null,
          isInitialTurn: false,
          lockedOutPlayerIds: lockedOutPlayers,
          lockedOutTeamIds: lockedOutTeams,
          audioPlaying: false
        };
      }
    }

    const player = this.players().find(p => p.id === playerId);
    const categoryName = current.categories[current.activeQuestion.categoryIndex]?.name || 'Unbekannt';
    const scoreDelta = correct ? value : -value;
    const awardEvent: GameEvent = {
      type: 'AWARD',
      timestamp: Date.now(),
      playerId,
      playerName: player ? player.name : 'Spieler',
      value: scoreDelta,
      categoryName
    };

    nextState = {
      ...nextState,
      history: [...(nextState.history || []), awardEvent]
    };

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
    if (!current.activeQuestion || current.showAnswer) return;
    this.stopHostTimer();

    const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
    const answeredQuestions = current.answeredQuestions.includes(questionKey)
      ? current.answeredQuestions
      : [...current.answeredQuestions, questionKey];

    const nextState: GameState = {
      ...current,
      showAnswer: true,
      buzzedPlayerId: null,
      buzzerLocked: true,
      timerSeconds: null,
      isInitialTurn: false,
      answeredQuestions,
      lastAnswerResult: {
        correct: false,
        playerName: '',
        value: current.activeQuestion.value
      }
    };

    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  backToBoard() {
    if (!this.isHost()) return;
    this.stopHostTimer();
    
    const current = this.gameState();
    
    // Check if the game is completely over (no more questions and no more boards left)
    const totalQuestions = current.categories ? current.categories.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0) : 0;
    const isBoardComplete = current.answeredQuestions.length >= totalQuestions;
    const hasNextBoard = current.boards && current.currentBoardIndex !== undefined && (current.currentBoardIndex + 1 < current.boards.length);

    if (isBoardComplete && !hasNextBoard) {
      this.endGame();
      return;
    }
    
    // Advance active selector
    const nextSelector = this.getNextSelectorId(current);

    const nextState: GameState = {
      ...current,
      phase: 'BOARD',
      activeQuestion: null,
      showAnswer: false,
      buzzedPlayerId: null,
      buzzerLocked: false,
      timerSeconds: null,
      timerActive: false,
      isInitialTurn: false,
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      votes: {}, // Clear votes for the next round
      activeSelectorId: nextSelector,
      lastAnswerResult: null
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
    this.stopHostTimer();
    
    const current = this.gameState();
    const nextState: GameState = {
      ...current,
      phase: 'SUMMARY',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      timerSeconds: null,
      timerActive: false,
      isInitialTurn: false
    };
    this.gameState.set(nextState);
    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  cancelGame() {
    if (!this.isHost()) return;
    this.stopHostTimer();

    const current = this.gameState();
    const nextState: GameState = {
      ...current,
      phase: 'LOBBY',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      timerSeconds: null,
      isInitialTurn: false,
      votes: {}
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
    // Prevent mid-game team switching & invalid team IDs
    if (this.gameState().phase !== 'LOBBY' || !this.teamMode()) return;
    if (!Number.isInteger(teamId) || teamId < 1 || teamId > this.maxTeamsLimit()) return;

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

  sendChatMessage(text: string, isTeam: boolean = false) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const me = this.me();
    const senderName = me ? me.name : (this.isHost() ? 'Host' : 'Spieler');
    const senderColor = me ? me.color : '#f1b814';
    const senderAvatar = me ? (me.avatar || '') : '';
    const teamId = (isTeam && me && me.teamId !== undefined) ? me.teamId : undefined;

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: this.myPlayerId() || 'unknown',
      senderName,
      senderColor,
      senderAvatar,
      text: trimmed,
      timestamp: Date.now(),
      teamId
    };

    if (this.isHost()) {
      this.chatMessages.update(msgs => [...msgs.slice(-199), chatMsg]);
      this.broadcast({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: chatMsg
      });
    } else {
      this.sendToHost({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: {
          text: trimmed,
          isTeam: Boolean(isTeam)
        }
      });
    }
  }

  private handleHostChatMessage(verifiedPlayerId: string, msg: P2pMessage) {
    if (!this.isHost()) return;

    const rawText = msg.payload?.text;
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.trim().length > 200) {
      return;
    }

    // Derive sender identity and team strictly from Host's authoritative player list
    const senderPlayer = this.players().find(p => p.id === verifiedPlayerId && !p.isHost);
    if (!senderPlayer) return;

    const wantsTeamChat = msg.payload?.isTeam === true || typeof msg.payload?.teamId === 'number';
    const teamId = wantsTeamChat && this.teamMode() && senderPlayer.teamId !== undefined
      ? senderPlayer.teamId
      : undefined;

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: senderPlayer.id,
      senderName: senderPlayer.name,
      senderColor: this.sanitizeColor(senderPlayer.color),
      senderAvatar: this.sanitizeAvatar(senderPlayer.avatar),
      text: rawText.trim(),
      timestamp: Date.now(),
      teamId
    };

    this.chatMessages.update(msgs => [...msgs.slice(-199), chatMsg]);

    if (teamId !== undefined) {
      this.broadcastToTeam({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: chatMsg
      }, teamId);
    } else {
      this.broadcast({
        type: 'CHAT_MSG',
        senderId: this.myPlayerId()!,
        payload: chatMsg
      });
    }
  }

  private heartbeatIntervalId: any = null;

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatIntervalId = setInterval(() => {
      this.sendToHost({
        type: 'HEARTBEAT',
        senderId: this.myPlayerId()!,
        payload: {}
      });
    }, 3000);
  }

  private stopHeartbeat() {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  private lastSeenMap = new Map<string, number>();
  private hostHeartbeatCheckIntervalId: any = null;

  private startHostHeartbeatCheck() {
    this.stopHostHeartbeatCheck();
    this.hostHeartbeatCheckIntervalId = setInterval(() => {
      const now = Date.now();
      const timedOutIds: string[] = [];

      const updatedPlayers = this.players().map(p => {
        if (p.isHost || p.isOffline) return p;

        const lastSeen = this.lastSeenMap.get(p.id);
        if (!lastSeen || now - lastSeen > 9000) {
          timedOutIds.push(p.id);
          return { ...p, isOffline: true };
        }
        return p;
      });

      if (timedOutIds.length > 0) {
        // Update players list FIRST so handlePlayerDisconnect sees isOffline === true
        this.players.set(updatedPlayers);
        for (const id of timedOutIds) {
          const staleConn = this.hostConnectionMap.get(id);
          this.hostConnectionMap.delete(id);
          this.lastSeenMap.delete(id);
          if (staleConn) {
            try { staleConn.close(); } catch (e) {}
          }
          this.handlePlayerDisconnect(id);
        }
        this.broadcastPlayerList();
      }
    }, 3000);
  }

  private stopHostHeartbeatCheck() {
    if (this.hostHeartbeatCheckIntervalId) {
      clearInterval(this.hostHeartbeatCheckIntervalId);
      this.hostHeartbeatCheckIntervalId = null;
    }
    this.lastSeenMap.clear();
  }

  private logDebug(_message: string, _data?: any) {
    // Debug logging disabled in production to avoid leaking session state
  }
}
