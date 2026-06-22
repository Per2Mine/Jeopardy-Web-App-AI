import { Component, signal, computed, inject, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { P2pService, ChatMessage } from '../../../core/services/p2p.service';
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
          (click)="toggleChat()"
          class="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-jeopardy-accent hover:bg-jeopardy-accent/80 text-white shadow-xl shadow-jeopardy-accent/20 flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 border border-white/10"
          title="Lobby Chat öffnen">
          
          @if (isOpen()) {
            <!-- Close icon -->
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          } @else {
            <!-- Chat bubble icon -->
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
            </svg>
          }

          <!-- Unread Messages Badge -->
          @if (unreadCount() > 0) {
            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-jeopardy-dark animate-bounce">
              {{ unreadCount() }}
            </span>
          }
        </button>

        <!-- Chat Window Overlay -->
        @if (isOpen()) {
          <div class="fixed bottom-24 right-6 w-[340px] sm:w-[380px] h-[480px] z-50 bg-jeopardy-dark/95 border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-md animate-scale-in">
            
            <!-- Header -->
            <div class="p-4 border-b border-white/10 flex justify-between items-center bg-black/25">
              <div class="flex items-center gap-2.5">
                <div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                <div>
                  <h3 class="text-sm font-black text-white leading-tight">Lobby-Chat</h3>
                  <span class="text-[10px] text-white/50 font-bold uppercase tracking-wider">
                    {{ p2pService.players().length }} Teilnehmer
                  </span>
                </div>
              </div>
              <button 
                (click)="toggleChat()"
                class="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"></path>
                </svg>
              </button>
            </div>

            <!-- Messages List -->
            <div 
              #messagesContainer
              class="flex-1 p-4 overflow-y-auto flex flex-col gap-3 min-h-0 bg-white/[0.01]">
              
              @if (p2pService.chatMessages().length === 0) {
                <div class="flex-1 flex flex-col items-center justify-center text-center p-6 gap-2 text-white/20">
                  <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025 10.314 10.314 0 01-2.286-2.257C2.188 15.611 1.5 13.882 1.5 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"></path>
                  </svg>
                  <span class="text-xs font-semibold uppercase tracking-wider">Noch keine Nachrichten</span>
                  <p class="text-[10px] max-w-[180px]">Schreibe eine Nachricht, um das Gespräch zu beginnen!</p>
                </div>
              } @else {
                @for (msg of p2pService.chatMessages(); track msg.id) {
                  @let isSelf = msg.senderId === p2pService.myPlayerId();
                  @let isHostMsg = msg.senderId === p2pService.roomCode();

                  <div 
                    [class]="'flex flex-col max-w-[85%] ' + (isSelf ? 'self-end' : 'self-start')">
                    
                    <!-- Avatar + Bubble row -->
                    <div [class]="'flex items-start gap-2 ' + (isSelf ? 'flex-row-reverse' : 'flex-row')">
                      <!-- Avatar -->
                      <div class="flex-shrink-0 mt-0.5">
                        <app-avatar 
                          [avatar]="msg.senderAvatar || ''" 
                          [name]="msg.senderName" 
                          [size]="24" 
                          [color]="msg.senderColor || '#f1b814'">
                        </app-avatar>
                      </div>

                      <div [class]="'flex flex-col ' + (isSelf ? 'items-end' : 'items-start')">
                        <!-- Sender Name/Badge -->
                        @if (!isSelf) {
                          <div class="flex items-center gap-1 mb-1 px-1">
                            <span 
                              [style.color]="msg.senderColor"
                              class="text-[10px] font-black tracking-wide">
                              {{ msg.senderName }}
                            </span>
                            @if (isHostMsg) {
                              <span class="text-[8px] bg-jeopardy-gold/20 text-jeopardy-gold border border-jeopardy-gold/30 px-1 py-0.2 rounded uppercase font-bold tracking-wider">
                                Host
                              </span>
                            }
                          </div>
                        }

                        <!-- Message Bubble -->
                        <div 
                          [class]="'px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words border ' + 
                                   (isSelf ? 
                                     'bg-jeopardy-accent/15 border-jeopardy-accent/30 text-white rounded-tr-none' : 
                                     'bg-white/[0.04] border-white/5 text-white/90 rounded-tl-none')">
                          {{ msg.text }}
                        </div>

                        <!-- Timestamp -->
                        <span class="text-[9px] text-white/20 mt-1 px-1 font-semibold">
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
              class="p-3 bg-black/25 border-t border-white/10 flex gap-2 items-center">
              
              <input 
                type="text"
                [(ngModel)]="messageText"
                name="messageText"
                placeholder="Nachricht eingeben..."
                class="flex-1 bg-white/[0.03] border border-white/10 focus:border-jeopardy-accent rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none transition-colors"
                autocomplete="off"
                maxlength="200"
                #chatInput>

              <button 
                type="submit"
                [disabled]="!messageText.trim()"
                class="w-8 h-8 rounded-xl bg-jeopardy-accent hover:bg-jeopardy-accent/80 text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-md shadow-jeopardy-accent/15">
                <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"></path>
                </svg>
              </button>

            </form>

          </div>
        }

      </div>
    }
  `,
  styles: [`
    @keyframes scaleIn {
      from {
        opacity: 0;
        transform: scale(0.9) translateY(12px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .animate-scale-in {
      animation: scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  `]
})
export class ChatComponent {
  p2pService = inject(P2pService);

  @ViewChild('messagesContainer') private messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput') private chatInput!: ElementRef<HTMLInputElement>;

  isOpen = signal(false);
  seenMessagesCount = signal(0);
  messageText = '';

  unreadCount = computed(() => {
    if (this.isOpen()) return 0;
    return Math.max(0, this.p2pService.chatMessages().length - this.seenMessagesCount());
  });

  constructor() {
    // Automatically mark read & scroll when chat is open and a new message arrives
    effect(() => {
      const msgs = this.p2pService.chatMessages();
      if (this.isOpen()) {
        this.seenMessagesCount.set(msgs.length);
        setTimeout(() => this.scrollToBottom(), 30);
      }
    });
  }

  toggleChat() {
    const nextOpen = !this.isOpen();
    this.isOpen.set(nextOpen);
    if (nextOpen) {
      this.seenMessagesCount.set(this.p2pService.chatMessages().length);
      setTimeout(() => {
        this.scrollToBottom();
        this.focusInput();
      }, 50);
    }
  }

  sendMessage() {
    const text = this.messageText.trim();
    if (!text) return;

    this.p2pService.sendChatMessage(text);
    this.messageText = '';
    
    setTimeout(() => {
      this.scrollToBottom();
      this.focusInput();
    }, 10);
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
