import { Component, inject, computed, OnInit, effect, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { P2pService, Player, GameState, GameEvent } from '../../core/services/p2p.service';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';

import { Category, Question } from '../../core/services/quiz.service';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { AudioSettingsComponent } from '../../shared/components/audio-settings/audio-settings.component';
import { AudioService } from '../../core/services/audio.service';

interface TeamScoreInfo {
  id: number;
  name: string;
  score: number;
  players: Player[];
}

import { PixelatedImageComponent } from '../../shared/components/pixelated-image/pixelated-image.component';

@Component({
  selector: 'app-game-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, LogoComponent, AvatarComponent, AudioSettingsComponent, PixelatedImageComponent],
  templateUrl: './game-page.component.html',
  styleUrl: './game-page.component.css'
})
export class GamePageComponent implements OnInit {
  p2pService = inject(P2pService);
  audioService = inject(AudioService);
  private router = inject(Router);

  showTurnOverlay = signal(false);
  turnOverlayName = signal('');
  turnOverlayColor = signal('#f1b814');
  turnOverlayAvatar = signal('');

  constructor() {
    effect(() => {
      const state = this.p2pService.connectionState();
      if (state === 'disconnected' || state === 'error') {
        this.router.navigate(['/']);
      }
    });

    effect(() => {
      const phase = this.p2pService.gameState().phase;
      if (phase === 'LOBBY') {
        this.router.navigate(['/']);
      }
    });

    // Track active selector change to show custom fly-through animation
    let lastActiveSelector: string | null = null;
    effect(() => {
      const state = this.p2pService.gameState();
      if (state && state.phase === 'BOARD' && state.activeSelectorId) {
        if (lastActiveSelector !== state.activeSelectorId) {
          this.triggerTurnChangeAnimation(state.activeSelectorId);
        }
        lastActiveSelector = state.activeSelectorId;
      } else {
        lastActiveSelector = null;
      }
    });
  }

  // Jeopardy Categories loaded dynamically from game state
  get categories(): Category[] {
    return this.p2pService.gameState().categories || [];
  }

  // Row indices (for rendering dynamic number of question cards per category column)
  get rows(): number[] {
    const length = this.categories[0]?.questions?.length || 0;
    return Array.from({ length }, (_, i) => i);
  }

  // Leaderboard sorted by score descending
  sortedPlayers = computed(() => {
    return this.p2pService.players().filter(p => !p.isHost).sort((a, b) => b.score - a.score);
  });

  // Team-grouped leaderboard sorted by score descending
  sortedTeams = computed<TeamScoreInfo[]>(() => {
    if (!this.p2pService.teamMode()) return [];

    const teamsMap = new Map<number, Player[]>();
    // Group all actual players (excluding the Host) by team
    const activePlayers = this.p2pService.players().filter(p => !p.isHost && p.teamId !== undefined);
    
    // Initialize active teams
    this.p2pService.teamsArray().forEach(teamId => {
      teamsMap.set(teamId, []);
    });

    activePlayers.forEach(p => {
      const list = teamsMap.get(p.teamId!) || [];
      list.push(p);
      teamsMap.set(p.teamId!, list);
    });

    const list: TeamScoreInfo[] = [];
    teamsMap.forEach((players, teamId) => {
      const score = players.reduce((sum, p) => sum + p.score, 0);
      list.push({
        id: teamId,
        name: `Team ${teamId}`,
        score,
        players
      });
    });

    return list.sort((a, b) => b.score - a.score);
  });

  summaryTab = signal<'leaderboard' | 'stats' | 'chart'>('leaderboard');
  activeTooltip = signal<{ x: number; y: number; text: string } | null>(null);

  buzzerKing = computed(() => {
    const history = this.p2pService.gameState().history || [];
    const players = this.p2pService.players().filter(p => !p.isHost);
    
    // Group buzzer events by player or team (depending on mode)
    const buzzMap = new Map<string, number[]>();
    history.forEach(ev => {
      if (ev.type === 'BUZZ') {
        const key = this.p2pService.teamMode() 
          ? (players.find(p => p.id === ev.playerId)?.teamId?.toString() || '') 
          : ev.playerId;
        if (key) {
          if (!buzzMap.has(key)) buzzMap.set(key, []);
          buzzMap.get(key)!.push(ev.value);
        }
      }
    });

    let bestKey: string | null = null;
    let bestAvg = Infinity;

    buzzMap.forEach((times, key) => {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      if (avg < bestAvg) {
        bestAvg = avg;
        bestKey = key;
      }
    });

    if (!bestKey) return null;

    if (this.p2pService.teamMode()) {
      const teamId = parseInt(bestKey, 10);
      return {
        name: `Team ${teamId}`,
        value: `${Math.round(bestAvg)} ms`,
        avatar: '',
        color: teamId === 1 ? '#3b82f6' : teamId === 2 ? '#ef4444' : teamId === 3 ? '#10b981' : '#8b5cf6'
      };
    } else {
      const p = players.find(player => player.id === bestKey);
      return p ? {
        name: p.name,
        value: `${Math.round(bestAvg)} ms`,
        avatar: p.avatar || '',
        color: p.color
      } : null;
    }
  });

  riskMaster = computed(() => {
    const history = this.p2pService.gameState().history || [];
    const players = this.p2pService.players().filter(p => !p.isHost);
    const lossMap = new Map<string, number>();

    history.forEach(ev => {
      if (ev.type === 'AWARD' && ev.value < 0) {
        const key = this.p2pService.teamMode()
          ? (players.find(p => p.id === ev.playerId)?.teamId?.toString() || '')
          : ev.playerId;
        if (key) {
          lossMap.set(key, (lossMap.get(key) || 0) + Math.abs(ev.value));
        }
      }
    });

    let worstKey: string | null = null;
    let maxLoss = 0;

    lossMap.forEach((loss, key) => {
      if (loss > maxLoss) {
        maxLoss = loss;
        worstKey = key;
      }
    });

    if (!worstKey) return null;

    if (this.p2pService.teamMode()) {
      const teamId = parseInt(worstKey, 10);
      return {
        name: `Team ${teamId}`,
        value: `-${maxLoss} $`,
        avatar: '',
        color: teamId === 1 ? '#3b82f6' : teamId === 2 ? '#ef4444' : teamId === 3 ? '#10b981' : '#8b5cf6'
      };
    } else {
      const p = players.find(player => player.id === worstKey);
      return p ? {
        name: p.name,
        value: `-${maxLoss} $`,
        avatar: p.avatar || '',
        color: p.color
      } : null;
    }
  });

  categoryChampions = computed(() => {
    const history = this.p2pService.gameState().history || [];
    const players = this.p2pService.players().filter(p => !p.isHost);
    
    // Group: categoryName -> playerKey/teamKey -> netPoints
    const catMap = new Map<string, Map<string, number>>();

    history.forEach(ev => {
      if (ev.type === 'AWARD' && ev.categoryName) {
        const key = this.p2pService.teamMode()
          ? (players.find(p => p.id === ev.playerId)?.teamId?.toString() || '')
          : ev.playerId;
        if (key) {
          if (!catMap.has(ev.categoryName)) {
            catMap.set(ev.categoryName, new Map<string, number>());
          }
          const pMap = catMap.get(ev.categoryName)!;
          pMap.set(key, (pMap.get(key) || 0) + ev.value);
        }
      }
    });

    const champs: { category: string; name: string; score: number; color: string }[] = [];

    catMap.forEach((pMap, category) => {
      let bestKey: string | null = null;
      let maxScore = -Infinity;

      pMap.forEach((score, key) => {
        if (score > maxScore && score > 0) { // Only count positive contributions
          maxScore = score;
          bestKey = key;
        }
      });

      if (bestKey) {
        if (this.p2pService.teamMode()) {
          const teamId = parseInt(bestKey, 10);
          champs.push({
            category,
            name: `Team ${teamId}`,
            score: maxScore,
            color: teamId === 1 ? '#3b82f6' : teamId === 2 ? '#ef4444' : teamId === 3 ? '#10b981' : '#8b5cf6'
          });
        } else {
          const p = players.find(player => player.id === bestKey);
          if (p) {
            champs.push({
              category,
              name: p.name,
              score: maxScore,
              color: p.color
            });
          }
        }
      }
    });

    return champs;
  });

  chartData = computed(() => {
    const history = this.p2pService.gameState().history || [];
    const players = this.p2pService.players().filter(p => !p.isHost);
    
    // 1. Filter out only AWARD events which affect scores
    const awardEvents = history.filter(ev => ev.type === 'AWARD');
    
    // 2. Identify the series (players or teams)
    interface Series {
      id: string;
      name: string;
      color: string;
      scores: number[]; // cumulative scores at each step
    }

    const seriesList: Series[] = [];

    if (this.p2pService.teamMode()) {
      const limit = this.p2pService.maxTeamsLimit();
      for (let t = 1; t <= limit; t++) {
        // Only include teams that have at least one player
        const hasPlayers = players.some(p => p.teamId === t);
        if (hasPlayers) {
          seriesList.push({
            id: t.toString(),
            name: `Team ${t}`,
            color: t === 1 ? '#3b82f6' : t === 2 ? '#ef4444' : t === 3 ? '#10b981' : '#8b5cf6',
            scores: [0] // start at 0
          });
        }
      }
    } else {
      players.forEach(p => {
        seriesList.push({
          id: p.id,
          name: p.name,
          color: p.color,
          scores: [0] // start at 0
        });
      });
    }

    // 3. Populate cumulative scores step-by-step
    awardEvents.forEach(ev => {
      const activePlayer = players.find(p => p.id === ev.playerId);
      const targetId = this.p2pService.teamMode() 
        ? (activePlayer?.teamId?.toString() || '')
        : ev.playerId;

      seriesList.forEach(s => {
        const lastScore = s.scores[s.scores.length - 1];
        if (s.id === targetId) {
          s.scores.push(lastScore + ev.value);
        } else {
          s.scores.push(lastScore); // remains unchanged
        }
      });
    });

    // 4. Calculate bounds for scaling the SVG
    let minVal = 0;
    let maxVal = 1000;
    seriesList.forEach(s => {
      s.scores.forEach(val => {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      });
    });

    // Pad maxVal and minVal for spacing
    const yRange = maxVal - minVal;
    const yBuffer = yRange > 0 ? yRange * 0.15 : 200;
    maxVal += yBuffer;
    minVal -= yBuffer;

    const totalSteps = awardEvents.length; // number of steps = events + 1 (start)

    // Generate paths for each series
    // SVG width: 800, height: 350
    const width = 800;
    const height = 350;
    const paddingLeft = 60;
    const paddingRight = 30;
    const paddingTop = 30;
    const paddingBottom = 40;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    interface Point {
      x: number;
      y: number;
      score: number;
      stepName: string;
    }

    const svgLines = seriesList.map(s => {
      const points: Point[] = s.scores.map((score, stepIdx) => {
        const x = paddingLeft + (totalSteps > 0 ? (stepIdx / totalSteps) * chartWidth : 0);
        
        // Y scale: inverse because SVG (0,0) is top-left
        const scoreRange = maxVal - minVal;
        const percent = scoreRange > 0 ? (score - minVal) / scoreRange : 0.5;
        const y = paddingTop + chartHeight - (percent * chartHeight);

        let stepName = stepIdx === 0 ? 'Start' : `Frage ${stepIdx}`;
        if (stepIdx > 0 && awardEvents[stepIdx - 1]) {
          const ev = awardEvents[stepIdx - 1];
          stepName = `${ev.playerName}: ${ev.value > 0 ? '+' : ''}${ev.value}$ (${ev.categoryName || 'Quiz'})`;
        }

        return { x, y, score, stepName };
      });

      // Construct path command 'M x0 y0 L x1 y1 ...'
      let d = '';
      if (points.length > 0) {
        d = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
      }

      return {
        name: s.name,
        color: s.color,
        path: d,
        points: points
      };
    });

    // Generate Y-axis grid labels
    const gridLines: { y: number; label: string }[] = [];
    const stepsCount = 4;
    for (let i = 0; i <= stepsCount; i++) {
      const percent = i / stepsCount;
      const score = Math.round(minVal + percent * (maxVal - minVal));
      const y = paddingTop + chartHeight - (percent * chartHeight);
      gridLines.push({ y, label: `${score} $` });
    }

    // Generate X-axis step labels
    const xAxisLabels: { x: number; label: string }[] = [];
    if (totalSteps > 0) {
      const labelInterval = Math.max(1, Math.ceil(totalSteps / 5));
      for (let i = 0; i <= totalSteps; i += labelInterval) {
        const x = paddingLeft + (i / totalSteps) * chartWidth;
        xAxisLabels.push({ x, label: i === 0 ? 'Start' : `F${i}` });
      }
    } else {
      xAxisLabels.push({ x: paddingLeft + chartWidth / 2, label: 'Keine Ereignisse' });
    }

    return {
      svgLines,
      gridLines,
      xAxisLabels,
      totalSteps,
      width,
      height,
      paddingLeft,
      paddingTop,
      chartWidth,
      chartHeight
    };
  });

  // Check if a question is already played
  isQuestionAnswered(categoryIndex: number, questionIndex: number): boolean {
    const key = `${categoryIndex}-${questionIndex}`;
    const state = this.p2pService.gameState();
    return state ? state.answeredQuestions.includes(key) : false;
  }

  // Get player name by ID (used to show who buzzed)
  getBuzzedPlayerName(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.buzzedPlayerId) return '';
    const player = this.p2pService.players().find(p => p.id === state.buzzedPlayerId);
    if (!player) return 'Ein Spieler';
    if (this.p2pService.teamMode() && player.teamId) {
      return `${player.name} (Team ${player.teamId})`;
    }
    return player.name;
  }

  // Get player color by ID (used for custom glow colors)
  getBuzzedPlayerColor(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.buzzedPlayerId) return '#f1b814';
    const player = this.p2pService.players().find(p => p.id === state.buzzedPlayerId);
    return player ? player.color : '#f1b814';
  }

  getBuzzedPlayerAvatar(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.buzzedPlayerId) return '';
    const player = this.p2pService.players().find(p => p.id === state.buzzedPlayerId);
    return player ? (player.avatar || '') : '';
  }

  isBuzzerDisabled(): boolean {
    const state = this.p2pService.gameState();
    const me = this.p2pService.me();
    if (!state || !me) return true;

    // If buzzer is locked (e.g. someone already buzzed)
    if (state.buzzerLocked) return true;

    // Check if I am locked out
    if (state.lockedOutPlayerIds && state.lockedOutPlayerIds.includes(me.id)) {
      return true;
    }

    // Check if my team is locked out
    if (this.p2pService.teamMode() && me.teamId && state.lockedOutTeamIds && state.lockedOutTeamIds.includes(me.teamId)) {
      return true;
    }

    return false;
  }

  getBuzzerSubtext(): string {
    const state = this.p2pService.gameState();
    const me = this.p2pService.me();
    if (!state || !me) return '';

    if (this.p2pService.teamMode() && me.teamId && state.lockedOutTeamIds?.includes(me.teamId)) {
      return 'Dein Team hat bereits falsch geantwortet!';
    }

    if (state.lockedOutPlayerIds?.includes(me.id)) {
      return 'Du hast bereits falsch geantwortet!';
    }

    if (state.buzzerLocked) {
      if (state.buzzedPlayerId === null) {
        return 'Buzzer für diese Frage noch gesperrt...';
      }
      return 'Jemand anderes war schneller!';
    }

    return 'Jetzt buzzern!';
  }

  ngOnInit() {
    // Redirect guard: if not connected and not trying to connect, force send back to lobby
    const state = this.p2pService.connectionState();
    if (state === 'disconnected' || state === 'error') {
      this.p2pService.disconnect();
      this.router.navigate(['/']);
    }
  }

  getTeamColor(teamId: number): string {
    switch (teamId) {
      case 1: return '#3b82f6'; // blue-500
      case 2: return '#ef4444'; // red-500
      case 3: return '#22c55e'; // green-500
      case 4: return '#a855f7'; // purple-500
      case 5: return '#ec4899'; // pink-500
      default: return '#eab308'; // yellow-500
    }
  }

  canISelectOrVote(): boolean {
    const state = this.p2pService.gameState();
    const me = this.p2pService.me();
    if (!state || !state.activeSelectorId || !me) return false;
    if (me.isHost) return false; // Host moderates, doesn't vote

    if (this.p2pService.teamMode()) {
      return me.teamId !== undefined && state.activeSelectorId === `team-${me.teamId}`;
    } else {
      return state.activeSelectorId === me.id;
    }
  }

  canIConfirmSelection(): boolean {
    const state = this.p2pService.gameState();
    if (!state || !state.votes) return false;

    // Check if there are any votes cast
    const votedKeys = Object.keys(state.votes).filter(k => state.votes[k] && state.votes[k].length > 0);
    if (votedKeys.length === 0) return false;

    // Only Host is allowed to confirm/open the question
    return this.p2pService.isHost();
  }

  getQuestionVoters(categoryIndex: number, questionIndex: number): Player[] {
    const state = this.p2pService.gameState();
    if (!state || !state.votes) return [];
    const key = `${categoryIndex}-${questionIndex}`;
    const voterIds = state.votes[key];
    if (!voterIds || voterIds.length === 0) return [];
    return this.p2pService.players().filter(p => voterIds.includes(p.id));
  }

  doesQuestionHaveMyVote(categoryIndex: number, questionIndex: number): boolean {
    const state = this.p2pService.gameState();
    const me = this.p2pService.me();
    if (!state || !state.votes || !me) return false;
    const key = `${categoryIndex}-${questionIndex}`;
    const voterIds = state.votes[key];
    return voterIds ? voterIds.includes(me.id) : false;
  }

  getCardBorderColor(categoryIndex: number, questionIndex: number): string {
    const state = this.p2pService.gameState();
    if (!state || !state.votes) return '';
    const key = `${categoryIndex}-${questionIndex}`;
    const voterIds = state.votes[key];
    if (!voterIds || voterIds.length === 0) return '';

    if (!this.p2pService.teamMode()) {
      const player = this.p2pService.players().find(p => p.id === voterIds[0]);
      return player ? player.color : '';
    } else {
      const activeTeamStr = state.activeSelectorId;
      if (activeTeamStr) {
        const teamId = parseInt(activeTeamStr.replace('team-', ''), 10);
        return this.getTeamColor(teamId);
      }
      return '';
    }
  }

  getActiveSelectorColor(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.activeSelectorId) return '#f1b814';
    if (this.p2pService.teamMode()) {
      const teamId = parseInt(state.activeSelectorId.replace('team-', ''), 10);
      return this.getTeamColor(teamId);
    } else {
      const player = this.p2pService.players().find(p => p.id === state.activeSelectorId);
      return player ? player.color : '#f1b814';
    }
  }

  getActiveSelectorAvatar(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.activeSelectorId || this.p2pService.teamMode()) return '';
    const player = this.p2pService.players().find(p => p.id === state.activeSelectorId);
    return player ? (player.avatar || '') : '';
  }

  getActiveSelectorInitials(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.activeSelectorId) return '?';
    if (this.p2pService.teamMode()) {
      return 'T' + state.activeSelectorId.replace('team-', '');
    } else {
      const player = this.p2pService.players().find(p => p.id === state.activeSelectorId);
      return player ? player.name.slice(0, 2).toUpperCase() : 'H';
    }
  }

  getActiveSelectorName(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.activeSelectorId) return 'Niemand';
    if (this.p2pService.teamMode()) {
      const teamIdStr = state.activeSelectorId.replace('team-', '');
      return `Team ${teamIdStr}`;
    } else {
      const player = this.p2pService.players().find(p => p.id === state.activeSelectorId);
      return player ? player.name : 'Host';
    }
  }

  getSelectionStatusText(): string {
    const state = this.p2pService.gameState();
    if (!state || !state.votes) return 'Warte auf Auswahl...';

    const votedKeys = Object.keys(state.votes).filter(k => state.votes[k] && state.votes[k].length > 0);
    if (votedKeys.length === 0) {
      if (this.canISelectOrVote()) {
        return 'Wähle eine Frage auf dem Feld aus, um abzustimmen.';
      }
      return `${this.getActiveSelectorName()} wählt eine Frage...`;
    }

    if (!this.p2pService.teamMode()) {
      const key = votedKeys[0];
      const parts = key.split('-');
      const catIdx = parseInt(parts[0], 10);
      const rowIdx = parseInt(parts[1], 10);
      const cat = this.categories[catIdx];
      const q = cat?.questions[rowIdx];
      if (!cat || !q) return 'Frage wird ausgewählt...';
      return `Ausgewählt: ${cat.name} für ${q.value} $`;
    }

    let bestKey = '';
    let maxVotes = 0;
    votedKeys.forEach(k => {
      const count = state.votes[k].length;
      if (count > maxVotes) {
        maxVotes = count;
        bestKey = k;
      }
    });

    if (!bestKey) return 'Warte auf Stimmen...';

    const parts = bestKey.split('-');
    const catIdx = parseInt(parts[0], 10);
    const rowIdx = parseInt(parts[1], 10);
    const cat = this.categories[catIdx];
    const q = cat?.questions[rowIdx];
    if (!cat || !q) return 'Stimmen werden gezählt...';

    const activeTeamStr = state.activeSelectorId;
    if (!activeTeamStr) return 'Stimmen werden gezählt...';
    const activeTeamId = parseInt(activeTeamStr.replace('team-', ''), 10);

    const totalTeamPlayers = this.p2pService.players().filter(p => {
      return !p.isHost && !p.isOffline && p.teamId === activeTeamId;
    }).length;

    return `Favorit: ${cat.name} (${q.value} $) mit ${maxVotes} von ${totalTeamPlayers} Stimmen.`;
  }

  getBoardInstructionText(): string {
    if (this.canISelectOrVote()) {
      return 'Du bist an der Reihe! Wähle eine Frage auf dem Spielfeld aus.';
    }
    if (this.p2pService.isHost()) {
      return `Warte auf Auswahl durch ${this.getActiveSelectorName()} oder wähle eine Frage direkt aus.`;
    }
    return `${this.getActiveSelectorName()} wählt als Nächstes eine Frage aus.`;
  }

  onCardClick(categoryIndex: number, questionIndex: number) {
    if (this.p2pService.isHost()) {
      this.onSelectQuestion(categoryIndex, questionIndex);
    } else if (this.canISelectOrVote()) {
      this.p2pService.voteQuestion(categoryIndex, questionIndex);
    }
  }

  onSelectQuestion(categoryIndex: number, questionIndex: number) {
    if (!this.p2pService.isHost()) return;
    
    // Check if already answered
    if (this.isQuestionAnswered(categoryIndex, questionIndex)) return;

    this.p2pService.selectQuestion(categoryIndex, questionIndex);
  }

  onAwardPoints(correct: boolean) {
    const state = this.p2pService.gameState();
    if (!state || !state.buzzedPlayerId) return;
    this.p2pService.awardPoints(state.buzzedPlayerId, correct);
  }

  onSkipQuestion() {
    this.p2pService.skipQuestion();
  }

  onConfirmSelectedQuestion() {
    if (!this.p2pService.isHost()) return;
    const state = this.p2pService.gameState();
    if (!state || !state.votes) return;

    const votedKeys = Object.keys(state.votes).filter(k => state.votes[k] && state.votes[k].length > 0);
    if (votedKeys.length === 0) return;

    // Find the question key with the most votes
    let bestKey = votedKeys[0];
    let maxVotes = 0;
    votedKeys.forEach(k => {
      const count = state.votes[k].length;
      if (count > maxVotes) {
        maxVotes = count;
        bestKey = k;
      }
    });

    const parts = bestKey.split('-');
    const catIdx = parseInt(parts[0], 10);
    const rowIdx = parseInt(parts[1], 10);

    this.p2pService.selectQuestion(catIdx, rowIdx);
  }

  onBackToBoard() {
    this.p2pService.backToBoard();
  }

  onUnlockBuzzer() {
    this.p2pService.unlockBuzzer();
  }

  onStartTimer() {
    this.p2pService.startTimerManually();
  }

  onToggleAudio() {
    this.p2pService.toggleQuestionAudio();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // 1. Ignore if typing in input fields
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const state = this.p2pService.gameState();
    if (!state) return;

    const isHost = this.p2pService.isHost();
    const isBuzzed = state.buzzedPlayerId !== null;

    if (isHost) {
      // Host Moderation Hotkeys
      if (state.phase === 'QUESTION') {
        if (state.showAnswer) {
          // If answer is shown, Enter/Escape/Space goes back to board
          if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') {
            event.preventDefault();
            this.onBackToBoard();
          }
          return;
        }

        if (isBuzzed) {
          // A player has buzzed, award points Richtig (Enter) or Falsch (Backspace)
          if (event.key === 'Enter') {
            event.preventDefault();
            this.onAwardPoints(true);
          } else if (event.key === 'Backspace') {
            event.preventDefault();
            this.onAwardPoints(false);
          }
        } else {
          // Waiting for buzz
          if (state.buzzerLocked) {
            // Buzzer is locked after failure, Space unlocks
            if (event.key === ' ') {
              event.preventDefault();
              this.onUnlockBuzzer();
            }
          }
          
          if (event.key === 'Backspace' || event.key === 'Escape') {
            event.preventDefault();
            this.onSkipQuestion();
          }
        }
      }
    } else {
      // Player Buzzing Hotkey
      if (state.phase === 'QUESTION' && !isBuzzed && !this.isBuzzerDisabled()) {
        const configuredKey = this.audioService.buzzerKey();
        if (event.code === configuredKey) {
          event.preventDefault();
          this.p2pService.buzz();
        }
      }
    }
  }

  onEndGame() {
    this.p2pService.endGame();
  }

  onLogoClick() {
    if (this.p2pService.isHost()) {
      if (confirm('Möchtest du das aktuelle Spiel wirklich abbrechen und alle Spieler zurück in die Lobby bringen?')) {
        this.p2pService.cancelGame();
      }
    }
  }

  onLeaveLobby() {
    this.p2pService.disconnect();
    this.router.navigate(['/']);
  }

  isBoardComplete(): boolean {
    const state = this.p2pService.gameState();
    if (!state || !state.categories) return false;
    const totalQuestions = state.categories.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0);
    return state.answeredQuestions.length === totalQuestions;
  }

  hasNextBoard(): boolean {
    const state = this.p2pService.gameState();
    if (!state || !state.boards || state.currentBoardIndex === undefined) return false;
    return this.isBoardComplete() && (state.currentBoardIndex + 1 < state.boards.length);
  }

  onNextBoard() {
    this.p2pService.nextBoard();
  }

  isTeamActive(teamId: number): boolean {
    const state = this.p2pService.gameState();
    return state ? state.activeSelectorId === `team-${teamId}` : false;
  }

  isPlayerActive(playerId: string): boolean {
    const state = this.p2pService.gameState();
    return state ? state.activeSelectorId === playerId : false;
  }

  getTeamSidebarStyle(teamId: number): { [key: string]: string } {
    const active = this.isTeamActive(teamId);
    if (!active) return {};
    const color = this.getTeamColor(teamId);
    return {
      'border-color': color,
      'box-shadow': `0 0 12px ${color}40`
    };
  }

  getPlayerSidebarStyle(player: any): { [key: string]: string } {
    const active = this.isPlayerActive(player.id);
    if (!active) return {};
    const color = player.color;
    return {
      'border-color': color,
      'box-shadow': `0 0 12px ${color}40`
    };
  }

  triggerTurnChangeAnimation(activeSelectorId: string) {
    let name = '';
    let color = '#f1b814';
    let avatar = '';

    if (activeSelectorId.startsWith('team-')) {
      const teamId = parseInt(activeSelectorId.replace('team-', ''), 10);
      name = `Team ${teamId}`;
      color = teamId === 1 ? '#3b82f6' : 
              teamId === 2 ? '#ef4444' : 
              teamId === 3 ? '#22c55e' : 
              teamId === 4 ? '#a855f7' : 
              teamId === 5 ? '#ec4899' : '#eab308';
    } else {
      const player = this.p2pService.players().find(p => p.id === activeSelectorId);
      if (player) {
        name = player.name;
        color = player.color;
        avatar = player.avatar || '';
      } else {
        name = 'Host';
      }
    }

    this.turnOverlayName.set(name);
    this.turnOverlayColor.set(color);
    this.turnOverlayAvatar.set(avatar);

    this.showTurnOverlay.set(true);
    this.audioService.playTransition();

    setTimeout(() => {
      this.showTurnOverlay.set(false);
    }, 2800);
  }
}
