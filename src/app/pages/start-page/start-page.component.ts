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
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { AudioSettingsComponent } from '../../shared/components/audio-settings/audio-settings.component';

@Component({
  selector: 'app-start-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, ToggleComponent, LogoComponent, AvatarComponent, AudioSettingsComponent],
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

  // Avatar Customization Parts
  avatarBase = signal(0);
  avatarEyes = signal(0);
  avatarMouth = signal(0);
  avatarAccessory = signal(0);
  selectedAvatar = computed(() => `b${this.avatarBase()}e${this.avatarEyes()}m${this.avatarMouth()}a${this.avatarAccessory()}`);

  // Auth form states
  authModalOpen = signal(false);
  authMode = signal<'login' | 'register' | 'forgot'>('login');
  authUsername = signal('');
  authEmail = signal('');
  authPassword = signal('');
  authError = signal('');

  // Predefined security questions list
  securityQuestionsList = [
    'Name deines ersten Haustiers?',
    'Geburtsort deiner Mutter?',
    'Name deiner ersten Schule?',
    'Lieblings-Videospiel als Kind?',
    'Marke deines ersten Autos?'
  ];

  // Added signals for forgot password & registration security questions
  securityQuestion = signal('Name deines ersten Haustiers?');
  securityAnswer = signal('');
  
  forgotStep = signal<1 | 2>(1);
  forgotQuestion = signal('');
  forgotAnswer = signal('');
  forgotNewPassword = signal('');
  forgotConfirmPassword = signal('');
  forgotSuccess = signal(false);

  // Confirmation Modal states (for custom delete warnings)
  confirmModalOpen = signal(false);
  confirmModalType = signal<'quiz' | 'account'>('quiz');
  confirmModalTargetId = signal<string | null>(null);
  confirmModalTitle = signal('');
  confirmModalText = signal('');

  // Settings form states
  settingsModalOpen = signal(false);
  newUsername = signal('');
  settingsError = signal('');
  settingsSuccess = signal('');

  // Legal modal states
  legalModalOpen = signal(false);
  activeLegalTab = signal<'impressum' | 'privacy' | 'terms'>('impressum');

  constructor() {
    // Load from localStorage if present
    const savedName = localStorage.getItem('jeopardy_player_name');
    const savedColor = localStorage.getItem('jeopardy_player_color');
    const savedAvatar = localStorage.getItem('jeopardy_player_avatar');

    if (savedName) {
      this.playerName.set(savedName);
    }
    if (savedColor) {
      this.selectedColor.set(savedColor);
    }
    if (savedAvatar) {
      const match = savedAvatar.match(/^b(\d+)e(\d+)m(\d+)a(\d+)$/);
      if (match) {
        this.avatarBase.set(parseInt(match[1], 10));
        this.avatarEyes.set(parseInt(match[2], 10));
        this.avatarMouth.set(parseInt(match[3], 10));
        this.avatarAccessory.set(parseInt(match[4], 10));
      }
    }

    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.playerName.set(user.username);
      }
    });
  }
  avatarColors = [
    { name: 'Gelb', hex: '#f1b814' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Rot', hex: '#ef4444' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'Violett', hex: '#a855f7' },
    { name: 'Indigo', hex: '#6366f1' },
    { name: 'Blau', hex: '#0052cc' },
    { name: 'Hellblau', hex: '#0ea5e9' },
    { name: 'Cyan', hex: '#06b6d4' },
    { name: 'Teal', hex: '#14b8a6' },
    { name: 'Smaragd', hex: '#10b981' },
    { name: 'Grün', hex: '#22c55e' },
    { name: 'Limette', hex: '#84cc16' },
    { name: 'Waldgrün', hex: '#15803d' },
    { name: 'Crimson', hex: '#be123c' },
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Bronze', hex: '#b45309' },
    { name: 'Silber', hex: '#94a3b8' }
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
  buzzerTimeout = signal('10');
  deductPointsOnTimeout = signal(false);
  incompleteQuizWarning = signal<{ name: string; id: string } | null>(null);

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

  triggerQuizDelete(id: string, name: string, event: Event) {
    event.stopPropagation();
    this.confirmModalType.set('quiz');
    this.confirmModalTargetId.set(id);
    this.confirmModalTitle.set('Quiz-Vorlage löschen');
    this.confirmModalText.set(`Möchtest du die Quiz-Vorlage „${name}“ wirklich unwiderruflich löschen?`);
    this.confirmModalOpen.set(true);
  }

  triggerAccountDelete() {
    this.confirmModalType.set('account');
    this.confirmModalTargetId.set(null);
    this.confirmModalTitle.set('Konto unwiderruflich löschen');
    this.confirmModalText.set('Möchtest du dein Benutzerkonto wirklich löschen? Alle deine erstellten Quiz-Vorlagen werden unwiderruflich mitgelöscht.');
    this.confirmModalOpen.set(true);
  }

  onCancelDelete() {
    this.confirmModalOpen.set(false);
    this.confirmModalTargetId.set(null);
  }

  onConfirmDelete() {
    this.confirmModalOpen.set(false);
    if (this.confirmModalType() === 'quiz') {
      const id = this.confirmModalTargetId();
      if (!id) return;
      this.quizService.deleteQuiz(id).subscribe({
        next: () => {
          if (this.selectedTemplate() === id) {
            this.selectedTemplate.set('general');
          }
          this.refreshTrigger.update(n => n + 1);
        },
        error: (err) => {
          console.error('Failed to delete quiz:', err);
          alert('Fehler beim Löschen des Quizzes.');
        }
      });
    } else if (this.confirmModalType() === 'account') {
      this.settingsModalOpen.set(false);
      this.authService.deleteAccount().then(() => {
        this.playerName.set('');
        this.selectedTemplate.set('general');
      }).catch(err => {
        alert(err.message || 'Fehler beim Löschen des Kontos.');
      });
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
    const template = this.quizService.getTemplateById(
      templateId,
      this.authService.currentUser()?.email
    );
    if (template && !this.quizService.isQuizComplete(template)) {
      this.incompleteQuizWarning.set({ name: template.name, id: template.id });
      return;
    }
    this.incompleteQuizWarning.set(null);
    this.selectedTemplate.set(templateId);
  }

  dismissIncompleteWarning() {
    this.incompleteQuizWarning.set(null);
  }

  onEditIncompleteQuiz() {
    const warning = this.incompleteQuizWarning();
    if (warning) {
      this.router.navigate(['/create-quiz'], { queryParams: { id: warning.id } });
    }
  }

  onMaxPlayersChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.maxPlayers.set(input.value);
  }

  onTeamSizeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.teamSize.set(input.value);
  }

  onBuzzerTimeoutChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.buzzerTimeout.set(input.value);
  }

  formatBuzzerTimeout(valueStr: string): string {
    const value = parseInt(valueStr, 10);
    if (value === 0) {
      return 'Deaktiviert (Kein Countdown)';
    }
    if (value >= 60) {
      const mins = Math.floor(value / 60);
      const secs = value % 60;
      return `${mins}:${secs < 10 ? '0' : ''}${secs}s`;
    }
    return `${value}s`;
  }

  onDeductPointsChange(checked: boolean) {
    this.deductPointsOnTimeout.set(checked);
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

  onAvatarColorClick(hex: string) {
    this.selectedColor.set(hex);
  }

  getPlayersInTeam(teamId: number): Player[] {
    return this.p2pService.players().filter(p => p.teamId === teamId);
  }

  getHostPlayer(): Player | null {
    return this.p2pService.players().find(p => p.isHost) || null;
  }

  async onJoinSubmit() {
    const name = this.playerName().trim();
    const nameRegex = /^[a-zA-Z0-9_\-\säöüÄÖÜß]+$/;
    
    if (!name) {
      this.joinError.set('Bitte gib einen Namen ein.');
      return;
    }
    if (name.length < 2 || name.length > 14) {
      this.joinError.set('Der Name muss zwischen 2 und 14 Zeichen lang sein.');
      return;
    }
    if (!nameRegex.test(name)) {
      this.joinError.set('Der Name darf nur Buchstaben, Zahlen, Leerzeichen, Unterstriche und Bindestriche enthalten.');
      return;
    }

    const code = this.roomCode().trim();
    if (!code) {
      this.joinError.set('Bitte gib einen Raumcode ein.');
      return;
    }
    if (code.length !== 6) {
      this.joinError.set('Der Raumcode muss genau 6 Zeichen lang sein.');
      return;
    }
    
    this.joinError.set('');
    
    try {
      localStorage.setItem('jeopardy_player_name', name);
      localStorage.setItem('jeopardy_player_color', this.selectedColor());
      localStorage.setItem('jeopardy_player_avatar', this.selectedAvatar());

      await this.p2pService.joinRoom(
        code.toUpperCase(),
        name,
        this.selectedColor(),
        this.selectedAvatar()
      );
    } catch (err: any) {
      this.joinError.set(this.p2pService.errorMessage() || 'Verbindung fehlgeschlagen.');
    }
  }

  async onHostSubmit() {
    const name = this.playerName().trim();
    const nameRegex = /^[a-zA-Z0-9_\-\säöüÄÖÜß]+$/;

    if (!name) {
      this.joinError.set('Bitte gib einen Namen ein, um ein Spiel zu hosten.');
      return;
    }
    if (name.length < 2 || name.length > 14) {
      this.joinError.set('Der Name muss zwischen 2 und 14 Zeichen lang sein.');
      return;
    }
    if (!nameRegex.test(name)) {
      this.joinError.set('Der Name darf nur Buchstaben, Zahlen, Leerzeichen, Unterstriche und Bindestriche enthalten.');
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
      localStorage.setItem('jeopardy_player_name', name);
      localStorage.setItem('jeopardy_player_color', this.selectedColor());
      localStorage.setItem('jeopardy_player_avatar', this.selectedAvatar());

      await this.p2pService.hostRoom(
        randomCode,
        name,
        this.selectedColor(),
        this.selectedAvatar(),
        parseInt(this.maxPlayers()),
        this.teamMode(),
        parseInt(this.teamSize()),
        parseInt(this.buzzerTimeout()),
        this.deductPointsOnTimeout()
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

  randomizeAvatar() {
    this.avatarBase.set(Math.floor(Math.random() * 3));
    this.avatarEyes.set(Math.floor(Math.random() * 8));
    this.avatarMouth.set(Math.floor(Math.random() * 6));
    this.avatarAccessory.set(0); // Set to 0 to disable accessories in this layout

    // Also pick a random color from predefined ones
    const randomColorObj = this.avatarColors[Math.floor(Math.random() * this.avatarColors.length)];
    this.selectedColor.set(randomColorObj.hex);
  }

  openAuthModal(mode: 'login' | 'register' | 'forgot') {
    this.authMode.set(mode);
    this.authUsername.set('');
    this.authEmail.set('');
    this.authPassword.set('');
    this.securityQuestion.set(this.securityQuestionsList[0]);
    this.securityAnswer.set('');
    this.forgotStep.set(1);
    this.forgotQuestion.set('');
    this.forgotAnswer.set('');
    this.forgotNewPassword.set('');
    this.forgotConfirmPassword.set('');
    this.forgotSuccess.set(false);
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
          this.authPassword(),
          this.securityQuestion(),
          this.securityAnswer()
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

  async onFetchForgotPasswordQuestion() {
    this.authError.set('');
    try {
      const question = await this.authService.getSecurityQuestion(this.authEmail());
      this.forgotQuestion.set(question);
      this.forgotStep.set(2);
    } catch (err: any) {
      this.authError.set(err.message || 'Die Sicherheitsfrage konnte nicht geladen werden.');
    }
  }

  async onResetPasswordSubmit() {
    this.authError.set('');
    if (this.forgotNewPassword() !== this.forgotConfirmPassword()) {
      this.authError.set('Die Passwörter stimmen nicht überein.');
      return;
    }

    try {
      await this.authService.resetPassword(
        this.authEmail(),
        this.forgotAnswer(),
        this.forgotNewPassword()
      );
      this.forgotSuccess.set(true);
      setTimeout(() => {
        this.authMode.set('login');
        this.forgotStep.set(1);
        this.forgotQuestion.set('');
        this.forgotAnswer.set('');
        this.forgotNewPassword.set('');
        this.forgotConfirmPassword.set('');
        this.forgotSuccess.set(false);
      }, 2000);
    } catch (err: any) {
      this.authError.set(err.message || 'Passwort-Zurücksetzen fehlgeschlagen.');
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

  cycleBase(direction: number) {
    const total = 3; // 0, 1, 2
    let next = this.avatarBase() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarBase.set(next);
  }

  cycleEyes(direction: number) {
    const total = 8; // 0 to 7
    let next = this.avatarEyes() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarEyes.set(next);
  }

  cycleMouth(direction: number) {
    const total = 6; // 0 to 5
    let next = this.avatarMouth() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarMouth.set(next);
  }

  cycleAccessory(direction: number) {
    const total = 8; // 0 to 7
    let next = this.avatarAccessory() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarAccessory.set(next);
  }

  openLegalModal(tab: 'impressum' | 'privacy' | 'terms') {
    this.activeLegalTab.set(tab);
    this.legalModalOpen.set(true);
  }
}
