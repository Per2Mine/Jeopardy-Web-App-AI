import { Component, signal, computed, inject, OnInit, OnDestroy, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { LogoComponent } from '../../shared/components/logo/logo.component';
import { AuthService } from '../../core/services/auth.service';
import { QuizService, Category, Question } from '../../core/services/quiz.service';
import { AudioService } from '../../core/services/audio.service';

import { PixelatedImageComponent } from '../../shared/components/pixelated-image/pixelated-image.component';
import { ToggleComponent } from '../../shared/components/toggle/toggle.component';
import { CdkDropList, CdkDrag, CdkDragHandle, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-quiz-creator',
  standalone: true,
  imports: [CommonModule, ButtonComponent, InputComponent, LogoComponent, PixelatedImageComponent, ToggleComponent, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './quiz-creator.component.html',
  styleUrl: './quiz-creator.component.css'
})
export class QuizCreatorComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private quizService = inject(QuizService);
  private route = inject(ActivatedRoute);
  private audioService = inject(AudioService);
  private modalSessionToken = 0;
  private pendingAudioObjectUrl: string | null = null;

  editingId = signal<string | null>(null);
  quizName = signal('');
  quizIcon = signal('📝');
  showIconSelector = signal(false);
  isPublic = signal(false);
  isSaving = signal(false);
  errorMessage = signal('');
  rowValues = signal<number[]>([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);

  selectableIcons = [
    '📝', '🎵', '🎮', '🎬', '⚽', '🌍', '🧠', '🔬', '🎨', '🚀',
    '🍿', '🍔', '🐾', '💻', '💡', '📚', '🎖️', '🦸', '🎭', '🔮',
    '🎉', '🔥', '🏆', '🧩', '🎸', '📷', '✈️', '🍕', '🍻', '🪐'
  ];

  // Categories, dynamically editable
  categories = signal<Category[]>(this.initCategories());
  numQuestions = signal(5);
  totalQuestionsCount = computed(() => this.categories().length * this.numQuestions());

  // Modal Editing State
  activeCell = signal<{ cIndex: number; qIndex: number } | null>(null);
  modalQuestionText = signal('');
  modalAnswerText = signal('');
  modalTextError = signal<string | null>(null);
  modalImage = signal<string | null>(null);
  imageError = signal<string | null>(null);
  modalPixelate = signal(false);
  modalPixelateStrength = signal(80);
  modalReducePixelation = signal(false);
  modalReduceAmount = signal(5);
  modalZoom = signal(1.0);
  modalRotation = signal(0);

  // Modal Audio State
  modalAudio = signal<string | null>(null);
  modalAudioStart = signal<number>(0);
  modalAudioEnd = signal<number>(10);
  modalAudioSpeed = signal<number>(1.0);
  modalAudioPitch = signal<number>(0);
  modalAudioDuration = signal<number>(0);
  audioError = signal<string | null>(null);
  modalAudioPlaying = signal<boolean>(false);

  constructor() {
    // Automatically turn off public visibility if quiz becomes incomplete (e.g., adding a row/category)
    effect(() => {
      if (this.isPublic() && !this.isQuizCompleteLocal()) {
        this.isPublic.set(false);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.showIconSelector()) {
      this.showIconSelector.set(false);
    } else if (this.activeCell()) {
      this.closeEditModal();
    }
  }

  async ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('id');
    if (!id) return;

    await this.authService.whenReady();
    await this.quizService.whenQuizzesLoaded();

    const email = this.authService.currentUser()?.email;
    if (email) {
      const template = this.quizService.getTemplateById(id, email);
      if (template && template.userEmail === email) {
        this.editingId.set(id);
        this.quizName.set(template.name);
        this.quizIcon.set(template.icon || '📝');
        
        const count = template.categories[0]?.questions?.length || 5;
        this.numQuestions.set(count);
        
        if (template.categories[0]?.questions) {
          const existingVals = template.categories[0].questions.map(q => q.value);
          const fullVals = [...existingVals];
          for (let i = fullVals.length; i < 10; i++) {
            fullVals.push((i + 1) * 100);
          }
          this.rowValues.set(fullVals);
        }

        // Deep copy the categories so edits do not modify original state until saved
        const copiedCategories = JSON.parse(JSON.stringify(template.categories)) as Category[];
        this.categories.set(copiedCategories);
        this.isPublic.set(template.isPublic || false);
      } else {
        this.router.navigate(['/']);
      }
    } else {
      this.router.navigate(['/']);
    }
  }

  ngOnDestroy() {
    this.modalSessionToken++;
    this.audioService.stopPreview();
    if (this.pendingAudioObjectUrl) {
      URL.revokeObjectURL(this.pendingAudioObjectUrl);
      this.pendingAudioObjectUrl = null;
    }
  }

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
      const questions: Question[] = Array.from({ length: 10 }, (_, i) => ({
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
    this.modalSessionToken++;
    const sessionToken = this.modalSessionToken;
    const q = this.categories()[cIndex].questions[qIndex];
    this.activeCell.set({ cIndex, qIndex });
    this.modalQuestionText.set(q.text);
    this.modalAnswerText.set(q.answer);
    this.modalTextError.set(null);
    this.modalImage.set(q.image || null);
    this.modalPixelate.set(q.pixelate || false);
    this.modalPixelateStrength.set(q.pixelateStrength ?? 80);
    this.modalReducePixelation.set(q.reducePixelationOnWrong || false);
    this.modalReduceAmount.set(q.reducePixelationAmount || 5);
    this.modalZoom.set(q.zoom || 1.0);
    this.modalRotation.set(q.rotation || 0);
    this.imageError.set(null);

    // Audio state
    this.modalAudio.set(q.audio || null);
    this.modalAudioStart.set(q.audioStart || 0);
    this.modalAudioEnd.set(q.audioEnd || 10);
    this.modalAudioSpeed.set(q.audioSpeed || 1.0);
    this.modalAudioPitch.set(q.audioPitch || 0);
    this.modalAudioDuration.set(0);
    this.audioError.set(null);
    this.modalAudioPlaying.set(false);

    if (q.audio) {
      const audio = new Audio(q.audio);
      audio.addEventListener('loadedmetadata', () => {
        if (this.modalSessionToken !== sessionToken) return;
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        this.modalAudioDuration.set(dur);
        if (dur > 0 && this.modalAudioEnd() > dur) {
          this.modalAudioEnd.set(dur);
        }
      });
    }
  }

  saveActiveCell() {
    const cell = this.activeCell();
    if (!cell) return;

    this.modalTextError.set(null);
    this.audioError.set(null);

    const qText = this.modalQuestionText().trim();
    const aText = this.modalAnswerText().trim();

    if (qText.length > 160) {
      this.modalTextError.set('Der Frage-Text darf maximal 160 Zeichen lang sein.');
      return;
    }
    if (aText.length > 100) {
      this.modalTextError.set('Der Antwort-Text darf maximal 100 Zeichen lang sein.');
      return;
    }

    if (this.modalAudio()) {
      const duration = this.modalAudioEnd() - this.modalAudioStart();
      if (duration <= 0) {
        this.audioError.set('Die Endzeit muss größer als die Startzeit sein.');
        return;
      }
      if (duration > 10.1) {
        this.audioError.set('Der ausgewählte Ausschnitt darf maximal 10 Sekunden lang sein (aktuell: ' + duration.toFixed(1) + 's).');
        return;
      }
    }

    this.stopModalAudioPreview();

    this.categories.update(cats => {
      const newCats = [...cats];
      const targetCat = newCats[cell.cIndex];
      const updatedQuestions = [...targetCat.questions];
      updatedQuestions[cell.qIndex] = {
        ...updatedQuestions[cell.qIndex],
        text: qText,
        answer: aText,
        image: this.modalImage() || undefined,
        pixelate: this.modalPixelate(),
        pixelateStrength: this.modalPixelateStrength(),
        reducePixelationOnWrong: this.modalReducePixelation(),
        reducePixelationAmount: this.modalReduceAmount(),
        zoom: this.modalZoom(),
        rotation: this.modalRotation(),
        
        // Save Audio state
        audio: this.modalAudio() || undefined,
        audioStart: this.modalAudio() ? this.modalAudioStart() : undefined,
        audioEnd: this.modalAudio() ? this.modalAudioEnd() : undefined,
        audioSpeed: this.modalAudio() ? this.modalAudioSpeed() : undefined,
        audioPitch: this.modalAudio() ? this.modalAudioPitch() : undefined
      };
      newCats[cell.cIndex] = {
        ...targetCat,
        questions: updatedQuestions
      };
      return newCats;
    });

    this.modalSessionToken++;
    this.activeCell.set(null);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const sessionToken = this.modalSessionToken;

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
        if (this.modalSessionToken !== sessionToken) return;
        this.modalImage.set(reader.result as string);
      };
      reader.onerror = () => {
        if (this.modalSessionToken !== sessionToken) return;
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
    this.modalZoom.set(1.0);
    this.modalRotation.set(0);
    this.imageError.set(null);
  }

  onAudioFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const sessionToken = this.modalSessionToken;

      // Validate format (MP3 only)
      if (file.type !== 'audio/mp3' && file.type !== 'audio/mpeg') {
        this.audioError.set('Ungültiges Audio-Dateiformat. Bitte verwende nur MP3.');
        return;
      }

      // Validate size (10 MB limit)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        this.audioError.set('Die Audiodatei ist zu groß. Maximale Größe ist 10 MB.');
        return;
      }

      if (this.pendingAudioObjectUrl) {
        URL.revokeObjectURL(this.pendingAudioObjectUrl);
        this.pendingAudioObjectUrl = null;
      }

      const objectUrl = URL.createObjectURL(file);
      this.pendingAudioObjectUrl = objectUrl;
      const audio = new Audio();
      audio.src = objectUrl;

      const cleanupUrl = () => {
        URL.revokeObjectURL(objectUrl);
        if (this.pendingAudioObjectUrl === objectUrl) {
          this.pendingAudioObjectUrl = null;
        }
      };

      audio.addEventListener('loadedmetadata', () => {
        if (this.modalSessionToken !== sessionToken) {
          cleanupUrl();
          return;
        }
        this.audioError.set(null);
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        const reader = new FileReader();
        reader.onload = () => {
          cleanupUrl();
          if (this.modalSessionToken !== sessionToken) return;
          this.modalAudio.set(reader.result as string);
          this.modalAudioStart.set(0);
          this.modalAudioEnd.set(Math.min(10, dur || 10));
          this.modalAudioDuration.set(dur);
          this.modalAudioSpeed.set(1.0);
          this.modalAudioPitch.set(0);
        };
        reader.onerror = () => {
          cleanupUrl();
          if (this.modalSessionToken !== sessionToken) return;
          this.audioError.set('Fehler beim Lesen der Datei.');
        };
        reader.readAsDataURL(file);
      });
      audio.addEventListener('error', () => {
        cleanupUrl();
        if (this.modalSessionToken !== sessionToken) return;
        this.audioError.set('Fehler beim Analysieren der Audiodatei. Eventuell ist die Datei beschädigt.');
      });
    }
  }

  removeModalAudio() {
    this.stopModalAudioPreview();
    this.modalAudio.set(null);
    this.modalAudioStart.set(0);
    this.modalAudioEnd.set(10);
    this.modalAudioSpeed.set(1.0);
    this.modalAudioPitch.set(0);
    this.modalAudioDuration.set(0);
    this.audioError.set(null);
  }

  toggleModalAudioPreview() {
    if (this.modalAudioPlaying()) {
      this.stopModalAudioPreview();
    } else {
      this.startModalAudioPreview();
    }
  }

  startModalAudioPreview() {
    if (!this.modalAudio()) return;
    this.stopModalAudioPreview();

    this.modalAudioPlaying.set(true);
    this.audioService.playPreview(
      this.modalAudio()!,
      this.modalAudioStart(),
      this.modalAudioEnd(),
      this.modalAudioSpeed(),
      this.modalAudioPitch(),
      () => {
        this.modalAudioPlaying.set(false);
      }
    );
  }

  stopModalAudioPreview() {
    this.audioService.stopPreview();
    this.modalAudioPlaying.set(false);
  }

  onAudioStartChange(val: number) {
    this.stopModalAudioPreview();
    if (val >= this.modalAudioEnd()) {
      this.modalAudioStart.set(Math.max(0, this.modalAudioEnd() - 0.1));
    } else {
      this.modalAudioStart.set(val);
    }
  }

  onAudioEndChange(val: number) {
    this.stopModalAudioPreview();
    const maxDur = this.modalAudioDuration();
    if (val <= this.modalAudioStart()) {
      const nextEnd = this.modalAudioStart() + 0.1;
      this.modalAudioEnd.set(maxDur > 0 ? Math.min(maxDur, nextEnd) : nextEnd);
    } else {
      this.modalAudioEnd.set(val);
    }
  }

  onAudioSpeedChange(val: number) {
    this.stopModalAudioPreview();
    this.modalAudioSpeed.set(val);
  }

  onAudioPitchChange(val: number) {
    this.stopModalAudioPreview();
    this.modalAudioPitch.set(val);
  }

  closeEditModal() {
    this.modalSessionToken++;
    this.stopModalAudioPreview();
    this.activeCell.set(null);
  }

  onCategoryNameChange(cIndex: number, value: string) {
    const truncated = value ? value.substring(0, 30) : '';
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
    if (this.isSaving()) return;
    this.errorMessage.set('');

    const email = this.authService.currentUser()?.email;
    if (!email) {
      this.errorMessage.set('Du musst angemeldet sein, um ein Quiz zu erstellen.');
      return;
    }

    if (this.isPublic() && !this.isQuizCompleteLocal()) {
      this.errorMessage.set('Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.');
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
      if (catName.length > 30) {
        this.errorMessage.set(`Der Name für Kategorie ${cIndex + 1} darf maximal 30 Zeichen lang sein.`);
        return;
      }
      for (let qIndex = 0; qIndex < cat.questions.length; qIndex++) {
        const q = cat.questions[qIndex];
        const qVal = q.value ?? ((qIndex + 1) * 100);
        if (q.text && q.text.trim().length > 160) {
          this.errorMessage.set(`Der Frage-Text in Kategorie "${catName || cIndex + 1}" (${qVal} $) darf maximal 160 Zeichen lang sein.`);
          return;
        }
        if (q.answer && q.answer.trim().length > 100) {
          this.errorMessage.set(`Der Antwort-Text in Kategorie "${catName || cIndex + 1}" (${qVal} $) darf maximal 100 Zeichen lang sein.`);
          return;
        }
      }
    }

    this.isSaving.set(true);
    try {
      this.quizService.saveQuiz(qName, finalCategories, email, this.editingId() || undefined, this.isPublic(), this.quizIcon()).subscribe({
        next: () => {
          this.isSaving.set(false);
          this.router.navigate(['/']);
        },
        error: (err: any) => {
          this.isSaving.set(false);
          this.errorMessage.set(err.error?.error || err.message || 'Speichern fehlgeschlagen.');
        }
      });
    } catch (err: any) {
      this.isSaving.set(false);
      this.errorMessage.set(err.message || 'Speichern fehlgeschlagen.');
    }
  }

  isQuizCompleteLocal(): boolean {
    const activeNum = this.numQuestions();
    const cats = this.categories();
    if (!cats || cats.length === 0) return false;
    for (const cat of cats) {
      if (!cat.name?.trim()) return false;
      if (!cat.questions || cat.questions.length < activeNum) return false;
      for (let i = 0; i < activeNum; i++) {
        const q = cat.questions[i];
        if (!q || !q.text?.trim() || !q.answer?.trim()) return false;
      }
    }
    return true;
  }

  onDragHandlePointerDown(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const card = handle.closest('.cdk-drag') as HTMLElement;
    if (card) {
      const rect = card.getBoundingClientRect();
      document.documentElement.style.setProperty('--dragged-width', `${rect.width}px`);
      document.documentElement.style.setProperty('--dragged-height', `${rect.height}px`);
    }
  }

  onDropCdk(event: CdkDragDrop<Category[]>) {
    this.categories.update(cats => {
      const updated = [...cats];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });
  }

  onCancel() {
    this.router.navigate(['/']);
  }
}
