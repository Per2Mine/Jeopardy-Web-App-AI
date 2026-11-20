import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pixelated-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="overflow-hidden flex items-center justify-center relative" [class]="customClass" style="display: inline-flex;">
      @if (pixelate && src) {
        <canvas #canvas role="img" aria-label="Verpixeltes Fragebild" [style.transform]="transformStyle"></canvas>
      } @else if (src) {
        <img [src]="src" [style.transform]="transformStyle" alt="Fragebild" />
      }
    </div>
  `,
  styles: [`
    canvas, img {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      max-width: inherit;
      max-height: inherit;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
  `]
})
export class PixelatedImageComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() src?: string | null;
  @Input() pixelate = false;
  @Input() strength = 80; // strength slider value (1 to 100)
  @Input() zoom = 1.0;
  @Input() rotation = 0; // rotation angle in degrees
  @Input() customClass = '';

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  private drawTimer: any = null;
  private drawToken = 0;
  private destroyed = false;

  get transformStyle(): string {
    return `rotate(${this.rotation}deg) scale(${this.zoom})`;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['src'] || changes['pixelate'] || changes['strength']) {
      this.triggerDraw();
    }
  }

  ngAfterViewInit() {
    this.triggerDraw();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.drawToken++;
    if (this.drawTimer) {
      clearTimeout(this.drawTimer);
      this.drawTimer = null;
    }
  }

  private triggerDraw() {
    if (this.drawTimer) {
      clearTimeout(this.drawTimer);
    }
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null;
      this.drawPixelated();
    }, 0);
  }

  private drawPixelated() {
    if (this.destroyed || !this.pixelate || !this.src || !this.canvasRef) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const token = ++this.drawToken;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.destroyed || token !== this.drawToken || img.width <= 0 || img.height <= 0) {
        return;
      }

      const strengthClamped = Math.max(1, Math.min(100, this.strength));
      const targetWidth = Math.max(4, Math.min(img.width, Math.round(4 + 296 * Math.pow(1 - (strengthClamped / 100), 2.5))));
      const aspectRatio = img.height / img.width;
      const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio));

      const offscreen = document.createElement('canvas');
      offscreen.width = targetWidth;
      offscreen.height = targetHeight;
      const offscreenCtx = offscreen.getContext('2d');
      if (!offscreenCtx) return;
      offscreenCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.width = img.width;
      canvas.height = img.height;

      ctx.imageSmoothingEnabled = false;
      (ctx as any).mozImageSmoothingEnabled = false;
      (ctx as any).webkitImageSmoothingEnabled = false;
      (ctx as any).msImageSmoothingEnabled = false;

      ctx.drawImage(offscreen, 0, 0, targetWidth, targetHeight, 0, 0, img.width, img.height);
    };
    img.src = this.src;
  }
}
