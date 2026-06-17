import { Component, inject, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { P2pService, Player, GameState } from '../../core/services/p2p.service';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';

import { Category, Question } from '../../core/services/quiz.service';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';

interface TeamScoreInfo {
  id: number;
  name: string;
  score: number;
  players: Player[];
}

@Component({
  selector: 'app-game-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, LogoComponent, AvatarComponent],
  templateUrl: './game-page.component.html',
  styleUrl: './game-page.component.css'
})
export class GamePageComponent implements OnInit {
  p2pService = inject(P2pService);
  private router = inject(Router);

  constructor() {
    effect(() => {
      const state = this.p2pService.connectionState();
      if (state === 'disconnected' || state === 'error') {
        this.router.navigate(['/']);
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

    const question = this.categories[categoryIndex].questions[questionIndex];
    this.p2pService.selectQuestion(
      categoryIndex,
      questionIndex,
      question.value,
      question.text,
      question.answer
    );
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

    const question = this.categories[catIdx].questions[rowIdx];
    this.p2pService.selectQuestion(catIdx, rowIdx, question.value, question.text, question.answer);
  }

  onBackToBoard() {
    this.p2pService.backToBoard();
  }

  onUnlockBuzzer() {
    this.p2pService.unlockBuzzer();
  }

  onEndGame() {
    this.p2pService.endGame();
  }

  onLeaveLobby() {
    this.p2pService.disconnect();
    this.router.navigate(['/']);
  }
}
