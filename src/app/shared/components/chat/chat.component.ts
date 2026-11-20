import { Component, signal, computed, inject, ViewChild, ElementRef, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { P2pService } from '../../../core/services/p2p.service';
import { AvatarComponent } from '../avatar/avatar.component';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarComponent],
  template: `
    <!-- Only show chat when connected to a room -->
    @if (p2pService.connectionState() === 'connected') {
      <div class="relative">

        <!-- Chat Toggle Floating Button -->
        <button
          type="button"
          (click)="toggleChat()"
          [attr.aria-label]="isOpen() ? 'Lobby-Chat schließen' : 'Lobby-Chat öffnen'"
          [attr.aria-expanded]="isOpen()"
          class="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-jeopardy-accent hover:from-blue-400 hover:to-jeopardy-accent-hover text-white shadow-xl shadow-jeopardy-accent/35 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 hover:-translate-y-0.5 active:scale-95 border border-white/20"
          title="Lobby Chat öffnen">

          @if (isOpen()) {
            <svg class="w-6 h-6 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          } @else {
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
            </svg>
          }

          <!-- Unread Messages Badge -->
          @if (unreadCount() > 0) {
            <span class="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-jeopardy-dark shadow-lg animate-pop-in">
              {{ unreadCount() > 99 ? '99+' : unreadCount() }}
            </span>
          }
        </button>

        <!-- Chat Window Overlay -->
        @if (isOpen()) {
          <div
            role="dialog"
            aria-label="Lobby-Chat"
            class="fixed bottom-22 right-4 sm:right-5 w-[min(370px,calc(100vw-2rem))] h-[min(480px,calc(100vh-8rem))] z-50 bg-jeopardy-dark/95 border border-white/15 rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden backdrop-blur-xl animate-scale-in">

            <!-- Header -->
            <div class="p-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-jeopardy-blue/40 to-black/30">
              <div class="flex items-center gap-2.5">
                <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"></div>
                <div>
                  <h3 class="text-sm font-black text-white leading-tight">Lobby-Chat</h3>
                  <span class="text-[10px] text-white/50 font-bold uppercase tracking-wider">
                    {{ p2pService.players().length }} Teilnehmer
                  </span>
                </div>
              </div>
              <button
                type="button"
                (click)="toggleChat()"
                aria-label="Chat minimieren"
                class="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path>
                </svg>
              </button>
            </div>

            <!-- Tab Switcher (only shown if Team Mode is active and player is in a team) -->
            @if (p2pService.teamMode() && myTeamId() !== undefined) {
              <div role="tablist" class="flex border-b border-white/10 bg-black/20 p-1.5 gap-1.5">
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="activeTab() === 'global'"
                  (click)="setActiveTab('global')"
                  [class]="'flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all duration-200 cursor-pointer relative ' +
                           (activeTab() === 'global' ? 'bg-white/12 text-white shadow-sm' : 'text-white/45 hover:text-white/75 hover:bg-white/5')">
                  Globaler Chat
                  @if (unreadGlobalCount() > 0) {
                    <span class="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-red-500"></span>
                  }
                </button>
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="activeTab() === 'team'"
                  (click)="setActiveTab('team')"
                  [class]="'flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all duration-200 cursor-pointer relative ' +
                           (activeTab() === 'team' ? 'bg-white/12 text-white shadow-sm' : 'text-white/45 hover:text-white/75 hover:bg-white/5')">
                  <span [style.color]="activeTab() === 'team' ? getTeamColor(myTeamId()!) : ''">Team {{ myTeamId() }} Chat</span>
                  @if (unreadTeamCount() > 0) {
                    <span class="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-red-500"></span>
                  }
                </button>
              </div>
            }

            <!-- Messages List -->
            <div
              #messagesContainer
              class="flex-1 p-4 overflow-y-auto scrollbar-thin flex flex-col gap-3 min-h-0 bg-white/[0.01]">

              @if (filteredMessages().length === 0) {
                <div class="flex-1 flex flex-col items-center justify-center text-center p-6 gap-2 text-white/25">
                  <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025 10.314 10.314 0 01-2.286-2.257C2.188 15.611 1.5 13.882 1.5 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"></path>
                  </svg>
                  <span class="text-xs font-semibold uppercase tracking-wider">
                    {{ activeTab() === 'team' ? 'Keine Team-Nachrichten' : 'Keine Nachrichten' }}
                  </span>
                  <p class="text-[10px] max-w-[180px]">Schreibe eine Nachricht, um das Gespräch zu beginnen!</p>
                </div>
              } @else {
                @for (msg of filteredMessages(); track msg.id) {
                  @let isSelf = msg.senderId === p2pService.myPlayerId();
                  @let isHostMsg = msg.senderId === p2pService.roomCode();
                  @let isTeamMsg = p2pService.teamMode() && msg.teamId !== undefined;

                  <div
                    [class]="'flex flex-col max-w-[85%] animate-fade-in ' + (isSelf ? 'self-end' : 'self-start')">

                    <!-- Avatar + Bubble row -->
                    <div [class]="'flex items-start gap-2 ' + (isSelf ? 'flex-row-reverse' : 'flex-row')">
                      <div class="flex-shrink-0 mt-0.5">
                        <app-avatar
                          [avatar]="msg.senderAvatar || ''"
                          [name]="msg.senderName"
                          [size]="26"
                          [animated]="false"
                          [color]="msg.senderColor || '#f1b814'">
                        </app-avatar>
                      </div>

                      <div [class]="'flex flex-col min-w-0 ' + (isSelf ? 'items-end' : 'items-start')">
                        @if (!isSelf) {
                          <div class="flex items-center gap-1 mb-1 px-1">
                            <span
                              [style.color]="msg.senderColor"
                              class="text-[10px] font-black tracking-wide">
                              {{ msg.senderName }}
                            </span>
                            @if (isHostMsg) {
                              <span class="text-[8px] bg-jeopardy-gold/20 text-jeopardy-gold border border-jeopardy-gold/30 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                Host
                              </span>
                            } @else if (isTeamMsg) {
                              <span
                                [style.color]="getTeamColor(msg.teamId!)"
                                class="text-[8px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                Team {{ msg.teamId }}
                              </span>
                            }
                          </div>
                        }

                        <div
                          [class]="'px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap border ' +
                                   (isSelf ?
                                     'bg-jeopardy-accent/20 border-jeopardy-accent/35 text-white rounded-tr-none' :
                                     'bg-white/[0.05] border-white/8 text-white/90 rounded-tl-none')"
                          [style.border-color]="isTeamMsg ? getTeamColor(msg.teamId!) + '40' : ''"
                          [style.background-color]="isTeamMsg ? (isSelf ? getTeamColor(msg.teamId!) + '22' : getTeamColor(msg.teamId!) + '0e') : ''">{{ msg.text }}</div>

                        <span class="text-[9px] text-white/25 mt-1 px-1 font-semibold">
                          {{ msg.timestamp | date:'HH:mm' }}
                        </span>
                      </div>
                    </div>
                  </div>
                }
              }

            </div>

            <!-- Footer Message Input -->
            <form
              (ngSubmit)="sendMessage()"
              class="p-3 bg-black/30 border-t border-white/10 flex gap-2 items-center">

              <input
                type="text"
                [(ngModel)]="messageText"
                name="messageText"
                aria-label="Chat-Nachricht"
                [placeholder]="activeTab() === 'team' ? 'Team-Nachricht eingeben...' : 'Nachricht eingeben...'"
                class="flex-1 bg-white/[0.04] border border-white/10 focus:border-jeopardy-accent rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-jeopardy-accent/25 transition-all"
                autocomplete="off"
                maxlength="200"
                #chatInput>

              <button
                type="submit"
                aria-label="Nachricht senden"
                [disabled]="!messageText.trim()"
                class="w-9 h-9 rounded-xl bg-jeopardy-accent hover:bg-jeopardy-accent-hover text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-md shadow-jeopardy-accent/20">
                <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"></path>
                </svg>
              </button>

            </form>

          </div>
        }

      </div>
    }
  `
})
export class ChatComponent implements OnDestroy {
  p2pService = inject(P2pService);

