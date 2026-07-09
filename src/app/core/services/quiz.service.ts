import { Injectable, signal, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface Question {
  text: string;
  answer: string;
  value: number;
  image?: string;
  pixelate?: boolean;
  pixelateStrength?: number;
  reducePixelationOnWrong?: boolean;
  reducePixelationAmount?: number;
  zoom?: number;
  rotation?: number;
  audio?: string;
  audioStart?: number;
  audioEnd?: number;
  audioSpeed?: number;
  audioPitch?: number;
}

export interface Category {
  name: string;
  questions: Question[];
}

export interface QuizTemplate {
  id: string;
  name: string;
  icon: string;
  userEmail?: string; // Owned by user if set
  isComplete?: boolean; // Whether all fields are filled
  isPublic?: boolean; // Public visibility
  isFavorited?: boolean; // Favorited by user
  creatorName?: string; // Creator username reference
  categories: Category[];
}

@Injectable({
  providedIn: 'root'
})
export class QuizService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private QUIZZES_KEY = 'jeopardy_custom_quizzes';

  // Custom quizzes fetched from backend
  customQuizzes = signal<QuizTemplate[]>([]);
  temporaryCommunityQuizzes = signal<QuizTemplate[]>([]);

  // Default system templates
  private defaultTemplates: QuizTemplate[] = [];

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadQuizzes();
        this.syncLegacyQuizzes();
      } else {
        this.customQuizzes.set([]);
      }
    });
  }

  loadQuizzes() {
    this.http.get<QuizTemplate[]>('/api/quizzes').subscribe({
      next: (quizzes) => {
        this.customQuizzes.set(quizzes);
      },
      error: (err) => {
        console.error('Failed to load custom quizzes from backend:', err);
      }
    });
  }

  private syncLegacyQuizzes() {
    const quizzesStr = localStorage.getItem(this.QUIZZES_KEY);
    if (!quizzesStr) return;

    try {
      const legacyQuizzes = JSON.parse(quizzesStr) || [];
      if (legacyQuizzes.length > 0) {
        this.http.post('/api/quizzes/sync', { quizzes: legacyQuizzes }).subscribe({
          next: () => {
            console.log('Legacy custom quizzes successfully migrated to backend.');
            localStorage.removeItem(this.QUIZZES_KEY);
            this.loadQuizzes();
          },
          error: (err) => {
            console.error('Failed to sync legacy quizzes to backend:', err);
          }
        });
      } else {
        localStorage.removeItem(this.QUIZZES_KEY);
      }
    } catch (e) {
      localStorage.removeItem(this.QUIZZES_KEY);
    }
  }

  /**
   * Get all templates available to a user (defaults + their custom ones)
   */
  getTemplates(userEmail?: string): QuizTemplate[] {
    const base = userEmail 
      ? [...this.defaultTemplates, ...this.customQuizzes()]
      : this.defaultTemplates;
    return [...base, ...this.temporaryCommunityQuizzes()];
  }

  /**
   * Get single template by ID
   */
  getTemplateById(id: string, userEmail?: string): QuizTemplate | null {
    const all = this.getTemplates(userEmail);
    return all.find(q => q.id === id) || null;
  }

  /**
   * Save a new custom quiz via Express API. Returns Observable.
   */
  saveQuiz(name: string, categories: Category[], userEmail: string, id?: string, isPublic: boolean = false, icon: string = '📝'): Observable<any> {
    if (!name.trim()) {
      throw new Error('Bitte gib der Quiz-Vorlage einen Namen.');
    }
    if (categories.length > 10) {
      throw new Error('Ein Quiz darf maximal 10 Kategorien besitzen.');
    }

    // Validate images and audio if present
    categories.forEach((cat) => {
      cat.questions.forEach((q) => {
        if (q.image) {
          if (!q.image.startsWith('data:image/')) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat ein ungültiges Bildformat bei ${q.value} $.`);
          }
          const approximateSize = q.image.length * 0.75;
          if (approximateSize > 6.8 * 1024 * 1024) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat ein zu großes Bild bei ${q.value} $ (max. 5 MB).`);
          }
        }
        if (q.audio) {
          if (!q.audio.startsWith('data:audio/mp3') && !q.audio.startsWith('data:audio/mpeg')) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat ein ungültiges Audioformat bei ${q.value} $. Nur MP3 erlaubt.`);
          }
          const approximateSize = q.audio.length * 0.75;
          if (approximateSize > 10 * 1024 * 1024) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat eine zu große Audiodatei bei ${q.value} $ (max. 10 MB).`);
          }
          if (q.audioPitch !== undefined && (q.audioPitch < -12 || q.audioPitch > 12)) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat einen ungültigen Tonhöhenwert bei ${q.value} $.`);
          }
          if (q.audioStart !== undefined && q.audioEnd !== undefined && q.audioEnd - q.audioStart > 10.1) {
            throw new Error(`Kategorie "${cat.name || 'Unbenannt'}" hat einen zu langen Audio-Ausschnitt bei ${q.value} $ (max. 10 Sekunden).`);
          }
        }
      });
    });

    const body = { name: name.trim(), categories, isPublic, icon };
    const request$ = id 
      ? this.http.put<any>(`/api/quizzes/${id}`, body)
      : this.http.post<any>('/api/quizzes', body);

    return request$.pipe(
      tap(() => {
        this.loadQuizzes();
      })
    );
  }

  getCommunityQuizzes(page: number, limit: number, search: string = '', favoritesOnly: boolean = false): Observable<{ quizzes: any[], total: number, page: number, limit: number, totalPages: number }> {
    const params = {
      page: page.toString(),
      limit: limit.toString(),
      search,
      favoritesOnly: favoritesOnly.toString()
    };
    return this.http.get<any>('/api/community-quizzes', { params });
  }

  /**
   * Fetch the full details of a community quiz and save it temporarily
   */
  loadFullCommunityQuiz(id: string): Observable<QuizTemplate> {
    return this.http.get<QuizTemplate>(`/api/community-quizzes/${id}`).pipe(
      tap((quiz) => {
        this.temporaryCommunityQuizzes.update((quizzes) => {
          if (quizzes.some((q) => q.id === quiz.id)) {
            return quizzes.map((q) => q.id === quiz.id ? quiz : q);
          }
          return [...quizzes, quiz];
        });
      })
    );
  }

  /**
   * Toggle public visibility of a quiz
   */
  toggleQuizPublic(id: string, isPublic: boolean): Observable<any> {
    return this.http.patch<any>(`/api/quizzes/${id}/public`, { isPublic }).pipe(
      tap(() => {
        this.loadQuizzes();
      })
    );
  }

  /**
   * Toggle favorite status of a quiz for the current user
   */
  toggleFavorite(id: string, isFavorite: boolean): Observable<any> {
    const request$ = isFavorite 
      ? this.http.post<any>(`/api/quizzes/${id}/favorite`, {})
      : this.http.delete<any>(`/api/quizzes/${id}/favorite`);
    return request$;
  }

  /**
   * Delete a custom quiz via Express API. Returns Observable.
   */
  deleteQuiz(id: string): Observable<any> {
    return this.http.delete<any>(`/api/quizzes/${id}`).pipe(
      tap(() => {
        this.loadQuizzes();
      })
    );
  }

  /**
   * Check if a quiz template is complete (all fields filled).
   * System templates are always complete.
   */
  isQuizComplete(template: QuizTemplate): boolean {
    // System templates (no userEmail) are always complete
    if (!template.userEmail) {
      return true;
    }
    // If backend provided the flag, use it
    if (template.isComplete !== undefined) {
      return template.isComplete;
    }
    // Fallback: check locally
    if (!template.categories || template.categories.length === 0) return false;
    for (const cat of template.categories) {
      if (!cat.name?.trim()) return false;
      if (!cat.questions || cat.questions.length === 0) return false;
      for (const q of cat.questions) {
        if (!q.text?.trim()) return false;
        if (!q.answer?.trim()) return false;
      }
    }
    return true;
  }
}
