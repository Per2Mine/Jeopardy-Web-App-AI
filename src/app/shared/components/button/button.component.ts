import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.css'
})
export class ButtonComponent {
  variant = input<'primary' | 'secondary' | 'accent' | 'danger' | 'ghost'>('primary');
  size = input<'sm' | 'md' | 'lg'>('md');
  type = input<'button' | 'submit' | 'reset'>('button');
  disabled = input<boolean>(false);
  fullWidth = input<boolean>(false);
  loading = input<boolean>(false);

  buttonClass = computed(() => {
    const baseClasses = 'inline-flex items-center justify-center font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-jeopardy-dark focus-visible:ring-jeopardy-gold disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none transition-all duration-200 ease-out active:scale-[0.97]';

    const variantClasses = {
      primary: 'shimmer-hover bg-gradient-to-b from-jeopardy-gold-light via-jeopardy-gold to-amber-500 hover:brightness-110 text-jeopardy-dark font-extrabold shadow-lg shadow-jeopardy-gold/20 hover:shadow-xl hover:shadow-jeopardy-gold/35 hover:-translate-y-0.5 active:translate-y-0 border border-yellow-200/40',
      secondary: 'bg-jeopardy-blue/45 hover:bg-jeopardy-blue/80 text-white border border-white/12 hover:border-jeopardy-accent/50 shadow-sm hover:shadow-md hover:shadow-jeopardy-accent/15 hover:-translate-y-0.5 active:translate-y-0',
      accent: 'shimmer-hover bg-gradient-to-b from-blue-500 to-jeopardy-accent hover:from-blue-400 hover:to-jeopardy-accent-hover text-white shadow-md shadow-jeopardy-accent/25 hover:shadow-lg hover:shadow-jeopardy-accent/40 hover:-translate-y-0.5 active:translate-y-0 border border-blue-400/25',
      danger: 'bg-gradient-to-b from-red-500/90 to-red-600/90 hover:from-red-500 hover:to-red-600 text-white shadow-md shadow-red-600/20 hover:shadow-lg hover:shadow-red-600/35 hover:-translate-y-0.5 active:translate-y-0 border border-red-400/20',
      ghost: 'bg-transparent hover:bg-white/8 text-white border border-transparent hover:border-white/12'
    };

    const sizeClasses = {
      sm: 'px-3 py-1.5 text-xs rounded-lg',
      md: 'px-5 py-2.5 text-sm rounded-xl',
      lg: 'px-7 py-3 text-base rounded-xl'
    };

    const widthClass = this.fullWidth() ? 'w-full' : '';

    return `${baseClasses} ${variantClasses[this.variant()]} ${sizeClasses[this.size()]} ${widthClass}`;
  });
}