  @ViewChild('messagesContainer') private messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput') private chatInput!: ElementRef<HTMLInputElement>;

  isOpen = signal(false);
  messageText = '';
  activeTab = signal<'global' | 'team'>('global');
  seenGlobalCount = signal(0);
  seenTeamCount = signal(0);

  private pendingTimers: any[] = [];
  private lastRoomCode: string | null = null;

  myTeamId = computed(() => this.p2pService.me()?.teamId);

  globalMessages = computed(() => {
    return this.p2pService.chatMessages().filter(m => m.teamId === undefined || m.teamId === null);
  });

  teamMessages = computed(() => {
    const myTeam = this.myTeamId();
    if (myTeam === undefined) return [];
    return this.p2pService.chatMessages().filter(m => m.teamId === myTeam);
  });

  filteredMessages = computed(() => {
    const tab = this.activeTab();
    const myTeam = this.myTeamId();

    if (this.p2pService.teamMode() && myTeam !== undefined) {
      return tab === 'team' ? this.teamMessages() : this.globalMessages();
    }
    return this.p2pService.chatMessages();
  });

  unreadGlobalCount = computed(() => {
    if (this.isOpen() && this.activeTab() === 'global') return 0;
    return Math.max(0, this.globalMessages().length - this.seenGlobalCount());
  });

