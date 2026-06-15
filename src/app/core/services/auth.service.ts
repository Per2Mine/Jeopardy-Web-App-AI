import { Injectable, signal } from '@angular/core';

export interface User {
  username: string;
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Current logged in user signal
  currentUser = signal<User | null>(null);

  private USERS_KEY = 'jeopardy_users';
  private SESSION_KEY = 'jeopardy_session';

  constructor() {
    this.restoreSession();
  }

  /**
   * Register a new user
   */
  async register(username: string, email: string, password: string): Promise<void> {
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

    const users = this.getStoredUsers();
    
    // Check if email already exists
    const emailExists = users.some(u => u.email === formattedEmail);
    if (emailExists) {
      throw new Error('Ein Konto mit dieser E-Mail-Adresse existiert bereits.');
    }

    // Add user
    const newUser = {
      username: formattedUsername,
      email: formattedEmail,
      password: password // In a real app this would be hashed
    };
    users.push(newUser);
    localStorage.setItem(this.USERS_KEY, JSON.stringify(users));

    // Automatically log in
    this.setCurrentSession({ username: formattedUsername, email: formattedEmail });
  }

  /**
   * Log in user
   */
  async login(email: string, password: string): Promise<void> {
    const formattedEmail = email.toLowerCase().trim();

    if (!formattedEmail || !password) {
      throw new Error('Bitte fülle alle Felder aus.');
    }

    const users = this.getStoredUsers();
    const user = users.find(u => u.email === formattedEmail && u.password === password);

    if (!user) {
      throw new Error('Ungültige E-Mail-Adresse oder Passwort.');
    }

    this.setCurrentSession({ username: user.username, email: user.email });
  }

  /**
   * Log out current user
   */
  logout() {
    localStorage.removeItem(this.SESSION_KEY);
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

    const users = this.getStoredUsers();
    const userIndex = users.findIndex(u => u.email === currentUser.email);
    if (userIndex === -1) {
      throw new Error('Benutzer nicht gefunden.');
    }

    // Update username in users database
    users[userIndex].username = formattedUsername;
    localStorage.setItem(this.USERS_KEY, JSON.stringify(users));

    // Update active session
    const updatedUser = { ...currentUser, username: formattedUsername };
    this.setCurrentSession(updatedUser);
  }


  private restoreSession() {
    const sessionStr = localStorage.getItem(this.SESSION_KEY);
    if (sessionStr) {
      try {
        const data = JSON.parse(sessionStr);
        // Gracefully handle both old format (direct User) and new format ({ user, lastActive })
        const user = data.user ? (data.user as User) : (data as User);
        const lastActive = data.lastActive ? (data.lastActive as number) : Date.now();
        
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - lastActive > oneWeekMs) {
          // Session expired after 1 week of inactivity
          this.logout();
        } else {
          // Session valid: restore and refresh activity timestamp
          this.currentUser.set(user);
          this.setCurrentSession(user);
        }
      } catch (e) {
        localStorage.removeItem(this.SESSION_KEY);
      }
    }
  }

  private setCurrentSession(user: User) {
    const sessionData = {
      user,
      lastActive: Date.now()
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
    this.currentUser.set(user);
  }

  private getStoredUsers(): any[] {
    const usersStr = localStorage.getItem(this.USERS_KEY);
    if (usersStr) {
      try {
        return JSON.parse(usersStr) || [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }
}
