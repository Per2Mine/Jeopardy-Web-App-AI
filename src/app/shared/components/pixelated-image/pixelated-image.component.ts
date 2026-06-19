import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pixelated-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (pixelate && src) {
      <canvas #canvas [class]="customClass"></canvas>
    } @else if (src) {
      <img [src]="src" [class]="customClass" alt="Bild" />
    }
  `,
  styles: [`
    canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      max-width: 100%;
      height: auto;
      display: block;
    }
  `]
})
export class PixelatedImageComponent implements OnChanges, AfterViewInit {
  @Input() src?: string | null;
  @Input() pixelate = false;
  @Input() strength = 15; // strength slider value (2 to 80)
  @Input() customClass = '';

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['src'] || changes['pixelate'] || changes['strength']) {
      this.triggerDraw();
    }
  }

  ngAfterViewInit() {
    this.triggerDraw();
  }

  private triggerDraw() {
    // Schedule in next microtask / setTimeout to make sure canvas element is created and rendered in DOM
    setTimeout(() => {
      this.drawPixelated();
    }, 0);
  }

  private drawPixelated() {
    if (!this.pixelate || !this.src || !this.canvasRef) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Map strength to a divisor. The higher the strength, the smaller the canvas, hence the more pixelated.
      // Range: strength is between 2 and 80.
      const divisor = Math.max(2, Math.min(80, this.strength));
      
      const w = Math.max(1, Math.round(img.width / divisor));
      const h = Math.max(1, Math.round(img.height / divisor));

      // 1. Draw image small to an offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offscreenCtx = offscreen.getContext('2d');
      if (!offscreenCtx) return;
      offscreenCtx.drawImage(img, 0, 0, w, h);

      // 2. Draw scaled up back to the main canvas (matching original dimensions)
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.imageSmoothingEnabled = false;
      // Some browsers require vendor prefixes for imageSmoothingEnabled
      (ctx as any).mozImageSmoothingEnabled = false;
      (ctx as any).webkitImageSmoothingEnabled = false;
      (ctx as any).msImageSmoothingEnabled = false;

      ctx.drawImage(offscreen, 0, 0, w, h, 0, 0, img.width, img.height);
    };
    img.src = this.src;
  }
}
