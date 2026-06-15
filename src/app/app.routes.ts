import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './core/services/auth.service';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/start-page/start-page.component').then(m => m.StartPageComponent)
  },
  {
    path: 'game',
    loadComponent: () => import('./pages/game-page/game-page.component').then(m => m.GamePageComponent)
  },
  {
    path: 'create-quiz',
    loadComponent: () => import('./pages/quiz-creator/quiz-creator.component').then(m => m.QuizCreatorComponent),
    canActivate: [
      () => {
        const authService = inject(AuthService);
        const router = inject(Router);
        if (authService.currentUser() !== null) {
          return true;
        }
        router.navigate(['']);
        return false;
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
// Route definitions for the Jeopardy Web App


