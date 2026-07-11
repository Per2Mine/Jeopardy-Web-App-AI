import { Component, inject, ElementRef, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../../core/services/audio.service';

@Component({
  selector: 'app-audio-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-settings.component.html',
  styleUrl: './audio-settings.component.css'
})
export class AudioSettingsComponent {
  audioService = inject(AudioService);
  private elementRef = inject(ElementRef);

  isOpen = signal<boolean>(false);
  volume = this.audioService.volume;
  muted = this.audioService.muted;
  ttsEnabled = this.audioService.ttsEnabled;

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    // Automatically close the popover if a click happens outside the component
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
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
    this.audioService.volume.set(value);
    if (value > 0 && this.audioService.muted()) {
      this.audioService.muted.set(false);
    }
  }
}
