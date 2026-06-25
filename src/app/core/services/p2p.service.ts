import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Peer, DataConnection } from 'peerjs';
import { Category } from './quiz.service';

export interface Player {
  id: string;
  name: string;
  color: string;
  avatar?: string;
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
    image?: string;
    pixelate?: boolean;
    pixelateStrength?: number;
    reducePixelationOnWrong?: boolean;
    reducePixelationAmount?: number;
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
  isInitialTurn: boolean;
  audioPlaying?: boolean;
  boards?: Category[][];
  currentBoardIndex?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
}

export interface P2pMessage {
  type: 'JOIN_ACK' | 'PLAYER_LIST' | 'GAME_STATE' | 'KICK' | 'BUZZ' | 'START_GAME' | 'SELECT_TEAM' | 'CHAT_MSG' | 'VOTE_QUESTION' | 'JOIN_REQ' | 'HEARTBEAT';
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
    categories: [],
    activeSelectorId: null,
    votes: {},
    showAnswer: false,
    lastAnswerResult: null,
    buzzerTimeout: 20,
    deductPointsOnTimeout: false,
    timerSeconds: null,
    isInitialTurn: false,
    audioPlaying: false
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

  private getPeerOptions(): any {
    const host = window.location.hostname;
    const secure = window.location.protocol === 'https:';

    const options: any = {
      host: host,
      path: '/peerjs',
      secure: secure,
      debug: 3,
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

  // HTTP Polling Fallback System
  private isPolling = false;
  private startPolling(myId: string) {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollNext(myId);
  }

  private stopPolling() {
    this.isPolling = false;
  }

  private pollNext(myId: string) {
    if (!this.isPolling || !this.peer) return;

    this.http.get<{ messages: Array<{ senderId: string, message: any }> }>(`/api/p2p/poll/${myId}`).subscribe({
      next: (res) => {
        if (res && res.messages) {
          for (const item of res.messages) {
            this.handleRelayedMessage(item.senderId, item.message);
          }
        }
        // Poll again immediately
        setTimeout(() => this.pollNext(myId), 100);
      },
      error: (err) => {
        console.warn('HTTP poll failed, retrying in 2s...', err);
        setTimeout(() => this.pollNext(myId), 2000);
      }
    });
  }

  private handleRelayedMessage(senderId: string, msg: any) {
    if (this.isHost()) {
      if (msg.type === 'JOIN_REQ') {
        // Create an HTTP Relay Connection for this player
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
    const playerName = metadata.name || 'Unbekannt';
    const playerColor = metadata.color || '#0052cc';
    const playerAvatar = metadata.avatar || '';

    // Check if player is reconnecting with an existing session (by ID or matching name when offline)
    const originalPlayerId = metadata.originalPlayerId;
    let existingPlayerIndex = -1;

    this.logDebug('[Host] Incoming connection request:', {
      playerId,
      playerName,
      originalPlayerId,
      players: this.players().map(p => ({ id: p.id, name: p.name, isOffline: p.isOffline, isHost: p.isHost }))
    });

    if (originalPlayerId) {
      existingPlayerIndex = this.players().findIndex(p => p.id === originalPlayerId);
      this.logDebug('[Host] Checked originalPlayerId, existingPlayerIndex:', existingPlayerIndex);
    }
    
    if (existingPlayerIndex === -1 && playerName) {
      existingPlayerIndex = this.players().findIndex(
        p => p.isOffline && p.name.trim().toLowerCase() === playerName.trim().toLowerCase()
      );
      this.logDebug('[Host] Checked offline name match, existingPlayerIndex:', existingPlayerIndex);
    }

    if (existingPlayerIndex !== -1) {
      const existingPlayer = this.players()[existingPlayerIndex];
      const oldPlayerId = existingPlayer.id;

      // Close old connection if it exists
      const oldConn = this.hostConnectionMap.get(oldPlayerId);
      if (oldConn) {
        try {
          oldConn.close();
        } catch (e) {
          console.warn('Error closing old connection during takeover:', e);
        }
      }

      // Update the connection in map (remove old, add new)
      this.hostConnectionMap.delete(oldPlayerId);
      this.hostConnectionMap.set(playerId, conn);
      
      this.lastSeenMap.delete(oldPlayerId);
      this.lastSeenMap.set(playerId, Date.now());
      
      // Update player list with new Peer ID, clear isOffline
      const updatedPlayers = [...this.players()];
      updatedPlayers[existingPlayerIndex] = {
        ...existingPlayer,
        id: playerId, // Update to new Peer ID
        name: playerName,
        color: playerColor,
        avatar: playerAvatar,
        isOffline: false
      };
      this.players.set(updatedPlayers);

      // Update game state references if they reference oldPlayerId
      const currentGameState = this.gameState();
      let stateChanged = false;
      let updatedBuzzedPlayerId = currentGameState.buzzedPlayerId;
      let updatedLockedOutPlayerIds = [...currentGameState.lockedOutPlayerIds];

      if (currentGameState.buzzedPlayerId === oldPlayerId) {
        updatedBuzzedPlayerId = playerId;
        stateChanged = true;
      }
      if (currentGameState.lockedOutPlayerIds.includes(oldPlayerId)) {
        updatedLockedOutPlayerIds = currentGameState.lockedOutPlayerIds.map(id => id === oldPlayerId ? playerId : id);
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

    // Validate player name length and characters (Host authority validation)
    const trimmedName = playerName ? playerName.trim() : '';
    const nameRegex = /^[a-zA-Z0-9_\-\säöüÄÖÜß]+$/;
    if (trimmedName.length < 2 || trimmedName.length > 14 || !nameRegex.test(trimmedName)) {
      conn.send({
        type: 'JOIN_ACK',
        senderId: this.myPlayerId()!,
        payload: { success: false, reason: 'invalid_name' }
      });
      setTimeout(() => conn.close(), 500);
      return;
    }

    // Check if there is an ACTIVE player with the same name (case-insensitive)
    const isNameTaken = this.players().some(
      p => !p.isOffline && p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    this.logDebug('[Host] Checking if name is taken:', { playerName: trimmedName, isNameTaken });

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
      { id: playerId, name: playerName, color: playerColor, avatar: playerAvatar, isHost: false, score: 0, teamId, isOffline: false }
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
        maxPlayersPerTeam: this.maxPlayersPerTeam(),
        gameState: this.gameState(),
        chatHistory: this.chatMessages()
      }
    };
    conn.send(ackMessage);

    // 5. Broadcast updated player list to everyone
    this.broadcastPlayerList();

    // 6. Handle messages from this client
    this.setupMessageListener(conn, playerId);
  }




  constructor() {
    this.fetchIceServers();
    
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
          playerAvatar: me ? (me.avatar || '') : '',
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
    this.logDebug('tryRestoreSession called. Session data from storage:', dataStr);
    if (!dataStr) return Promise.resolve(false);

    try {
      const session = JSON.parse(dataStr);
      if (!session || !session.roomCode) {
        this.logDebug('Session data invalid, removing session.');
        sessionStorage.removeItem('jeopardy_p2p_session');
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
      sessionStorage.removeItem('jeopardy_p2p_session');
      this.connectionState.set('disconnected');
      return Promise.resolve(false);
    }
  }

  private restoreHostRoom(session: any): Promise<boolean> {
    return new Promise((resolve) => {
      this.cleanupForReconnection(); // Clear any existing instance state first
      this.maxPlayersLimit = session.maxPlayers;
      this.teamMode.set(session.teamMode);
      this.maxTeamsLimit.set(session.maxTeamsLimit);
      this.maxPlayersPerTeam.set(session.maxPlayersPerTeam);
      this.wasKicked.set(false);
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
        sessionStorage.removeItem('jeopardy_p2p_session');
        resolve(false);
      });
    });
  }

  private restoreClientRoom(session: any): Promise<boolean> {
    this.logDebug('[Client] restoreClientRoom started with session:', session);
    return new Promise((resolve) => {
      this.cleanupForReconnection();
      this.wasKicked.set(false);
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
            sessionStorage.removeItem('jeopardy_p2p_session');
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
              sessionStorage.removeItem('jeopardy_p2p_session');
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
    deductPointsOnTimeout: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.maxPlayersLimit = maxPlayers;
      this.teamMode.set(teamMode);
      this.maxTeamsLimit.set(maxPlayers);
      this.maxPlayersPerTeam.set(maxPlayersPerTeam);

      const current = this.gameState();
      this.gameState.set({
        ...current,
        buzzerTimeout,
        deductPointsOnTimeout
      });

      this.wasKicked.set(false);
      this.connectionState.set('connecting');
      this.errorMessage.set('');

      const formattedCode = roomCode.toUpperCase().trim();
      
      // Initialize Peer with the custom room code
      this.peer = new Peer(formattedCode, this.getPeerOptions());

      this.peer.on('open', (id) => {
        this.isHost.set(true);
        this.roomCode.set(id);
        this.myPlayerId.set(id);
        this.startPolling(id);
        this.connectionState.set('connected');
        this.startHostHeartbeatCheck();

        // Add host as the first player in the list
        this.players.set([{
          id: id,
          name: hostName,
          color: hostColor,
          avatar: hostAvatar,
          isHost: true,
          score: 0
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

        // 3 second WebRTC timeout -> HTTP relay fallback
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
        }, 3000);
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
      if (!msg) return;

      this.lastSeenMap.set(playerId, Date.now());

      if ((msg.type as any) === 'HEARTBEAT') {
        return;
      }

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
        case 'VOTE_QUESTION':
          this.handleHostVoteQuestion(playerId, msg.payload.categoryIndex, msg.payload.questionIndex);
          break;
        default:
          break;
      }
    });

    conn.on('close', () => {
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
      if (!msg) return;

      console.log(`Client received [${msg.type}] from Host:`, msg.payload);

      switch (msg.type) {
        case 'JOIN_ACK':
          this.logDebug('Client received JOIN_ACK from host:', msg.payload);
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
            this.logDebug('JOIN_ACK failed, reason:', msg.payload?.reason);
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
      try {
        conn.send({
          type: 'KICK',
          senderId: this.myPlayerId()!,
          payload: {}
        });
        conn.close();
      } catch (e) {
        console.warn('Error sending KICK message or closing connection:', e);
      }
    }
    this.hostConnectionMap.delete(playerId);
    this.lastSeenMap.delete(playerId);
    this.players.set(this.players().filter(p => p.id !== playerId));
    this.broadcastPlayerList();
  }

  private timerId: any = null;

  unlockBuzzer() {
    if (!this.isHost()) return;
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
        timerSeconds: null
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
      timerSeconds: current.buzzerTimeout
    };
    this.gameState.set(nextState);

    this.timerId = setInterval(() => {
      const state = this.gameState();
      if (state.timerSeconds !== null && state.timerSeconds > 0) {
        const updatedState = {
          ...state,
          timerSeconds: state.timerSeconds - 1
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
    if (current.timerSeconds !== null) {
      const nextState = {
        ...current,
        timerSeconds: null
      };
      this.gameState.set(nextState);
    }
  }

  private handleHostTimerTimeout() {
    this.stopHostTimer();
    const current = this.gameState();
    const playerId = current.buzzedPlayerId;
    if (!playerId) return;

    // Deduct points?
    // Deduct points if it's NOT the initial turn, OR if deductPointsOnTimeout is true
    let shouldDeduct = !current.isInitialTurn || current.deductPointsOnTimeout;

    const value = current.activeQuestion ? current.activeQuestion.value : 0;
    
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

    // Check if everyone is locked out
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
      // Everyone failed: show answer
      const questionKey = `${current.activeQuestion!.categoryIndex}-${current.activeQuestion!.questionIndex}`;
      nextState = {
        ...current,
        showAnswer: true,
        buzzedPlayerId: null,
        buzzerLocked: true,
        timerSeconds: null,
        isInitialTurn: false,
        lockedOutPlayerIds: lockedOutPlayers,
        lockedOutTeamIds: lockedOutTeams,
        answeredQuestions: [...current.answeredQuestions, questionKey],
        lastAnswerResult: {
          correct: false,
          playerName: '',
          value
        }
      };
    } else {
      nextState = {
        ...current,
        buzzedPlayerId: null,
        buzzerLocked: current.isInitialTurn,
        timerSeconds: null,
        isInitialTurn: false, // Initial turn is over after first failure/timeout
        lockedOutPlayerIds: lockedOutPlayers,
        lockedOutTeamIds: lockedOutTeams,
        audioPlaying: false
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

    // Check if buzzer is locked or if it's still the initial turn (buzzing not allowed yet)
    if (current.isInitialTurn || current.buzzerLocked) return;

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
    if (current.phase === 'QUESTION' && current.buzzedPlayerId === null) {
      const nextState: GameState = {
        ...current,
        buzzedPlayerId: playerId,
        buzzerLocked: true,
        audioPlaying: true
      };
      this.gameState.set(nextState);
      
      // Start the countdown timer for this buzz!
      this.startHostTimer();

      this.broadcast({
        type: 'GAME_STATE',
        senderId: this.myPlayerId()!,
        payload: nextState
      });
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

    // Check if the question is already answered
    const questionKey = `${categoryIndex}-${questionIndex}`;
    if (current.answeredQuestions.includes(questionKey)) return;

    const nextVotes = { ...current.votes };

    if (this.teamMode()) {
      // Remove this player's vote from any other question
      for (const key in nextVotes) {
        if (nextVotes[key] && nextVotes[key].includes(playerId)) {
          nextVotes[key] = nextVotes[key].filter(id => id !== playerId);
        }
      }
      // Add to this question
      if (!nextVotes[questionKey]) {
        nextVotes[questionKey] = [];
      }
      if (!nextVotes[questionKey].includes(playerId)) {
        nextVotes[questionKey].push(playerId);
      }
    } else {
      // Solo mode: clear all votes and set this one
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
    
    // Reset all player scores to 0
    const resetPlayers = this.players().map(p => ({ ...p, score: 0 }));
    this.players.set(resetPlayers);
    this.broadcastPlayerList();

    const current = this.gameState();
    const categories = boards[0] || [];

    const tempStateForSelector: GameState = {
      phase: 'BOARD',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      categories,
      activeSelectorId: null,
      votes: {},
      showAnswer: false,
      lastAnswerResult: null,
      buzzerTimeout: current.buzzerTimeout,
      deductPointsOnTimeout: current.deductPointsOnTimeout,
      timerSeconds: null,
      isInitialTurn: false,
      boards,
      currentBoardIndex: 0
    };
    const firstSelector = this.getNextSelectorId(tempStateForSelector);

    const initialState: GameState = {
      phase: 'BOARD',
      activeQuestion: null,
      buzzedPlayerId: null,
      buzzerLocked: false,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      categories,
      activeSelectorId: firstSelector,
      votes: {},
      showAnswer: false,
      lastAnswerResult: null,
      buzzerTimeout: current.buzzerTimeout,
      deductPointsOnTimeout: current.deductPointsOnTimeout,
      timerSeconds: null,
      isInitialTurn: false,
      boards,
      currentBoardIndex: 0
    };
    this.gameState.set(initialState);
    
    this.broadcast({
      type: 'START_GAME',
      senderId: this.myPlayerId()!,
      payload: initialState
    });

    this.router.navigate(['/game']);
  }

  nextBoard() {
    if (!this.isHost()) return;
    
    const current = this.gameState();
    if (!current.boards || current.currentBoardIndex === undefined) return;
    const nextIdx = current.currentBoardIndex + 1;
    if (nextIdx >= current.boards.length) return;

    const categories = current.boards[nextIdx];

    const tempStateForSelector: GameState = {
      ...current,
      categories,
      answeredQuestions: [],
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      currentBoardIndex: nextIdx,
      votes: {}
    };
    const nextSelector = this.getNextSelectorId(tempStateForSelector);

    const nextState: GameState = {
      ...current,
      phase: 'BOARD',
      activeQuestion: null,
      showAnswer: false,
      buzzedPlayerId: null,
      buzzerLocked: false,
      timerSeconds: null,
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

  selectQuestion(categoryIndex: number, questionIndex: number, value: number, text: string, answer: string) {
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

    const question = current.categories[categoryIndex]?.questions[questionIndex];
    const image = question?.image || undefined;
    const pixelate = question?.pixelate || false;
    const pixelateStrength = question?.pixelateStrength || 80;
    const reducePixelationOnWrong = question?.reducePixelationOnWrong || false;
    const reducePixelationAmount = question?.reducePixelationAmount || 5;
    const audio = question?.audio || undefined;
    const audioStart = question?.audioStart;
    const audioEnd = question?.audioEnd;
    const audioSpeed = question?.audioSpeed;
    const audioPitch = question?.audioPitch;

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
      audioPlaying: true
    };
    this.gameState.set(nextState);

    // Start timer for the initial selector player
    this.startHostTimer();

    this.broadcast({
      type: 'GAME_STATE',
      senderId: this.myPlayerId()!,
      payload: nextState
    });
  }

  awardPoints(playerId: string, correct: boolean) {
    if (!this.isHost()) return;
    this.stopHostTimer(); // STOP TIMEOUT COUNTDOWN
    
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
      // Correct answer: question resolved, show answer first
      const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
      const winnerName = this.players().find(p => p.id === playerId)?.name || 'Ein Spieler';
      nextState = {
        ...current,
        showAnswer: true,
        buzzedPlayerId: null,
        buzzerLocked: true,
        timerSeconds: null,
        isInitialTurn: false,
        answeredQuestions: [...current.answeredQuestions, questionKey],
        lastAnswerResult: {
          correct: true,
          playerName: winnerName,
          value
        }
      };
    } else {
      // Calculate updated activeQuestion with reduced pixelateStrength if enabled
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

      // Check if all active players/teams are now locked out
      const activePlayers = this.players().filter(p => !p.isHost && !p.isOffline);
      const allLockedOut = this.teamMode()
        ? this.teamsArray().every(teamId => {
            const teamPlayers = activePlayers.filter(p => p.teamId === teamId);
            if (teamPlayers.length === 0) return true;
            return lockedOutTeams.includes(teamId);
          })
        : activePlayers.every(p => lockedOutPlayers.includes(p.id));

      if (allLockedOut) {
        // Everyone failed: show answer
        const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
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
          answeredQuestions: [...current.answeredQuestions, questionKey],
          lastAnswerResult: {
            correct: false,
            playerName: '',
            value
          }
        };
      } else {
        nextState = {
          ...current,
          activeQuestion: updatedActiveQuestion,
          buzzedPlayerId: null,
          buzzerLocked: current.isInitialTurn,
          timerSeconds: null,
          isInitialTurn: false, // Initial turn is over after first failure
          lockedOutPlayerIds: lockedOutPlayers,
          lockedOutTeamIds: lockedOutTeams,
          audioPlaying: false
        };
      }
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
    this.stopHostTimer(); // STOP TIMEOUT COUNTDOWN
    
    const current = this.gameState();
    if (!current.activeQuestion) return;

    const questionKey = `${current.activeQuestion.categoryIndex}-${current.activeQuestion.questionIndex}`;
    const nextState: GameState = {
      ...current,
      showAnswer: true,
      buzzedPlayerId: null,
      buzzerLocked: true,
      timerSeconds: null,
      isInitialTurn: false,
      answeredQuestions: [...current.answeredQuestions, questionKey],
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
      isInitialTurn: false
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
    const senderAvatar = me ? (me.avatar || '') : '';

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: this.myPlayerId() || 'unknown',
      senderName,
      senderColor,
      senderAvatar,
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
          senderAvatar,
          text: trimmed
        }
      });
    }
  }

  private handleHostChatMessage(msg: P2pMessage) {
    if (!this.isHost()) return;

    const rawText = msg.payload?.text;
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.trim().length > 200) {
      return; // Ignore invalid/empty/overflow chat messages
    }

    const senderName = msg.payload?.senderName ? String(msg.payload.senderName).substring(0, 14) : 'Spieler';

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: msg.senderId,
      senderName: senderName,
      senderColor: msg.payload.senderColor || '#f1b814',
      senderAvatar: msg.payload.senderAvatar || '',
      text: rawText.trim(),
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
      let changed = false;
      const updatedPlayers = this.players().map(p => {
        if (p.isHost || p.isOffline) return p;

        const lastSeen = this.lastSeenMap.get(p.id);
        if (!lastSeen || now - lastSeen > 9000) {
          console.log(`Player ${p.name} (${p.id}) timed out (no heartbeat for ${now - (lastSeen || 0)}ms). Marking offline.`);
          changed = true;
          this.handlePlayerDisconnect(p.id);
          return { ...p, isOffline: true };
        }
        return p;
      });

      if (changed) {
        this.players.set(updatedPlayers);
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

  private logDebug(message: string, data?: any) {
    const msgStr = `${message} ${data ? JSON.stringify(data) : ''}`;
    console.log('[Client Log]', msgStr);
    this.http.post('/api/debug/log', { message: msgStr }).subscribe({
      error: () => {}
    });
  }
}
