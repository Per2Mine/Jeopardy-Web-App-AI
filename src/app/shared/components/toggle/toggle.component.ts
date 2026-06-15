import { Component, input, model } from '@angular/core';

@Component({
  selector: 'app-toggle',
  standalone: true,
  imports: [],
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.css'
})
export class ToggleComponent {
  label = input<string>('');
  checked = model<boolean>(false);
  disabled = input<boolean>(false);
  id = input<string>(`toggle-${Math.random().toString(36).substring(2, 9)}`);

  onToggle(): void {
    if (this.disabled()) return;
    this.checked.set(!this.checked());
  }
}
