import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';
import { AuthService } from '../../core/services/auth.service';
import { QuizService, Category, Question } from '../../core/services/quiz.service';

@Component({
  selector: 'app-quiz-creator',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, LogoComponent],
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
              value: (i + 1) * 100
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
      value: (i + 1) * 100
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


  private initCategories(): Category[] {
    const values = [100, 200, 300, 400, 500];
    const cats: Category[] = [];
    for (let c = 0; c < 5; c++) {
      const questions: Question[] = values.map(v => ({
        text: '',
        answer: '',
        value: v
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
  }

  saveActiveCell() {
    const cell = this.activeCell();
    if (!cell) return;

    this.categories.update(cats => {
      const newCats = [...cats];
      newCats[cell.cIndex].questions[cell.qIndex] = {
        ...newCats[cell.cIndex].questions[cell.qIndex],
        text: this.modalQuestionText().trim(),
        answer: this.modalAnswerText().trim()
      };
      return newCats;
    });

    this.activeCell.set(null);
  }

  closeEditModal() {
    this.activeCell.set(null);
  }

  onCategoryNameChange(cIndex: number, value: string) {
    this.categories.update(cats => {
      const newCats = [...cats];
      newCats[cIndex] = {
        ...newCats[cIndex],
        name: value
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

    try {
      this.quizService.saveQuiz(this.quizName(), finalCategories, email, this.editingId() || undefined).subscribe({
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
