import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

let nextAvatarUid = 0;

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.css'
})
export class AvatarComponent {
  color = input<string>('#f1b814');
  avatar = input<string>('');
  name = input<string>('');
  size = input<'xs' | 'sm' | 'md' | 'lg' | number>('md');
  mood = input<'idle' | 'happy' | 'excited' | 'winner'>('idle');
  animated = input<boolean>(true);

  // Unique SVG defs prefix per component instance to avoid gradient ID collisions
  readonly uid = `av3d_${++nextAvatarUid}`;

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

  // Enable subtle idle motion only on avatars large enough to enjoy it
  shouldAnimate = computed(() => this.animated() && this.pixelSize() >= 24);

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

  // Compute 3D volumetric clay-toy shading palette from base hex color
  palette = computed(() => {
    const rgb = this.parseHex(this.color());
    const mix = (c: [number, number, number], target: [number, number, number], ratio: number) => {
      const r = Math.round(c[0] + (target[0] - c[0]) * ratio);
      const g = Math.round(c[1] + (target[1] - c[1]) * ratio);
      const b = Math.round(c[2] + (target[2] - c[2]) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    };

    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const isVeryDark = luminance < 0.28;

    return {
      highlight: mix(rgb, [255, 255, 255], 0.45),
      light: mix(rgb, [255, 255, 255], 0.2),
      mid: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
      shadow: mix(rgb, [8, 12, 34], 0.42),
      deepShadow: mix(rgb, [4, 8, 24], 0.62),
      rim: mix(rgb, [255, 255, 255], 0.35),
      featureInk: isVeryDark ? '#f8fafc' : '#0f172a',
      featureSubtle: isVeryDark ? 'rgba(248,250,252,0.55)' : 'rgba(15,23,42,0.45)',
      eyeCatchlight: isVeryDark ? '#0f172a' : '#ffffff',
      isDark: isVeryDark
    };
  });

  // Should eyes blink? Only open-eye types (0: dots, 3: wink, 6: anime, 7: angry)
  canBlink = computed(() => {
    const av = this.parsedAvatar();
    if (!av || !this.shouldAnimate()) return false;
    return av.eyes === 0 || av.eyes === 6 || av.eyes === 7;
  });

  // Initials for fallback
  initials = computed(() => {
    const n = this.name().trim();
    if (!n) return '?';
    return n.slice(0, 2).toUpperCase();
  });

  // Check if color is bright/gold (for dark text fallback)
  isGold = computed(() => {
    const rgb = this.parseHex(this.color());
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return luminance > 0.62;
  });

  private parseHex(inputColor: string): [number, number, number] {
    const c = (inputColor || '#f1b814').trim();
    const hexMatch = c.match(/^#([0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const hex = hexMatch[1];
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }
    const shortMatch = c.match(/^#([0-9a-fA-F]{3})$/);
    if (shortMatch) {
      const h = shortMatch[1];
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16)
      ];
    }
    return [241, 184, 20]; // fallback gold
  }
}
