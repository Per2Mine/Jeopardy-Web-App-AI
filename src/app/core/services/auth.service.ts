import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface User {
  username: string;
  email: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);

  // Current logged in user signal
  currentUser = signal<User | null>(null);

  private TOKEN_KEY = 'jeopardy_token';

  constructor() {
    this.restoreSession();
  }

  /**
   * Register a new user
   */
  async register(username: string, email: string, password: string, securityQuestion: string, securityAnswer: string): Promise<void> {
    const formattedEmail = email.toLowerCase().trim();
    const formattedUsername = username.trim();

    if (!formattedUsername) {
      throw new Error('Benutzername darf nicht leer sein.');
    }
    if (!formattedEmail || !formattedEmail.includes('@')) {
      throw new Error('Bitte gib eine gültige E-Mail-Adresse ein.');
    }
    if (!password || password.length < 6) {
      throw new Error('Das Passwort muss mindestens 6 Zeichen lang sein.');
    }
    if (!securityQuestion || !securityQuestion.trim()) {
      throw new Error('Bitte wähle eine Sicherheitsfrage aus.');
    }
    if (!securityAnswer || !securityAnswer.trim()) {
      throw new Error('Bitte beantworte deine Sicherheitsfrage.');
    }

    try {
      const res = await firstValueFrom(
        this.http.post<AuthResponse>('/api/auth/register', {
          username: formattedUsername,
          email: formattedEmail,
          password,
          securityQuestion,
          securityAnswer
        })
      );
      this.handleAuthSuccess(res);
    } catch (err: any) {
      const errorMsg = err.error?.error || 'Registrierung fehlgeschlagen.';
      throw new Error(errorMsg);
    }
  }

  /**
   * Fetch the security question for a given email
   */
  async getSecurityQuestion(email: string): Promise<string> {
    const formattedEmail = email.toLowerCase().trim();
    if (!formattedEmail) {
      throw new Error('Bitte gib deine E-Mail-Adresse ein.');
    }
    try {
      const res = await firstValueFrom(
        this.http.post<{ securityQuestion: string }>('/api/auth/security-question', {
          email: formattedEmail
        })
      );
      return res.securityQuestion;
    } catch (err: any) {
      const errorMsg = err.error?.error || 'Fehler beim Laden der Sicherheitsfrage.';
      throw new Error(errorMsg);
    }
  }

  /**
   * Reset user's password using the security answer
   */
  async resetPassword(email: string, securityAnswer: string, newPassword: string): Promise<void> {
    const formattedEmail = email.toLowerCase().trim();
    const formattedAnswer = securityAnswer.trim();

    if (!formattedEmail || !formattedAnswer || !newPassword) {
      throw new Error('Bitte fülle alle Felder aus.');
    }

    if (newPassword.length < 6) {
      throw new Error('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
    }

    try {
      await firstValueFrom(
        this.http.post<{ message: string }>('/api/auth/reset-password', {
          email: formattedEmail,
          securityAnswer: formattedAnswer,
          newPassword
        })
      );
    } catch (err: any) {
      const errorMsg = err.error?.error || 'Fehler beim Zurücksetzen des Passworts.';
      throw new Error(errorMsg);
    }
  }

  /**
   * Log in user
   */
  async login(email: string, password: string): Promise<void> {
    const formattedEmail = email.toLowerCase().trim();

    if (!formattedEmail || !password) {
      throw new Error('Bitte fülle alle Felder aus.');
    }

    try {
      const res = await firstValueFrom(
        this.http.post<AuthResponse>('/api/auth/login', {
          email: formattedEmail,
          password
        })
      );
      this.handleAuthSuccess(res);
    } catch (err: any) {
      const errorMsg = err.error?.error || 'Ungültige E-Mail-Adresse oder Passwort.';
      throw new Error(errorMsg);
    }
  }

  /**
   * Log out current user
   */
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    this.currentUser.set(null);
  }

  /**
   * Update current user's username
   */
  async updateUsername(newUsername: string): Promise<void> {
    const formattedUsername = newUsername.trim();
    if (!formattedUsername) {
      throw new Error('Benutzername darf nicht leer sein.');
    }

    const currentUser = this.currentUser();
    if (!currentUser) {
      throw new Error('Kein Benutzer angemeldet.');
    }

    try {
      await firstValueFrom(
        this.http.put<{ success: boolean; username: string }>('/api/auth/username', {
          username: formattedUsername
        })
      );
      // Update active user state
      this.currentUser.set({
        ...currentUser,
        username: formattedUsername
      });
    } catch (err: any) {
      const errorMsg = err.error?.error || 'Aktualisierung fehlgeschlagen.';
      throw new Error(errorMsg);
    }
  }

  private async restoreSession() {
    const token = localStorage.getItem(this.TOKEN_KEY);
    if (!token) return;

    try {
      const res = await firstValueFrom(
        this.http.get<{ user: User }>('/api/auth/me')
      );
      this.currentUser.set(res.user);
    } catch (e) {
      // If token expired or invalid, log out
      this.logout();
    }
  }

  private handleAuthSuccess(res: AuthResponse) {
    localStorage.setItem(this.TOKEN_KEY, res.token);
    this.currentUser.set(res.user);
  }
}
