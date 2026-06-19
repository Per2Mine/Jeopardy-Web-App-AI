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
  @Input() strength = 80; // strength slider value (1 to 100)
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
      // Map strength (range 1 to 100) to targetWidth (range 300px down to 4px) using a power curve.
      // This gives fine-grained control over the highly-pixelated guessing range (4px - 50px)
      // and ensures even high-res 2K images become completely unrecognizable at high settings.
      const strengthClamped = Math.max(1, Math.min(100, this.strength));
      
      const targetWidth = Math.max(4, Math.min(img.width, Math.round(4 + 296 * Math.pow(1 - (strengthClamped / 100), 2.5))));
      const aspectRatio = img.height / img.width;
      const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio));

      // 1. Draw image small to an offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = targetWidth;
      offscreen.height = targetHeight;
      const offscreenCtx = offscreen.getContext('2d');
      if (!offscreenCtx) return;
      offscreenCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // 2. Draw scaled up back to the main canvas (matching original dimensions)
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.imageSmoothingEnabled = false;
      // Some browsers require vendor prefixes for imageSmoothingEnabled
      (ctx as any).mozImageSmoothingEnabled = false;
      (ctx as any).webkitImageSmoothingEnabled = false;
      (ctx as any).msImageSmoothingEnabled = false;

      ctx.drawImage(offscreen, 0, 0, targetWidth, targetHeight, 0, 0, img.width, img.height);
    };
    img.src = this.src;
  }
}
