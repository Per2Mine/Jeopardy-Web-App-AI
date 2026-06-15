import { Component, inject, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { P2pService, Player, GameState } from '../../core/services/p2p.service';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';

import { Category, Question } from '../../core/services/quiz.service';

interface TeamScoreInfo {
  id: number;
  name: string;
  score: number;
  players: Player[];
}

@Component({
  selector: 'app-game-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, LogoComponent],
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
    return [...this.p2pService.players()].sort((a, b) => b.score - a.score);
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

  onEndGame() {
    this.p2pService.endGame();
  }

  onLeaveLobby() {
    this.p2pService.disconnect();
    this.router.navigate(['/']);
  }
}
