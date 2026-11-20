import { Component, inject, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../../core/services/audio.service';

const FORBIDDEN_REBIND_KEYS = new Set([
  'Escape', 'Tab', 'CapsLock', 'NumLock', 'ScrollLock',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
]);

@Component({
  selector: 'app-audio-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-settings.component.html',
  styleUrl: './audio-settings.component.css'
})
export class AudioSettingsComponent implements OnDestroy {
  audioService = inject(AudioService);
  private elementRef = inject(ElementRef);

  isOpen = this.audioService.isPopoverOpen;
  isRebinding = this.audioService.isRebindingKey;
  volume = this.audioService.volume;
  muted = this.audioService.muted;
  ttsEnabled = this.audioService.ttsEnabled;
  buzzerKey = this.audioService.buzzerKey;

  ngOnDestroy() {
    this.isOpen.set(false);
    this.isRebinding.set(false);
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    if (!this.elementRef.nativeElement.contains(event.target) && !this.isRebinding()) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (this.isRebinding()) {
      event.preventDefault();
      event.stopPropagation();
      // Escape cancels rebinding instead of binding Escape as the buzzer key
      if (event.key === 'Escape' || event.code === 'Escape') {
        this.isRebinding.set(false);
        return;
      }
      // Ignore modifier/function keys
      if (FORBIDDEN_REBIND_KEYS.has(event.code)) {
        return;
      }
      this.audioService.buzzerKey.set(event.code);
      this.isRebinding.set(false);
      return;
    }

    // Close dropdown on Escape
    if (this.isOpen() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.isOpen.set(false);
    }
  }

  startRebinding(event: Event) {
    event.stopPropagation();
    this.isRebinding.set(true);
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isOpen.set(!this.isOpen());
  }

  toggleMute(event: Event) {
    event.stopPropagation();
    this.audioService.muted.set(!this.audioService.muted());
  }

  toggleTts(event: Event) {
    event.stopPropagation();
    this.audioService.ttsEnabled.set(!this.audioService.ttsEnabled());
  }

  testVoice(event: Event) {
    event.stopPropagation();
    this.audioService.testTts();
  }

  onVolumeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = parseFloat(input.value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(1, value));
    this.audioService.volume.set(clamped);
    if (clamped > 0 && this.audioService.muted()) {
      this.audioService.muted.set(false);
    }
  }
}
