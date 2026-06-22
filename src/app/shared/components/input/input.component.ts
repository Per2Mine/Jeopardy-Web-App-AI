import { Component, input, model, output } from '@angular/core';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [],
  templateUrl: './input.component.html',
  styleUrl: './input.component.css'
})
export class InputComponent {
  label = input<string>('');
  placeholder = input<string>('');
  type = input<'text' | 'number' | 'password' | 'email' | 'textarea'>('text');
  value = model<string>('');
  error = input<string>('');
  rows = input<number>(3);
  disabled = input<boolean>(false);
  maxLength = input<number | null>(null);
  showCounter = input<boolean>(true);
  id = input<string>(`input-${Math.random().toString(36).substring(2, 9)}`);
  enterPressed = output<void>();

  onInput(event: Event): void {
    const inputEl = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.value.set(inputEl.value);
  }
}