  unreadTeamCount = computed(() => {
    if (this.isOpen() && this.activeTab() === 'team') return 0;
    return Math.max(0, this.teamMessages().length - this.seenTeamCount());
  });

  unreadCount = computed(() => {
    if (this.isOpen()) return 0;
    return this.unreadGlobalCount() + this.unreadTeamCount();
  });

  constructor() {
    // Reset seen counts & tab when switching rooms or disconnecting
    effect(() => {
      const code = this.p2pService.roomCode();
      const connected = this.p2pService.connectionState() === 'connected';
      const teamMode = this.p2pService.teamMode();

      if (!connected || code !== this.lastRoomCode) {
        this.lastRoomCode = connected ? code : null;
        this.seenGlobalCount.set(0);
        this.seenTeamCount.set(0);
        this.activeTab.set('global');
        if (!connected) {
          this.isOpen.set(false);
        }
      }

      if (!teamMode && this.activeTab() === 'team') {
        this.activeTab.set('global');
      }
    });

    // Mark read & scroll when chat is open
    effect(() => {
      this.p2pService.chatMessages();
      const tab = this.activeTab();
      const open = this.isOpen();

      if (open) {
        if (tab === 'global') {
          this.seenGlobalCount.set(this.globalMessages().length);
        } else {
          this.seenTeamCount.set(this.teamMessages().length);
        }
        this.schedule(() => this.scrollToBottom(), 30);
      }
    });
  }

  ngOnDestroy() {
    this.pendingTimers.forEach(t => clearTimeout(t));
    this.pendingTimers = [];
  }

  private schedule(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter(t => t !== id);
      fn();
    }, ms);
    this.pendingTimers.push(id);
  }

  toggleChat() {
    const nextOpen = !this.isOpen();
    this.isOpen.set(nextOpen);
    if (nextOpen) {
      this.seenGlobalCount.set(this.globalMessages().length);
      this.seenTeamCount.set(this.teamMessages().length);
      this.schedule(() => {
        this.scrollToBottom();
        this.focusInput();
      }, 50);
    }
  }

  setActiveTab(tab: 'global' | 'team') {
    this.activeTab.set(tab);
    if (tab === 'global') {
      this.seenGlobalCount.set(this.globalMessages().length);
    } else {
      this.seenTeamCount.set(this.teamMessages().length);
    }
    this.schedule(() => {
      this.scrollToBottom();
      this.focusInput();
    }, 30);
  }

  sendMessage() {
    const text = this.messageText.trim();
    if (!text) return;

    const isTeam = this.activeTab() === 'team';
    this.p2pService.sendChatMessage(text, isTeam);
    this.messageText = '';

    this.schedule(() => {
      this.scrollToBottom();
      this.focusInput();
    }, 10);
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

  private scrollToBottom() {
    if (this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  private focusInput() {
    if (this.chatInput) {
      this.chatInput.nativeElement.focus();
    }
  }
}
