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

  // Default system templates
  private defaultTemplates: QuizTemplate[] = [
    {
      id: 'general',
      name: 'Allgemeinwissen Deluxe',
      icon: '🧠',
      categories: [
        {
          name: 'Gaming 🎮',
          questions: [
            { text: 'Dieser italienische Klempner mit roter Mütze ist das Maskottchen von Nintendo.', answer: 'Mario', value: 100 },
            { text: 'In diesem Block-basierten Sandbox-Spiel baut man Welten auf und bekämpft Creeper.', answer: 'Minecraft', value: 200 },
            { text: 'Er ist der grüngewandete Protagonist der berühmten "The Legend of Zelda"-Reihe.', answer: 'Link', value: 300 },
            { text: 'Dieses dystopische Rollenspiel spielt in der futuristischen Megacity namens "Night City".', answer: 'Cyberpunk 2077', value: 400 },
            { text: 'Dieses legendäre Entwicklerstudio schuf die Spielereihen GTA und Red Dead Redemption.', answer: 'Rockstar Games', value: 500 }
          ]
        },
        {
          name: 'Allgemeinwissen 🧠',
          questions: [
            { text: 'Das ist die offizielle Hauptstadt der Bundesrepublik Deutschland.', answer: 'Berlin', value: 100 },
            { text: 'Dieses lebenswichtige chemische Element hat das Elementsymbol "O".', answer: 'Sauerstoff', value: 200 },
            { text: 'Dieser weltberühmte Physiker formulierte im Jahr 1915 die allgemeine Relativitätstheorie.', answer: 'Albert Einstein', value: 300 },
            { text: 'Das ist der flächenmäßig größte und tiefste Ozean auf unserer Erde.', answer: 'Pazifischer Ozean / Pazifik', value: 400 },
            { text: 'In diesem europäischen Land wurde die klassische Pizza Margherita erfunden.', answer: 'Italien', value: 500 }
          ]
        },
        {
          name: 'Popkultur 🍿',
          questions: [
            { text: 'In dieser dreiteiligen Filmreihe reist Marty McFly mit einem DeLorean durch die Zeit.', answer: 'Zurück in die Zukunft', value: 100 },
            { text: 'Diese berühmte gelbe Zeichentrickfamilie lebt in der fiktiven Stadt Springfield.', answer: 'Die Simpsons', value: 200 },
            { text: 'Er beschützt als "Dunkler Ritter" die düstere Metropole Gotham City.', answer: 'Batman / Bruce Wayne', value: 300 },
            { text: 'Dieser berühmte Zauberschüler besucht die Schule für Hexerei und Zauberei namens Hogwarts.', answer: 'Harry Potter', value: 400 },
            { text: 'Dieser Regisseur drehte monumentale Kinofilme wie "Titanic", "Aliens" und "Avatar".', answer: 'James Cameron', value: 500 }
          ]
        },
        {
          name: 'Nerd-Kultur 👾',
          questions: [
            { text: 'Diese Abkürzung steht für die Websprache "Hypertext Markup Language".', answer: 'HTML', value: 100 },
            { text: 'Dieser beliebte Anime/Manga handelt von Piraten und der Suche nach dem Schatz "One Piece".', answer: 'One Piece', value: 200 },
            { text: 'Sie ist die weltweit populärste Programmiersprache für dynamische Web-Frontends.', answer: 'JavaScript / TypeScript', value: 300 },
            { text: 'Dieser Begriff beschreibt alle physischen, greifbaren Komponenten eines Computersystems.', answer: 'Hardware', value: 400 },
            { text: 'In dieser Science-Fiction-Saga kämpfen die Jedi mit Lichtschwertern gegen die Sith.', answer: 'Star Wars', value: 500 }
          ]
        },
        {
          name: 'Sport ⚽',
          questions: [
            { text: 'Dieser Sport wird auf einem Rasenfeld mit einem runden Ball und zwei Toren ausgetragen.', answer: 'Fußball', value: 100 },
            { text: 'In diesem südeuropäischen Land liegen die historischen Wurzeln der Olympischen Spiele.', answer: 'Griechenland', value: 200 },
            { text: 'Dieses weltbekannte Tennisturnier wird alljährlich auf Rasenplätzen in London gespielt.', answer: 'Wimbledon', value: 300 },
            { text: 'Diese Rennserie gilt als die unangefochtene Königsklasse des globalen Motorsports.', answer: 'Formel 1', value: 400 },
            { text: 'Dieser ehemalige US-Basketballer der Chicago Bulls wird weithin als "Air Jordan" verehrt.', answer: 'Michael Jordan', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'gaming',
      name: 'Gaming & Nerd-Kultur',
      icon: '🎮',
      categories: [
        {
          name: 'Retro-Klassiker 🕹️',
          questions: [
            { text: 'In diesem 1980 erschienenen Arcade-Spiel steuert man eine gelbe Kreisscheibe durch ein Labyrinth und frisst Punkte.', answer: 'Pac-Man', value: 100 },
            { text: 'Diese 1989 erschienene Handheld-Konsole von Nintendo machte das Spiel Tetris weltberühmt.', answer: 'Game Boy', value: 200 },
            { text: 'Dieser blaue Igel ist das offizielle Maskottchen von Sega und bekannt für seine extreme Geschwindigkeit.', answer: 'Sonic the Hedgehog', value: 300 },
            { text: 'In diesem wegweisenden 3D-Plattformer von 1996 hüpft ein italienischer Klempner durch Gemälde, um Peach zu retten.', answer: 'Super Mario 64', value: 400 },
            { text: 'Dieser Ego-Shooter von 1993 gilt als Meilenstein des Genres und spielt auf den Monden des Mars.', answer: 'Doom', value: 500 }
          ]
        },
        {
          name: 'Moderne Hits 🎮',
          questions: [
            { text: 'Dieses Battle-Royale-Spiel ist bekannt für seine Bau-Mechaniken und bunten Tänze (Emotes).', answer: 'Fortnite', value: 100 },
            { text: 'In diesem düsteren Action-Rollenspiel von FromSoftware reist man als "Befleckter" durch das Zwischenland.', answer: 'Elden Ring', value: 200 },
            { text: 'Dieses Rollenspiel-Epos dreht sich um den Hexer Geralt von Riva, der seine Ziehtochter Ciri sucht.', answer: 'The Witcher 3: Wild Hunt', value: 300 },
            { text: 'Dieses extrem erfolgreiche Open-World-Spiel von Rockstar Games spielt im fiktiven Bundesstaat San Andreas.', answer: 'GTA V / Grand Theft Auto V', value: 400 },
            { text: 'In diesem Sandbox-Spiel von ReLogic erkundet man eine 2D-Welt, baut Häuser und besiegt Bosse wie das Auge von Cthulhu.', answer: 'Terraria', value: 500 }
          ]
        },
        {
          name: 'Anime & Manga ⛩️',
          questions: [
            { text: 'In dieser Serie versucht der junge Ash Ketchum, der beste Trainer der Welt zu werden.', answer: 'Pokémon', value: 100 },
            { text: 'Dieser blonde Ninja hat den Traum, der nächste Hokage seines Dorfes Konohagakure zu werden.', answer: 'Naruto', value: 200 },
            { text: 'Dieser Manga-Klassiker dreht sich um den Saiyajin Son-Goku und die Suche nach sieben magischen Kugeln.', answer: 'Dragon Ball', value: 300 },
            { text: 'In dieser düsteren Serie besitzt ein Schüler ein Notizbuch, mit dem er Menschen durch das Aufschreiben ihres Namens töten kann.', answer: 'Death Note', value: 400 },
            { text: 'Dieses legendäre Animationsstudio schuf Meisterwerke wie "Chihiros Reise ins Zauberland" und "Mein Nachbar Totoro".', answer: 'Studio Ghibli', value: 500 }
          ]
        },
        {
          name: 'Sci-Fi & Fantasy 🚀',
          questions: [
            { text: 'In dieser weltberühmten Saga kämpfen Rebellen gegen das Imperium und den Todesstern.', answer: 'Star Wars', value: 100 },
            { text: 'Dieser Ring muss im Schicksalsberg vernichtet werden, um den dunklen Herrscher Sauron zu besiegen.', answer: 'Der Herr der Ringe', value: 200 },
            { text: 'In dieser Filmreihe erfährt der Programmierer Neo, dass seine Realität nur eine Computersimulation ist.', answer: 'Matrix', value: 300 },
            { text: 'Dieses Filmuniversum umfasst Superhelden wie Iron Man, Captain America und Thor.', answer: 'Marvel (MCU)', value: 400 },
            { text: 'In dieser Science-Fiction-Serie reist die Crew der Enterprise in Galaxien, die nie ein Mensch zuvor gesehen hat.', answer: 'Star Trek', value: 500 }
          ]
        },
        {
          name: 'Tech-Wissen 💻',
          questions: [
            { text: 'Dieses Zahlensystem besteht nur aus den Ziffern 0 und 1.', answer: 'Binärsystem', value: 100 },
            { text: 'Diese Abkürzung steht für den schnellen, flüchtigen Arbeitsspeicher eines Computers.', answer: 'RAM (Random Access Memory)', value: 200 },
            { text: 'Dieses Open-Source-Betriebssystem wurde 1991 von Linus Torvalds initiiert.', answer: 'Linux', value: 300 },
            { text: 'Diese Tastenkombination wird unter Windows standardmäßig verwendet, um markierten Text zu kopieren.', answer: 'Strg + C', value: 400 },
            { text: 'Diese drahtlose Netzwerktechnologie basiert auf dem Standard IEEE 802.11.', answer: 'WLAN / Wi-Fi', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'music',
      name: 'Musik & Audio-Ratespaß',
      icon: '🎵',
      categories: [
        {
          name: 'Rock-Legenden 🎸',
          questions: [
            { text: 'Diese britische Band sang den weltbekannten Hit "Bohemian Rhapsody" mit Sänger Freddie Mercury.', answer: 'Queen', value: 100 },
            { text: 'Diese australische Hard-Rock-Band ist bekannt für Hymnen wie "Highway to Hell" und "Thunderstruck".', answer: 'AC/DC', value: 200 },
            { text: 'Diese Grunge-Band aus Seattle feierte 1991 mit "Smells Like Teen Spirit" ihren weltweiten Durchbruch.', answer: 'Nirvana', value: 300 },
            { text: 'Diese legendäre britische Band um Mick Jagger hat eine rote Zunge als weltbekanntes Logo.', answer: 'The Rolling Stones', value: 400 },
            { text: 'Dieses bahnbrechende Konzeptalbum von Pink Floyd aus dem Jahr 1973 zeigt ein Prisma auf dem Cover.', answer: 'The Dark Side of the Moon', value: 500 }
          ]
        },
        {
          name: 'Pop-Giganten 🎤',
          questions: [
            { text: 'Er wird als the unangefochtene "King of Pop" bezeichnet und erfand den Moonwalk.', answer: 'Michael Jackson', value: 100 },
            { text: 'Diese US-Sängerin feierte Hits wie "Like a Virgin" und gilt als die erfolgreichste Sängerin aller Zeiten.', answer: 'Madonna', value: 200 },
            { text: 'Diese schwedische Popgruppe gewann 1974 den Eurovision Song Contest mit dem Song "Waterloo".', answer: 'ABBA', value: 300 },
            { text: 'Diese moderne US-Sängerin bricht mit ihrer "Eras Tour" weltweit alle Rekorde.', answer: 'Taylor Swift', value: 400 },
            { text: 'Dieser britische Rotschopf stürmte mit Hits wie "Shape of You" und "Perfect" die Charts.', answer: 'Ed Sheeran', value: 500 }
          ]
        },
        {
          name: 'Film & TV Soundtracks 🎬',
          questions: [
            { text: 'Dieser deutsche Komponist schuf die Soundtracks für Filme wie "Inception", "Gladiator" und "Der König der Löwen".', answer: 'Hans Zimmer', value: 100 },
            { text: 'Dieser US-Komponist schrieb die weltbekannten Musiken für Star Wars, Harry Potter und Indiana Jones.', answer: 'John Williams', value: 200 },
            { text: 'Aus welchem Disney-Film stammt der Oscar-prämierte Song "Let It Go" (Lass jetzt los)?', answer: 'Die Eiskönigin (Frozen)', value: 300 },
            { text: 'Diese britische Sängerin sang das Titellied zum James-Bond-Film "Skyfall".', answer: 'Adele', value: 400 },
            { text: 'In welchem Film tanzen und singen Ryan Gosling und Emma Stone im Lied "City of Stars"?', answer: 'La La Land', value: 500 }
          ]
        },
        {
          name: 'Instrumente 🎺',
          questions: [
            { text: 'Dieses Tasteninstrument hat standardmäßig 88 Tasten, aufgeteilt in weiße und schwarze Tasten.', answer: 'Klavier / Piano', value: 100 },
            { text: 'Wie viele Saiten hat eine klassische Konzertgitarre üblicherweise?', answer: '6', value: 200 },
            { text: 'Dieses Holzblasinstrument wird oft fälschlicherweise für ein Blechblasinstrument gehalten, da es aus Metall besteht.', answer: 'Saxophon', value: 300 },
            { text: 'Dieses Gerät gibt ein gleichmäßiges Tempo durch akustische Signale vor und hilft beim Üben.', answer: 'Metronom', value: 400 },
            { text: 'Aus welchem Material bestehen die Haare eines hochwertigen Geigenbogens traditionell?', answer: 'Rosshaar (Pferdehaar)', value: 500 }
          ]
        },
        {
          name: 'Klassik & Musikwelt 🎼',
          questions: [
            { text: 'Dieser berühmte Salzburger Komponist schrieb die Opern "Die Zauberflöte" und "Don Giovanni".', answer: 'Wolfgang Amadeus Mozart', value: 100 },
            { text: 'Aus welchem Land stammt das berühmte Musikfestival "Eurovision Song Contest" ursprünglich?', answer: 'Schweiz', value: 200 },
            { text: 'Welche Umdrehungszahl pro Minute (rpm) ist der Standard für eine klassische Single-Schallplatte?', answer: '45', value: 300 },
            { text: 'Dieser taube deutsche Komponist schrieb die berühmte "Ode an die Freude" in seiner 9. Sinfonie.', answer: 'Ludwig van Beethoven', value: 400 },
            { text: 'Welcher renommierte US-Musikpreis wird jährlich in Form eines kleinen Grammophons verliehen?', answer: 'Grammy', value: 500 }
          ]
        }
      ]
    }
  ];

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
    if (!userEmail) {
      return this.defaultTemplates;
    }
    return [...this.defaultTemplates, ...this.customQuizzes()];
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
  saveQuiz(name: string, categories: Category[], userEmail: string, id?: string): Observable<any> {
    if (!name.trim()) {
      throw new Error('Bitte gib der Quiz-Vorlage einen Namen.');
    }
    if (categories.length > 10) {
      throw new Error('Ein Quiz darf maximal 10 Kategorien besitzen.');
    }

    // Validate images if present
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
      });
    });

    const body = { name: name.trim(), categories };
    const request$ = id 
      ? this.http.put<any>(`/api/quizzes/${id}`, body)
      : this.http.post<any>('/api/quizzes', body);

    return request$.pipe(
      tap(() => {
        this.loadQuizzes();
      })
    );
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
