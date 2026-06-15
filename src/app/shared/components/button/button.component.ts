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
    const baseClasses = 'inline-flex items-center justify-center font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-jeopardy-dark focus:ring-jeopardy-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none transition-all duration-300';
    
    const variantClasses = {
      primary: 'bg-jeopardy-gold hover:bg-jeopardy-goldLight text-jeopardy-dark font-extrabold shadow-md shadow-jeopardy-gold/10 hover:shadow-lg hover:shadow-jeopardy-gold/20 transform hover:-translate-y-0.5 active:translate-y-0',
      secondary: 'bg-jeopardy-blue/40 hover:bg-jeopardy-blue/80 text-white border border-jeopardy-accent/30 shadow-sm transform hover:-translate-y-0.5 active:translate-y-0',
      accent: 'bg-jeopardy-accent hover:bg-blue-600 text-white shadow-md shadow-jeopardy-accent/10 active:scale-98',
      danger: 'bg-red-600/80 hover:bg-red-600 text-white shadow-md shadow-red-600/10 active:scale-98',
      ghost: 'bg-transparent hover:bg-white/5 text-white border border-transparent hover:border-white/10 active:scale-98'
    };

    const sizeClasses = {
      sm: 'px-3 py-1.5 text-xs rounded-md',
      md: 'px-5 py-2.5 text-sm rounded-lg',
      lg: 'px-7 py-3 text-base rounded-xl'
    };

    const widthClass = this.fullWidth() ? 'w-full' : '';

    return `${baseClasses} ${variantClasses[this.variant()]} ${sizeClasses[this.size()]} ${widthClass}`;
  });
}
