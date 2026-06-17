import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './avatar.component.html'
})
export class AvatarComponent {
  color = input<string>('#f1b814');
  avatar = input<string>('');
  name = input<string>('');
  size = input<'xs' | 'sm' | 'md' | 'lg' | number>('md');

  // Compute pixel size
  pixelSize = computed(() => {
    const val = this.size();
    if (typeof val === 'number') return val;
    const mapping = {
      xs: 24,
      sm: 32,
      md: 40,
      lg: 80
    };
    return mapping[val] || 40;
  });

  // Parse avatar string
  parsedAvatar = computed(() => {
    const code = this.avatar();
    if (!code) return null;
    const match = code.match(/^b(\d+)e(\d+)m(\d+)a(\d+)$/);
    if (!match) return null;
    return {
      base: parseInt(match[1], 10),
      eyes: parseInt(match[2], 10),
      mouth: parseInt(match[3], 10),
      accessory: parseInt(match[4], 10)
    };
  });

  // Initials for fallback
  initials = computed(() => {
    const n = this.name().trim();
    if (!n) return '?';
    return n.slice(0, 2).toUpperCase();
  });

  // Check if color is gold (for dark text fallback)
  isGold = computed(() => {
    const c = this.color().toLowerCase();
    return c === '#f1b814' || c === '#f59e0b' || c === '#fbbf24' || c === 'gold' || c === 'yellow';
  });
}
