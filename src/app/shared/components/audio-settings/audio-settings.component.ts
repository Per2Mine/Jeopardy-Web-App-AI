import { Component, inject } from '@angular/core';
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

  volume = this.audioService.volume;
  muted = this.audioService.muted;

  toggleMute(event: Event) {
    event.stopPropagation();
    this.audioService.muted.set(!this.audioService.muted());
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
