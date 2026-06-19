import { Component, input, computed } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './logo.component.html',
  styleUrl: './logo.component.css'
})
export class LogoComponent {
  size = input<'sm' | 'md' | 'lg'>('md');
  clickable = input<boolean>(true);

  logoClass = computed(() => {
    const sizeClasses = {
      sm: 'text-xl tracking-wider',
      md: 'text-3xl md:text-4xl tracking-widest',
      lg: 'text-5xl md:text-6xl lg:text-7xl tracking-widest'
    };
    return sizeClasses[this.size()];
  });
}
