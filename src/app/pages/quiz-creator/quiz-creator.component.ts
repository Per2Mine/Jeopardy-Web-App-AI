import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';
import { AuthService } from '../../core/services/auth.service';
import { QuizService, Category, Question } from '../../core/services/quiz.service';

import { PixelatedImageComponent } from '../../shared/components/pixelated-image/pixelated-image.component';

@Component({
  selector: 'app-quiz-creator',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, LogoComponent, PixelatedImageComponent],
  templateUrl: './quiz-creator.component.html',
  styleUrl: './quiz-creator.component.css'
})
export class QuizCreatorComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  private quizService = inject(QuizService);
  private route = inject(ActivatedRoute);

  editingId = signal<string | null>(null);
  quizName = signal('');
  errorMessage = signal('');
  rowValues = signal<number[]>([100, 200, 300, 400, 500, 600]);

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('id');
    const email = this.authService.currentUser()?.email;
    
    if (id && email) {
      const template = this.quizService.getTemplateById(id, email);
      if (template && template.userEmail === email) {
        this.editingId.set(id);
        this.quizName.set(template.name);
        
        const count = template.categories[0]?.questions?.length || 5;
        this.numQuestions.set(count);
        
        if (template.categories[0]?.questions) {
          const existingVals = template.categories[0].questions.map(q => q.value);
          const fullVals = [...existingVals];
          for (let i = fullVals.length; i < 6; i++) {
            fullVals.push((i + 1) * 100);
          }
          this.rowValues.set(fullVals);
        }

        // Deep copy the categories so edits do not modify original state until saved
        const copiedCategories = JSON.parse(JSON.stringify(template.categories)) as Category[];
        this.categories.set(copiedCategories);
      } else {
        this.router.navigate(['/']);
      }
    }
  }

  // Categories, dynamically editable
  categories = signal<Category[]>(this.initCategories());
  numQuestions = signal(5);
  totalQuestionsCount = computed(() => this.categories().length * this.numQuestions());

  // Modal Editing State
  activeCell = signal<{ cIndex: number; qIndex: number } | null>(null);
  modalQuestionText = signal('');
  modalAnswerText = signal('');
  modalImage = signal<string | null>(null);
  imageError = signal<string | null>(null);
  modalPixelate = signal(false);
  modalPixelateStrength = signal(80);
  modalReducePixelation = signal(false);
  modalReduceAmount = signal(5);

  onNumQuestionsChange(count: number) {
    this.numQuestions.set(count);
    
    this.categories.update(cats => {
      return cats.map(cat => {
        const currentQs = cat.questions;
        if (currentQs.length < count) {
          const newQs = [...currentQs];
          for (let i = newQs.length; i < count; i++) {
            newQs.push({
              text: '',
              answer: '',
              value: this.rowValues()[i] || (i + 1) * 100
            });
          }
          return {
            ...cat,
            questions: newQs
          };
        }
        return cat;
      });
    });
  }

  addCategory() {
    this.errorMessage.set('');
    if (this.categories().length >= 10) {
      this.errorMessage.set('Maximale Anzahl von 10 Kategorien erreicht.');
      return;
    }

    const maxQsInMemory = this.categories()[0]?.questions?.length || this.numQuestions();
    const newQs: Question[] = Array.from({ length: maxQsInMemory }, (_, i) => ({
      text: '',
      answer: '',
      value: this.rowValues()[i] || (i + 1) * 100
    }));

    this.categories.update(cats => [
      ...cats,
      {
        name: '',
        questions: newQs
      }
    ]);
  }

  removeCategory(index: number) {
    this.errorMessage.set('');
    if (this.categories().length <= 1) {
      this.errorMessage.set('Ein Quiz muss mindestens 1 Kategorie besitzen.');
      return;
    }

    this.categories.update(cats => cats.filter((_, i) => i !== index));
  }

  updateRowValue(qIndex: number, newValue: number) {
    if (isNaN(newValue)) return;
    let clampedValue = newValue;
    if (clampedValue < 0) clampedValue = 0;
    if (clampedValue > 10000) clampedValue = 10000;

    this.rowValues.update(vals => {
      const copy = [...vals];
      copy[qIndex] = clampedValue;
      return copy;
    });
    this.categories.update(cats => cats.map(cat => {
      const updatedQs = [...cat.questions];
      if (updatedQs[qIndex]) {
        updatedQs[qIndex] = {
          ...updatedQs[qIndex],
          value: clampedValue
        };
      }
      return {
        ...cat,
        questions: updatedQs
      };
    }));
  }

  private initCategories(): Category[] {
    const cats: Category[] = [];
    for (let c = 0; c < 5; c++) {
      const questions: Question[] = Array.from({ length: 6 }, (_, i) => ({
        text: '',
        answer: '',
        value: this.rowValues()[i]
      }));
      cats.push({
        name: '',
        questions
      });
    }
    return cats;
  }

  // Check if a specific cell is filled (has both question and answer)
  isCellFilled(cIndex: number, qIndex: number): boolean {
    const q = this.categories()[cIndex].questions[qIndex];
    return q.text.trim().length > 0 && q.answer.trim().length > 0;
  }

  // Get total filled cells count
  getFilledCellsCount(): number {
    let count = 0;
    const limit = this.numQuestions();
    this.categories().forEach(cat => {
      cat.questions.slice(0, limit).forEach(q => {
        if (q.text.trim() && q.answer.trim()) {
          count++;
        }
      });
    });
    return count;
  }

  openEditModal(cIndex: number, qIndex: number) {
    const q = this.categories()[cIndex].questions[qIndex];
    this.activeCell.set({ cIndex, qIndex });
    this.modalQuestionText.set(q.text);
    this.modalAnswerText.set(q.answer);
    this.modalImage.set(q.image || null);
    this.modalPixelate.set(q.pixelate || false);
    this.modalPixelateStrength.set(q.pixelateStrength || 80);
    this.modalReducePixelation.set(q.reducePixelationOnWrong || false);
    this.modalReduceAmount.set(q.reducePixelationAmount || 5);
    this.imageError.set(null);
  }

  saveActiveCell() {
    const cell = this.activeCell();
    if (!cell) return;

    const qText = this.modalQuestionText().trim();
    const aText = this.modalAnswerText().trim();

    if (qText.length > 160) {
      this.imageError.set('Der Frage-Text darf maximal 160 Zeichen lang sein.');
      return;
    }
    if (aText.length > 30) {
      this.imageError.set('Der Antwort-Text darf maximal 30 Zeichen lang sein.');
      return;
    }

    this.categories.update(cats => {
      const newCats = [...cats];
      newCats[cell.cIndex].questions[cell.qIndex] = {
        ...newCats[cell.cIndex].questions[cell.qIndex],
        text: qText,
        answer: aText,
        image: this.modalImage() || undefined,
        pixelate: this.modalPixelate(),
        pixelateStrength: this.modalPixelateStrength(),
        reducePixelationOnWrong: this.modalReducePixelation(),
        reducePixelationAmount: this.modalReduceAmount()
      };
      return newCats;
    });

    this.activeCell.set(null);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Validate format
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        this.imageError.set('Ungültiges Dateiformat. Bitte verwende PNG, JPEG, WEBP oder GIF.');
        return;
      }

      // Validate size (5 MB limit)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        this.imageError.set('Die Bilddatei ist zu groß. Maximale Größe ist 5 MB.');
        return;
      }

      this.imageError.set(null);

      const reader = new FileReader();
      reader.onload = () => {
        this.modalImage.set(reader.result as string);
      };
      reader.onerror = () => {
        this.imageError.set('Fehler beim Lesen der Datei.');
      };
      reader.readAsDataURL(file);
    }
  }

  removeModalImage() {
    this.modalImage.set(null);
    this.modalPixelate.set(false);
    this.modalPixelateStrength.set(80);
    this.modalReducePixelation.set(false);
    this.modalReduceAmount.set(5);
    this.imageError.set(null);
  }

  closeEditModal() {
    this.activeCell.set(null);
  }

  onCategoryNameChange(cIndex: number, value: string) {
    const truncated = value ? value.substring(0, 18) : '';
    this.categories.update(cats => {
      const newCats = [...cats];
      newCats[cIndex] = {
        ...newCats[cIndex],
        name: truncated
      };
      return newCats;
    });
  }

  onSaveQuiz() {
    this.errorMessage.set('');

    const email = this.authService.currentUser()?.email;
    if (!email) {
      this.errorMessage.set('Du musst angemeldet sein, um ein Quiz zu erstellen.');
      return;
    }

    const activeNum = this.numQuestions();
    const finalCategories = this.categories().map(cat => ({
      ...cat,
      questions: cat.questions.slice(0, activeNum)
    }));

    // Strict validation of all fields before saving
    const qName = this.quizName() ? this.quizName().trim() : '';
    if (!qName) {
      this.errorMessage.set('Bitte gib der Quiz-Vorlage einen Namen.');
      return;
    }
    if (qName.length > 30) {
      this.errorMessage.set('Der Quiz-Name darf maximal 30 Zeichen lang sein.');
      return;
    }

    for (let cIndex = 0; cIndex < finalCategories.length; cIndex++) {
      const cat = finalCategories[cIndex];
      const catName = cat.name ? cat.name.trim() : '';
      if (catName.length > 18) {
        this.errorMessage.set(`Der Name für Kategorie ${cIndex + 1} darf maximal 18 Zeichen lang sein.`);
        return;
      }
      for (let qIndex = 0; qIndex < cat.questions.length; qIndex++) {
        const q = cat.questions[qIndex];
        if (q.text && q.text.trim().length > 160) {
          this.errorMessage.set(`Der Frage-Text in Kategorie "${catName || cIndex + 1}" (${(qIndex + 1) * 100} $) darf maximal 160 Zeichen lang sein.`);
          return;
        }
        if (q.answer && q.answer.trim().length > 30) {
          this.errorMessage.set(`Der Antwort-Text in Kategorie "${catName || cIndex + 1}" (${(qIndex + 1) * 100} $) darf maximal 30 Zeichen lang sein.`);
          return;
        }
      }
    }

    try {
      this.quizService.saveQuiz(qName, finalCategories, email, this.editingId() || undefined).subscribe({
        next: () => {
          this.router.navigate(['/']);
        },
        error: (err: any) => {
          this.errorMessage.set(err.error?.error || err.message || 'Speichern fehlgeschlagen.');
        }
      });
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Speichern fehlgeschlagen.');
    }
  }

  onCancel() {
    this.router.navigate(['/']);
  }
}
