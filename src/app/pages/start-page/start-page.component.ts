import { Component, signal, computed, effect, inject, OnDestroy, HostListener } from '@angular/core';
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
import { safeLocalStorageGet, safeLocalStorageSet } from '../../core/utils/storage.util';

@Component({
  selector: 'app-start-page',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, ToggleComponent, LogoComponent, AvatarComponent, AudioSettingsComponent],
  templateUrl: './start-page.component.html',
  styleUrl: './start-page.component.css'
})
export class StartPageComponent implements OnDestroy {
  p2pService = inject(P2pService);
  authService = inject(AuthService);
  quizService = inject(QuizService);
  private router = inject(Router);

  private pendingTimers: any[] = [];
  private communityReqSeq = 0;

  // In-app toast notifications (replaces native alert())
  toastMessage = signal<string>('');
  toastType = signal<'error' | 'info'>('error');
  avatarPop = signal(false);

  // Tab control: 'join' or 'host'
  activeTab = signal<'join' | 'host'>('join');

  // Lobby Quiz Change Control
  showChangeQuizSection = signal(false);

  // Player Profile
  playerName = signal(this.authService.currentUser()?.username || '');
  selectedColor = signal('#0ea5e9'); // Default bright blue
 
  // Avatar Customization Parts
  avatarBase = signal(2); // Cat / Kitty
  avatarEyes = signal(1); // Happy Curved (^^) Eyes
  avatarMouth = signal(1); // Open Smile Mouth
  avatarAccessory = signal(0);
  selectedAvatar = computed(() => `b${this.avatarBase()}e${this.avatarEyes()}m${this.avatarMouth()}a${this.avatarAccessory()}`);
  selectedColorHue = computed(() => this.getHueFromHex(this.selectedColor()));

