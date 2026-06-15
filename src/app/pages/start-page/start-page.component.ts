import { Component, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { ToggleComponent } from '../../shared/components/toggle/toggle.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';
import { P2pService, Player } from '../../core/services/p2p.service';
import { AuthService } from '../../core/services/auth.service';
import { QuizService } from '../../core/services/quiz.service';

@Component({
  selector: 'app-start-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, ToggleComponent, LogoComponent],
  templateUrl: './start-page.component.html',
  styleUrl: './start-page.component.css'
})
export class StartPageComponent {
  p2pService = inject(P2pService);
  authService = inject(AuthService);
  quizService = inject(QuizService);
  private router = inject(Router);

  // Tab control: 'join' or 'host'
  activeTab = signal<'join' | 'host'>('join');

  // Player Profile
  playerName = signal(this.authService.currentUser()?.username || '');
  selectedColor = signal('#f1b814'); // Default gold

  // Auth form states
  authModalOpen = signal(false);
  authMode = signal<'login' | 'register'>('login');
  authUsername = signal('');
  authEmail = signal('');
  authPassword = signal('');
  authError = signal('');

  // Settings form states
  settingsModalOpen = signal(false);
  newUsername = signal('');
  settingsError = signal('');
  settingsSuccess = signal('');

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.playerName.set(user.username);
      }
    });
  }
  avatarColors = [
    { name: 'Gold', hex: '#f1b814', bgClass: 'bg-[#f1b814]', borderClass: 'border-[#f1b814]' },
    { name: 'Blue', hex: '#0052cc', bgClass: 'bg-[#0052cc]', borderClass: 'border-[#0052cc]' },
    { name: 'Red', hex: '#ef4444', bgClass: 'bg-[#ef4444]', borderClass: 'border-[#ef4444]' },
    { name: 'Green', hex: '#22c55e', bgClass: 'bg-[#22c55e]', borderClass: 'border-[#22c55e]' },
    { name: 'Purple', hex: '#a855f7', bgClass: 'bg-[#a855f7]', borderClass: 'border-[#a855f7]' },
    { name: 'Pink', hex: '#ec4899', bgClass: 'bg-[#ec4899]', borderClass: 'border-[#ec4899]' }
  ];

  // Join Game state
  roomCode = signal('');
  joinError = signal('');
  codeCopied = signal(false);

  // Host Game state
  maxPlayers = signal('8');
  teamSize = signal('2');
  teamMode = signal(false);
  selectedTemplate = signal('general');

  canStartGame = computed(() => {
    const guests = this.p2pService.players().filter(p => !p.isHost);
    if (this.p2pService.teamMode()) {
      const maxTeams = this.p2pService.maxTeamsLimit();
      for (let t = 1; t <= maxTeams; t++) {
        const hasMember = guests.some(p => p.teamId === t);
        if (!hasMember) {
          return false;
        }
      }
      return true;
    } else {
      return guests.length >= 2;
    }
  });

  getStartGameDisabledReason = computed(() => {
    const guests = this.p2pService.players().filter(p => !p.isHost);
    if (this.p2pService.teamMode()) {
      const maxTeams = this.p2pService.maxTeamsLimit();
      const emptyTeams: number[] = [];
      for (let t = 1; t <= maxTeams; t++) {
        const hasMember = guests.some(p => p.teamId === t);
        if (!hasMember) {
          emptyTeams.push(t);
        }
      }
      if (emptyTeams.length > 0) {
        return `Warte auf Spieler für leere Teams: Team ${emptyTeams.join(', Team ')}`;
      }
      return '';
    } else {
      if (guests.length < 2) {
        return `Warte auf mindestens 2 Spieler (derzeit: ${guests.length}).`;
      }
      return '';
    }
  });
  private refreshTrigger = signal(0);

  quizTemplates = computed(() => {
    this.refreshTrigger();
    const email = this.authService.currentUser()?.email;
    return this.quizService.getTemplates(email);
  });

  onDeleteQuiz(id: string, event: Event) {
    event.stopPropagation();
    if (confirm('Möchtest du diese Quiz-Vorlage wirklich löschen?')) {
      this.quizService.deleteQuiz(id);
      if (this.selectedTemplate() === id) {
        this.selectedTemplate.set('general');
      }
      this.refreshTrigger.update(n => n + 1);
    }
  }

  onEditQuiz(id: string, event: Event) {
    event.stopPropagation();
    this.router.navigate(['/create-quiz'], { queryParams: { id } });
  }

  selectTab(tab: 'join' | 'host') {
    this.activeTab.set(tab);
    this.joinError.set('');
  }

  selectColor(color: string) {
    this.selectedColor.set(color);
  }

  selectTemplate(templateId: string) {
    this.selectedTemplate.set(templateId);
  }

  onMaxPlayersChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.maxPlayers.set(input.value);
  }

  onTeamSizeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.teamSize.set(input.value);
  }

  onTeamModeChange(checked: boolean) {
    this.teamMode.set(checked);
    if (checked) {
      this.maxPlayers.set('4'); // Default 4 Teams (limit is 2-6)
      this.teamSize.set('2'); // Default 2 players per team (limit is 2-8)
    } else {
      this.maxPlayers.set('8'); // Default 8 Spieler (limit is 2-24)
    }
  }

  getInitials(): string {
    const name = this.playerName().trim();
    if (!name) return '?';
    return name.slice(0, 2).toUpperCase();
  }

  getPlayersInTeam(teamId: number): Player[] {
    return this.p2pService.players().filter(p => p.teamId === teamId);
  }

  getHostPlayer(): Player | null {
    return this.p2pService.players().find(p => p.isHost) || null;
  }

  async onJoinSubmit() {
    if (!this.playerName().trim()) {
      this.joinError.set('Bitte gib einen Namen ein.');
      return;
    }
    if (this.roomCode().trim().length !== 6) {
      this.joinError.set('Der Raumcode muss genau 6 Zeichen lang sein.');
      return;
    }
    this.joinError.set('');
    
    try {
      await this.p2pService.joinRoom(
        this.roomCode().trim().toUpperCase(),
        this.playerName().trim(),
        this.selectedColor()
      );
    } catch (err: any) {
      this.joinError.set(this.p2pService.errorMessage() || 'Verbindung fehlgeschlagen.');
    }
  }

  async onHostSubmit() {
    if (!this.playerName().trim()) {
      this.joinError.set('Bitte gib einen Namen ein, um ein Spiel zu hosten.');
      return;
    }
    this.joinError.set('');

    // Generate a unique 6-character room code (e.g. JEOP55 or random uppercase alphanumeric)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomCode = '';
    for (let i = 0; i < 6; i++) {
      randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
      await this.p2pService.hostRoom(
        randomCode,
        this.playerName().trim(),
        this.selectedColor(),
        parseInt(this.maxPlayers()),
        this.teamMode(),
        parseInt(this.teamSize())
      );
    } catch (err: any) {
      this.joinError.set(this.p2pService.errorMessage() || 'Raumerstellung fehlgeschlagen.');
    }
  }

  onLeaveLobby() {
    this.p2pService.disconnect();
  }

  copyRoomCode() {
    const code = this.p2pService.roomCode();
    if (code) {
      navigator.clipboard.writeText(code);
      this.codeCopied.set(true);
      setTimeout(() => this.codeCopied.set(false), 2000);
    }
  }

  onStartGame() {
    const template = this.quizService.getTemplateById(
      this.selectedTemplate(),
      this.authService.currentUser()?.email
    );
    if (template) {
      this.p2pService.startGame(template.categories);
    }
  }

  openAuthModal(mode: 'login' | 'register') {
    this.authMode.set(mode);
    this.authUsername.set('');
    this.authEmail.set('');
    this.authPassword.set('');
    this.authError.set('');
    this.authModalOpen.set(true);
  }

  async onAuthSubmit() {
    this.authError.set('');
    try {
      if (this.authMode() === 'register') {
        await this.authService.register(
          this.authUsername(),
          this.authEmail(),
          this.authPassword()
        );
      } else {
        await this.authService.login(
          this.authEmail(),
          this.authPassword()
        );
      }
      this.authModalOpen.set(false);
    } catch (err: any) {
      this.authError.set(err.message || 'Ein Fehler ist aufgetreten.');
    }
  }

  onLogout() {
    this.authService.logout();
    this.playerName.set('');
    this.selectedTemplate.set('general');
  }

  openSettingsModal() {
    this.newUsername.set(this.authService.currentUser()?.username || '');
    this.settingsError.set('');
    this.settingsSuccess.set('');
    this.settingsModalOpen.set(true);
  }

  async onUpdateSettings() {
    this.settingsError.set('');
    this.settingsSuccess.set('');
    try {
      await this.authService.updateUsername(this.newUsername());
      this.settingsSuccess.set('Benutzername erfolgreich aktualisiert!');
      setTimeout(() => {
        this.settingsModalOpen.set(false);
      }, 1200);
    } catch (err: any) {
      this.settingsError.set(err.message || 'Aktualisierung fehlgeschlagen.');
    }
  }

  onCreateQuizClick() {
    this.router.navigate(['/create-quiz']);
  }
}