  readonly accessoryLabels = ['Ohne', 'Krone', 'Partyhut', 'Fedora', 'Pirat', 'Schleife', 'Kochhut', 'Schnurrbart'];
  currentAccessoryLabel = computed(() => this.accessoryLabels[this.avatarAccessory()] || 'Ohne');

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.confirmModalOpen()) { this.onCancelDelete(); return; }
    if (this.isCommunityPoolOpen()) { this.closeCommunityPool(); return; }
    if (this.authModalOpen()) { this.authModalOpen.set(false); return; }
    if (this.settingsModalOpen()) { this.settingsModalOpen.set(false); return; }
    if (this.legalModalOpen()) { this.legalModalOpen.set(false); return; }
    if (this.patchNotesModalOpen()) { this.patchNotesModalOpen.set(false); return; }
  }

  ngOnDestroy() {
    this.pendingTimers.forEach(t => clearTimeout(t));
    this.pendingTimers = [];
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  private scheduleTimer(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter(t => t !== id);
      fn();
    }, ms);
    this.pendingTimers.push(id);
  }

  showToast(message: string, type: 'error' | 'info' = 'error') {
    this.toastMessage.set(message);
    this.toastType.set(type);
    this.scheduleTimer(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set('');
      }
    }, 4500);
  }

  private triggerAvatarPop() {
    this.avatarPop.set(false);
    requestAnimationFrame(() => {
      this.avatarPop.set(true);
      this.scheduleTimer(() => this.avatarPop.set(false), 260);
    });
  }

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

  // Patch Notes Modal state
  patchNotesModalOpen = signal(false);

  // Settings form states
  settingsModalOpen = signal(false);
  newUsername = signal('');
  settingsError = signal('');
  settingsSuccess = signal('');
  showCreateQuizWarning = signal(false);

  // Legal modal states
  legalModalOpen = signal(false);
  activeLegalTab = signal<'impressum' | 'privacy' | 'terms'>('impressum');

  constructor() {
    // Load from localStorage if present
    const savedName = safeLocalStorageGet('jeopardy_player_name');
    const savedColor = safeLocalStorageGet('jeopardy_player_color');
    const savedAvatar = safeLocalStorageGet('jeopardy_player_avatar');

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

    effect(() => {
      const state = this.p2pService.gameState();
      if (this.p2pService.isHost() && state.selectedQuizzes && state.phase === 'LOBBY') {
        const ids = state.selectedQuizzes.map(q => q.id);
        if (JSON.stringify(this.selectedTemplates()) !== JSON.stringify(ids)) {
          this.selectedTemplates.set(ids);
        }
      }
    });

    effect(() => {
      const state = this.p2pService.gameState();
      const conn = this.p2pService.connectionState();
      if (conn === 'connected' && state.phase !== 'LOBBY') {
        this.router.navigate(['/game']);
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
  selectedTemplates = signal<string[]>([]);
  showTemplateWarning = signal(false);
  buzzerTimeout = signal('20');
  deductPointsOnTimeout = signal(false);
  autoStartTimer = signal(true);
  incompleteQuizWarning = signal<{ name: string; id: string } | null>(null);

  // Community Pool state
  isCommunityPoolOpen = signal(false);
  communityQuizzes = signal<any[]>([]);
  communityPage = signal(1);
  communityTotalPages = signal(1);
  communitySearch = signal('');
  communityLoading = signal(false);
  communityFavoritesOnly = signal(false);

  canStartGame = computed(() => {
    if (this.selectedTemplates().length === 0) {
      return false;
    }
    const guests = this.p2pService.players().filter(p => !p.isHost && !p.isOffline);
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
    if (this.selectedTemplates().length === 0) {
      return 'Bitte wähle mindestens eine Quiz-Vorlage aus.';
    }
    const guests = this.p2pService.players().filter(p => !p.isHost && !p.isOffline);
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
        return `Warte auf mindestens 2 aktive Spieler (derzeit: ${guests.length}).`;
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
          if (this.selectedTemplates().includes(id)) {
            this.selectedTemplates.set(this.selectedTemplates().filter(tid => tid !== id));
          }
          this.refreshTrigger.update(n => n + 1);
        },
        error: (err) => {
          console.error('Failed to delete quiz:', err);
          this.showToast('Fehler beim Löschen des Quizzes.');
        }
      });
    } else if (this.confirmModalType() === 'account') {
      this.settingsModalOpen.set(false);
      this.authService.deleteAccount().then(() => {
        this.playerName.set('');
        this.selectedTemplates.set([]);
      }).catch(err => {
        this.showToast(err.message || 'Fehler beim Löschen des Kontos.');
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

  getHueFromHex(hex: string): number {
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return 45;
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;

    if (max !== min) {
      let d = max - min;
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    const result = Math.round(h * 360);
    return Number.isFinite(result) ? result : 45;
  }

  hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  onSliderChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const hue = parseInt(input.value, 10);
    const hex = this.hslToHex(hue, 85, 50);
    this.selectedColor.set(hex);
  }

  presetColors = [
    { name: 'Gelb', hex: '#f1b814' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Rot', hex: '#ef4444' },
    { name: 'Grün', hex: '#10b981' },
    { name: 'Blau', hex: '#0ea5e9' },
    { name: 'Violett', hex: '#a855f7' }
  ];

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
    
    const current = this.selectedTemplates();
    if (current.includes(templateId)) {
      this.selectedTemplates.set(current.filter(id => id !== templateId));
    } else {
      if (current.length >= 3) {
        return;
      }
      this.selectedTemplates.set([...current, templateId]);
    }
    if (this.selectedTemplates().length > 0) {
      this.showTemplateWarning.set(false);
    }

    // Sync changes with P2P game state if connected as host
    if (this.p2pService.isHost() && this.p2pService.connectionState() === 'connected') {
      const updatedQuizzes = this.selectedTemplates().map(id => {
        const tmpl = this.quizTemplates().find(t => t.id === id);
        return {
          id: id,
          name: tmpl?.name || 'Unbekanntes Quiz',
          icon: tmpl?.icon || '❓',
          categoriesCount: tmpl?.categories.length || 0,
          questionsCount: tmpl ? tmpl.categories.reduce((acc, cat) => acc + cat.questions.length, 0) : 0
        };
      });
      this.p2pService.updateSelectedQuizzes(updatedQuizzes);
    }
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

  onAutoStartTimerChange(checked: boolean) {
    this.autoStartTimer.set(checked);
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
      safeLocalStorageSet('jeopardy_player_name', name);
      safeLocalStorageSet('jeopardy_player_color', this.selectedColor());
      safeLocalStorageSet('jeopardy_player_avatar', this.selectedAvatar());

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
    if (this.selectedTemplates().length === 0) {
      this.showTemplateWarning.set(true);
      this.joinError.set('Bitte wähle mindestens eine Quiz-Vorlage aus, um einen Spielraum zu erstellen.');
      return;
    }
    
    this.showTemplateWarning.set(false);
    this.joinError.set('');

    // Generate a cryptographically random 6-character room code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = new Uint8Array(6);
    crypto.getRandomValues(randomBytes);
    let randomCode = '';
    for (let i = 0; i < 6; i++) {
      randomCode += chars.charAt(randomBytes[i] % chars.length);
    }

    try {
      safeLocalStorageSet('jeopardy_player_name', name);
      safeLocalStorageSet('jeopardy_player_color', this.selectedColor());
      safeLocalStorageSet('jeopardy_player_avatar', this.selectedAvatar());

      const initialQuizzes = this.selectedTemplates().map(id => {
        const tmpl = this.quizTemplates().find(t => t.id === id);
        return {
          id: id,
          name: tmpl?.name || 'Unbekanntes Quiz',
          icon: tmpl?.icon || '❓',
          categoriesCount: tmpl?.categories.length || 0,
          questionsCount: tmpl ? tmpl.categories.reduce((acc, cat) => acc + cat.questions.length, 0) : 0
        };
      });

      await this.p2pService.hostRoom(
        randomCode,
        name,
        this.selectedColor(),
        this.selectedAvatar(),
        parseInt(this.maxPlayers()),
        this.teamMode(),
        parseInt(this.teamSize()),
        parseInt(this.buzzerTimeout()),
        this.deductPointsOnTimeout(),
        this.autoStartTimer(),
        initialQuizzes
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
      this.scheduleTimer(() => this.codeCopied.set(false), 2000);
    }
  }

  onStartGame() {
    const templates = this.selectedTemplates().map(id =>
      this.quizService.getTemplateById(id, this.authService.currentUser()?.email)
    ).filter((t): t is Exclude<typeof t, null> => !!t);

    if (templates.length > 0) {
      const boards = templates.map(t => t.categories);
      this.p2pService.startGame(boards);
    } else {
      this.showToast('Die ausgewählte Quiz-Vorlage konnte nicht geladen werden. Bitte wähle sie erneut aus.');
    }
  }

  randomizeAvatar() {
    this.avatarBase.set(Math.floor(Math.random() * 8));
    this.avatarEyes.set(Math.floor(Math.random() * 12));
    this.avatarMouth.set(Math.floor(Math.random() * 10));
    this.avatarAccessory.set(Math.floor(Math.random() * 8));

    const randomColorObj = this.avatarColors[Math.floor(Math.random() * this.avatarColors.length)];
    this.selectedColor.set(randomColorObj.hex);
    this.triggerAvatarPop();
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
      this.scheduleTimer(() => {
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
    this.selectedTemplates.set([]);
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
      this.scheduleTimer(() => {
        this.settingsModalOpen.set(false);
      }, 1200);
    } catch (err: any) {
      this.settingsError.set(err.message || 'Aktualisierung fehlgeschlagen.');
    }
  }

  onCreateQuizClick() {
    if (!this.authService.currentUser()) {
      this.showCreateQuizWarning.set(true);
      this.scheduleTimer(() => {
        this.showCreateQuizWarning.set(false);
      }, 5000);
      return;
    }
    this.router.navigate(['/create-quiz']);
  }

  openCommunityPool() {
    this.isCommunityPoolOpen.set(true);
    this.communityPage.set(1);
    this.communitySearch.set('');
    this.communityFavoritesOnly.set(false);
    this.loadCommunityQuizzes();
  }

  closeCommunityPool() {
    this.isCommunityPoolOpen.set(false);
  }

  loadCommunityQuizzes() {
    const seq = ++this.communityReqSeq;
    this.communityLoading.set(true);
    this.quizService.getCommunityQuizzes(this.communityPage(), 9, this.communitySearch(), this.communityFavoritesOnly()).subscribe({
      next: (res) => {
        if (seq !== this.communityReqSeq) return;
        this.communityQuizzes.set(res.quizzes);
        this.communityTotalPages.set(res.totalPages || 1);
        this.communityLoading.set(false);
      },
      error: (err) => {
        if (seq !== this.communityReqSeq) return;
        console.error('Failed to load community quizzes:', err);
        this.communityLoading.set(false);
      }
    });
  }

  toggleFavorite(quiz: any) {
    if (!this.authService.currentUser()) return;
    
    const newFavStatus = !quiz.isFavorited;
    this.quizService.toggleFavorite(quiz.id, newFavStatus).subscribe({
      next: () => {
        this.communityQuizzes.update(list => 
          list.map(q => q.id === quiz.id ? { ...q, isFavorited: newFavStatus } : q)
        );
        if (this.communityFavoritesOnly() && !newFavStatus) {
          this.loadCommunityQuizzes();
        }

        if (!newFavStatus) {
          this.quizService.temporaryCommunityQuizzes.update(list => 
            list.filter(q => q.id !== quiz.id)
          );
          this.selectedTemplates.update(ids => ids.filter(id => id !== quiz.id));

          if (this.p2pService.isHost() && this.p2pService.connectionState() === 'connected') {
            const updatedQuizzes = this.selectedTemplates().map(tid => {
              const tmpl = this.quizTemplates().find(t => t.id === tid);
              return {
                id: tid,
                name: tmpl?.name || 'Unbekanntes Quiz',
                icon: tmpl?.icon || '❓',
                categoriesCount: tmpl?.categories.length || 0,
                questionsCount: tmpl ? tmpl.categories.reduce((acc, cat) => acc + cat.questions.length, 0) : 0
              };
            });
            this.p2pService.updateSelectedQuizzes(updatedQuizzes);
          }
        }
      },
      error: (err) => {
        console.error('Failed to toggle favorite:', err);
        this.showToast('Fehler beim Aktualisieren des Favoritenstatus.');
      }
    });
  }

  unfavoriteCommunityQuiz(quiz: any, event: Event) {
    event.stopPropagation();
    const quizToUnfav = { ...quiz, isFavorited: true };
    this.toggleFavorite(quizToUnfav);
  }

  toggleFavoritesFilter() {
    this.communityFavoritesOnly.set(!this.communityFavoritesOnly());
    this.communityPage.set(1);
    this.loadCommunityQuizzes();
  }

  private searchTimeout: any;

  onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.communitySearch.set(input.value);
    this.communityPage.set(1);

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    this.searchTimeout = setTimeout(() => {
      this.loadCommunityQuizzes();
    }, 300);
  }

  onCommunityPageChange(page: number) {
    if (page < 1 || page > this.communityTotalPages()) return;
    this.communityPage.set(page);
    this.loadCommunityQuizzes();
  }

  onSelectCommunityQuiz(id: string) {
    this.communityLoading.set(true);
    this.quizService.loadFullCommunityQuiz(id).subscribe({
      next: (quiz) => {
        this.communityLoading.set(false);
        this.closeCommunityPool();
        const current = this.selectedTemplates();
        if (!current.includes(quiz.id)) {
          if (current.length >= 3) {
            this.showToast('Es können maximal 3 Quiz-Vorlagen gleichzeitig ausgewählt werden.', 'info');
            return;
          }
          this.selectedTemplates.set([...current, quiz.id]);
          if (this.selectedTemplates().length > 0) {
            this.showTemplateWarning.set(false);
          }

          if (this.p2pService.isHost() && this.p2pService.connectionState() === 'connected') {
            const updatedQuizzes = this.selectedTemplates().map(tid => {
              const tmpl = this.quizTemplates().find(t => t.id === tid) || (tid === quiz.id ? quiz : null);
              return {
                id: tid,
                name: tmpl?.name || 'Unbekanntes Quiz',
                icon: tmpl?.icon || '❓',
                categoriesCount: tmpl?.categories.length || 0,
                questionsCount: tmpl ? tmpl.categories.reduce((acc, cat) => acc + cat.questions.length, 0) : 0
              };
            });
            this.p2pService.updateSelectedQuizzes(updatedQuizzes);
          }
        }
      },
      error: (err) => {
        console.error('Failed to load full community quiz:', err);
        this.communityLoading.set(false);
        this.showToast('Fehler beim Laden des Quizzes aus dem Community-Pool.');
      }
    });
  }

  toggleMyQuizPublic(tmpl: any, event: Event) {
    event.stopPropagation();
    const newStatus = !tmpl.isPublic;
    if (newStatus && !this.quizService.isQuizComplete(tmpl)) {
      this.showToast('Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.');
      return;
    }
    this.quizService.toggleQuizPublic(tmpl.id, newStatus).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Failed to toggle quiz visibility:', err);
        this.showToast(err.error?.error || 'Fehler beim Ändern der Sichtbarkeit.');
      }
    });
  }

  cycleBase(direction: number) {
    const total = 8;
    let next = this.avatarBase() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarBase.set(next);
    this.triggerAvatarPop();
  }

  cycleEyes(direction: number) {
    const total = 12;
    let next = this.avatarEyes() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarEyes.set(next);
    this.triggerAvatarPop();
  }

  cycleMouth(direction: number) {
    const total = 10;
    let next = this.avatarMouth() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarMouth.set(next);
    this.triggerAvatarPop();
  }

  cycleAccessory(direction: number) {
    const total = 8;
    let next = this.avatarAccessory() + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.avatarAccessory.set(next);
    this.triggerAvatarPop();
  }

  openLegalModal(tab: 'impressum' | 'privacy' | 'terms') {
    this.activeLegalTab.set(tab);
    this.legalModalOpen.set(true);
  }
}
