const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db = null;

async function getDatabase() {
  if (db) return db;

  const dbDir = process.env.DATABASE_DIR || __dirname;
  const dbPath = path.join(dbDir, 'database.sqlite');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign key support
  await db.run('PRAGMA foreign_keys = ON');

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      security_question TEXT,
      security_answer_hash TEXT,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      categories TEXT NOT NULL,
      is_complete INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
      user_email TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_email, quiz_id),
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );
  `);

  // Migrations for existing databases
  try {
    await db.run('ALTER TABLE users ADD COLUMN security_question TEXT');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE users ADD COLUMN security_answer_hash TEXT');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE quizzes ADD COLUMN is_complete INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE users ADD COLUMN last_login_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE quizzes ADD COLUMN updated_at DATETIME');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE quizzes ADD COLUMN is_public INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }

  // Seed default AI quizzes for community pool
  try {
    await seedDefaultQuizzes(db);
    console.log('Default AI quizzes successfully verified/seeded.');
  } catch (err) {
    console.error('Error seeding default AI quizzes:', err);
  }

  return db;
}

async function seedDefaultQuizzes(db) {
  const aiEmail = 'ai-assistant@jeopardy.app';
  
  // Ensure AI User exists
  await db.run(`
    INSERT INTO users (email, username, password_hash, security_question, security_answer_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET username=excluded.username
  `, [
    aiEmail,
    'AI-Quizzer 🤖',
    '$2b$10$aiDummyHashPlaceholderNotUsedForLoginAnywayKeepItLong',
    'Lieblings-Zahl?',
    '42'
  ]);

  const quizzes = [
    {
      id: 'ai-quiz-mcu',
      name: 'Marvel Cinematic Universe 🦸‍♂️',
      icon: '🛡️',
      categories: [
        {
          name: 'Superhelden 🦸‍♂️',
          questions: [
            { text: 'Wie lautet der bürgerliche Name des genialen Erfinders und Milliardärs Iron Man?', answer: 'Tony Stark', value: 100 },
            { text: 'Welcher mächtige Gott des Donners trägt den magischen Hammer Mjölnir?', answer: 'Thor (Odinson)', value: 200 },
            { text: 'Welcher Teenager erhält durch den Biss einer radioaktiven Spinne Superkräfte?', answer: 'Peter Parker (Spider-Man)', value: 300 },
            { text: 'Wie heißt die hochintelligente Cousine von Bruce Banner, die ebenfalls Hulk-Kräfte besitzt?', answer: 'Jennifer Walters (She-Hulk)', value: 400 },
            { text: 'Wie lautet der echte Name des Königs von Wakanda und ersten Black Panther im MCU?', answer: 'T\'Challa', value: 500 }
          ]
        },
        {
          name: 'Infinity-Steine 💎',
          questions: [
            { text: 'Welcher violette Titan will alle sechs Steine sammeln, um die Hälfte des Lebens auszulöschen?', answer: 'Thanos', value: 100 },
            { text: 'Welcher Stein befindet sich zunächst in Lokis Zepter und später in Visions Stirn?', answer: 'Gedankenstein (Mind Stone)', value: 200 },
            { text: 'In welchem blauen, würfelförmigen Artefakt ist der Raumstein versteckt?', answer: 'Tesserakt (Tesseract)', value: 300 },
            { text: 'Auf welchem düsteren Planeten bewacht Red Skull den Seelenstein?', answer: 'Vormir', value: 400 },
            { text: 'Welcher Stein wird von Doctor Strange im Auge von Agamotto beschützt?', answer: 'Zeitstein (Time Stone)', value: 500 }
          ]
        },
        {
          name: 'Zitate & Momente 💬',
          questions: [
            { text: 'Welchen emotionalen Satz sagt Tony Stark zu seiner Tochter Morgan, den sie später erwidert?', answer: 'Ich liebe dich mal 3000 / Ich liebe dich 3000', value: 100 },
            { text: 'Welchen Kampfruf nutzt Captain America, um das gesamte Team zum Gefecht aufzurufen?', answer: 'Avengers sammeln! / Avengers Assemble!', value: 200 },
            { text: '„Ich bin ___“ ist der einzige Satz, den dieses baumartige Guardians-Mitglied sprechen kann.', answer: 'Groot', value: 300 },
            { text: 'Welcher Held opfert sich am Ende von Avengers: Endgame, um Thanos\' Armee wegzuschnippen?', answer: 'Iron Man / Tony Stark', value: 400 },
            { text: 'Welcher Heimatplanet von Thor wird im Film „Tag der Entscheidung“ durch Surtur vernichtet?', answer: 'Asgard', value: 500 }
          ]
        },
        {
          name: 'Schurken & Feinde 😈',
          questions: [
            { text: 'Thors Adoptivbruder und Gott des Schabernacks führt die Chitauri-Invasion in New York an.', answer: 'Loki', value: 100 },
            { text: 'Welche mörderische künstliche Intelligenz will die Menschheit durch einen Meteoriteneinschlag ausrotten?', answer: 'Ultron', value: 200 },
            { text: 'Welcher Spezialeffekt-Künstler und Trickbetrüger kämpft in London gegen Spider-Man?', answer: 'Mysterio (Quentin Beck)', value: 300 },
            { text: 'Wie heißt die skrupellose Göttin des Todes und ältere Schwester von Thor?', answer: 'Hela', value: 400 },
            { text: 'Wie heißt der unsterbliche Vater von Shang-Chi, der die legendären Zehn Ringe besitzt?', answer: 'Wenwu (Der Mandarin)', value: 500 }
          ]
        },
        {
          name: 'Technik & Orte 🚀',
          questions: [
            { text: 'Aus welchem technologisch hochentwickelten afrikanischen Land stammt das Metall Vibranium?', answer: 'Wakanda', value: 100 },
            { text: 'Wie heißt das imposante S.H.I.E.L.D.-Hauptquartier in Washington D.C., das von Hydra unterwandert wurde?', answer: 'Triskelion', value: 200 },
            { text: 'In welchem winzigen Reich herrschen eigene Gesetze der Zeit, was Zeitreisen ermöglicht?', answer: 'Quantenreich (Quantum Realm)', value: 300 },
            { text: 'Welches Sprachassistenten-System steuerte Starks Rüstungen, bevor es in Vision hochgeladen wurde?', answer: 'J.A.R.V.I.S.', value: 400 },
            { text: 'In welchem Küstenort in Norwegen gründen die asgardischen Flüchtlinge ihre neue Heimat?', answer: 'New Asgard (Tønsberg)', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'ai-quiz-hdr',
      name: 'Der Herr der Ringe 💍',
      icon: '🧙‍♂️',
      categories: [
        {
          name: 'Gefährten & Helden 🧙‍♂️',
          questions: [
            { text: 'Dieser alte Zauberer führt die Gefährten an, bevor er in den Minen von Moria stürzt.', answer: 'Gandalf (der Graue)', value: 100 },
            { text: 'Dieser mutige Waldläufer aus dem Norden wird am Ende zum König von Gondor gekrönt.', answer: 'Aragorn (Elessar)', value: 200 },
            { text: 'Dieser treue Zwerg streitet sich ständig scherzhaft mit dem Elben Legolas.', answer: 'Gimli', value: 300 },
            { text: 'Dieser tragische Sohn des Truchsesses von Gondor stirbt beim Schutz der Hobbits Merry und Pippin.', answer: 'Boromir', value: 400 },
            { text: 'So lautet der wahre Geburtsname des geschöpfes Gollum, bevor er den Ring fand.', answer: 'Smeagol', value: 500 }
          ]
        },
        {
          name: 'Geografie 🗺️',
          questions: [
            { text: 'In diesem idyllischen und friedlichen Land leben die Hobbits wie Frodo und Bilbo.', answer: 'Das Auenland', value: 100 },
            { text: 'In dieses düstere Land im Osten muss der Eine Ring gebracht werden, um ihn zu vernichten.', answer: 'Mordor', value: 200 },
            { text: 'So heißt die Zuflucht der Elben, die von Lord Elrond beherrscht wird.', answer: 'Bruchtal (Rivendell)', value: 300 },
            { text: 'Dieses goldene Waldkönigreich wird von Galadriel und Celeborn regiert.', answer: 'Lothlorien', value: 400 },
            { text: 'Dieses riesige, uralte Zwergenkönigreich in den Nebelbergen liegt in Trümmern und Dunkelheit.', answer: 'Moria (Khazad-dum)', value: 500 }
          ]
        },
        {
          name: 'Artefakte & Waffen 💍',
          questions: [
            { text: 'So viele Ringe erhielten die sterblichen Menschen, die später zu Nazgul wurden.', answer: 'Neun (9)', value: 100 },
            { text: 'Dieses elbische Schwert leuchtet blau, wenn Orks in der Nähe sind.', answer: 'Stich (Sting)', value: 200 },
            { text: 'Aus diesem extrem widerstandsfähigen und wertvollen Silbermetall besteht Frodos Kettenhemd.', answer: 'Mithril', value: 300 },
            { text: 'So heißen die sehenden Steine, mit denen Sauron und Saruman kommunizieren.', answer: 'Palantiri / Palantir', value: 400 },
            { text: 'Dieses legendäre Schwert von Elendil wurde in Bruchtal neu geschmiedet und heißt nun Anduril.', answer: 'Narsil', value: 500 }
          ]
        },
        {
          name: 'Kreaturen 🐉',
          questions: [
            { text: 'Diese riesigen, elefantenähnlichen Kriegskreaturen werden in der Schlacht eingesetzt.', answer: 'Mumakil (Olifanten)', value: 100 },
            { text: 'Dieses uralte Monster aus Feuer und Schatten haust tief in den Minen von Moria.', answer: 'Der Balrog', value: 200 },
            { text: 'Diese gigantische Spinne belauert den Pass von Cirith Ungol.', answer: 'Kankra (Shelob)', value: 300 },
            { text: 'Diese baumähnlichen Hirten des Waldes beschützen die Bäume und belagern Isengart.', answer: 'Ents', value: 400 },
            { text: 'Aus welchen gezüchteten Super-Orks besteht Sarumans verheerende Angriffsarmee?', answer: 'Uruk-hai', value: 500 }
          ]
        },
        {
          name: 'Zitate & Events 📜',
          questions: [
            { text: 'Welches Wort muss Gandalf sprechen, um das Westtor von Moria zu öffnen?', answer: 'Mellon (Freund)', value: 100 },
            { text: 'Was ruft Gandalf dem Balrog auf der Brücke von Khazad-dum laut entgegen?', answer: 'Du kannst nicht vorbei! / Ihr könnt nicht vorbei!', value: 200 },
            { text: 'In welcher Festung verschanzen sich die Rohirrim während der großen Schlacht im zweiten Teil?', answer: 'Helms Klamm', value: 300 },
            { text: 'Vor welcher großen, weißen Stadt Gondors findet die Schlacht auf den Pelennor-Feldern statt?', answer: 'Minas Tirith', value: 400 },
            { text: 'In welchem Zeitalter von Mittelerde spielt die Handlung des Herrn der Ringe?', answer: 'Drittes Zeitalter', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'ai-quiz-sw',
      name: 'Star Wars Universum 🌌',
      icon: '🚀',
      categories: [
        {
          name: 'Jedi & Sith ⚔️',
          questions: [
            { text: 'Dieser grüne, winzige Großmeister leitet seit Jahrhunderten den Jedi-Orden.', answer: 'Yoda', value: 100 },
            { text: 'So lautet der Geburtsname des gefallenen Jedi-Ritters, der zu Darth Vader wurde.', answer: 'Anakin Skywalker', value: 200 },
            { text: 'Dieser rothäutige Sith-Schüler von Darth Sidious kämpft mit einer Doppelklinge.', answer: 'Darth Maul', value: 300 },
            { text: 'Welcher legendäre Jedi-Meister war der Mentor von Anakin und Luke Skywalker?', answer: 'Obi-Wan Kenobi', value: 400 },
            { text: 'Diese Jedi-Regel besagt, dass es immer nur zwei aktive Sith geben darf (Meister und Schüler).', answer: 'Regel der Zwei (Rule of Two)', value: 500 }
          ]
        },
        {
          name: 'Planeten 🌌',
          questions: [
            { text: 'Dieser Wüstenplanet ist die Heimat von Anakin und Luke Skywalker.', answer: 'Tatooine', value: 100 },
            { text: 'Dieser frostige Eisplanet beherbergt die Echo-Basis der Rebellen in Episode V.', answer: 'Hoth', value: 200 },
            { text: 'Dieser gigantische Stadt-Planet dient als politisches Zentrum der Galaxis.', answer: 'Coruscant', value: 300 },
            { text: 'Auf diesem bewaldeten Mond leben die pelzigen Ewoks, die den Rebellen helfen.', answer: 'Endor', value: 400 },
            { text: 'Dieser friedliche Planet, Heimat von Prinzessin Leia, wird vom Todesstern vernichtet.', answer: 'Alderaan', value: 500 }
          ]
        },
        {
          name: 'Raumschiffe & Technik 🚀',
          questions: [
            { text: 'Dieses legendäre, modifizierte Frachtschiff wird von Han Solo und Chewbacca geflogen.', answer: 'Millennium Falke (Millennium Falcon)', value: 100 },
            { text: 'So heißen die wendigen, kreuzförmigen Sternenjäger der Rebellen-Allianz.', answer: 'X-Wing', value: 200 },
            { text: 'Diese mondgroße Kampfstation des Imperiums kann ganze Planeten sprengen.', answer: 'Todesstern (Death Star)', value: 300 },
            { text: 'Dieses imperiale Schiff dient als riesiges, keilförmiges Schlachtschiff der Flotte.', answer: 'Sternenzerstörer (Star Destroyer)', value: 400 },
            { text: 'Dieser berühmte Kessel-Flugrekord von Han Solo wird in Parsecs gemessen.', answer: 'Kessel-Run in weniger als 12 Parsecs', value: 500 }
          ]
        },
        {
          name: 'Droiden & Aliens 🤖',
          questions: [
            { text: 'Dieser zylinderförmige, blau-weiße Astromech-Droide ist ein treuer Begleiter.', answer: 'R2-D2', value: 100 },
            { text: 'Dieser goldene, protokollarische Droide spricht über 6 Millionen Kommunikationsformen.', answer: 'C-3PO', value: 200 },
            { text: 'Zu welcher pelzigen Alien-Spezies gehört Chewbacca?', answer: 'Wookiee', value: 300 },
            { text: 'Dieses kleine, grüne Kind derselben Spezies wie Yoda wird liebevoll Baby Yoda genannt.', answer: 'Grogu', value: 400 },
            { text: 'Welche rücksichtslosen, echsenartigen Kopfgeldjäger jagen für das Imperium (wie Bossk)?', answer: 'Trandoshaner', value: 500 }
          ]
        },
        {
          name: 'Zitate & Lore 📜',
          questions: [
            { text: 'Welchen berühmten Wunsch geben sich die Jedi gegenseitig mit auf den Weg?', answer: 'Möge die Macht mit dir sein!', value: 100 },
            { text: 'In welcher berüchtigten Kantina auf Tatooine treffen Luke und Obi-Wan auf Han Solo?', answer: 'Mos Eisley Cantina', value: 200 },
            { text: 'Welches schockierende Geheimnis offenbart Darth Vader Luke Skywalker in Episode V?', answer: 'Dass er sein Vater ist ("Ich bin dein Vater")', value: 300 },
            { text: 'Wer schoss in der originalen Kinofassung zuerst: Han Solo oder Greedo?', answer: 'Han Solo (Han shot first)', value: 400 },
            { text: 'Wie heißen die mikroskopischen Organismen im Blut, die die Macht-Sensitivität bestimmen?', answer: 'Midi-Chlorianer', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'ai-quiz-gaming',
      name: 'Reines Gaming Quiz 🕹️',
      icon: '🎮',
      categories: [
        {
          name: 'Klassiker 🕹️',
          questions: [
            { text: 'In diesem Spiel stapelt man fallende Blöcke zu perfekten Linien.', answer: 'Tetris', value: 100 },
            { text: 'Dieses gelbe, kreisförmige Wesen frisst Punkte in einem Labyrinth und flieht vor Geistern.', answer: 'Pac-Man', value: 200 },
            { text: 'Dieses Spiel von 1993 gilt als Urvater der modernen Ego-Shooter.', answer: 'Doom', value: 300 },
            { text: 'In dieser Lebenssimulation baut man Häuser, steuert virtuelle Menschen und löscht manchmal die Pool-Leiter.', answer: 'Die Sims', value: 400 },
            { text: 'Diese bahnbrechende 3D-Konsole von Nintendo erschien 1996 in Europa.', answer: 'Nintendo 64 (N64)', value: 500 }
          ]
        },
        {
          name: 'Welten & Universen 🌎',
          questions: [
            { text: 'Diese dystopische Megacity ist der Hauptschauplatz von Cyberpunk 2077.', answer: 'Night City', value: 100 },
            { text: 'In diesem postapokalyptischen Ödland sucht man in Tresoren namens Vaults Schutz.', answer: 'Fallout', value: 200 },
            { text: 'Dieses Fantasy-Königreich ist der Schauplatz fast aller Hauptspiele der Zelda-Reihe.', answer: 'Hyrule', value: 300 },
            { text: 'In welchem MMORPG bereist man die riesige Fantasy-Welt von Azeroth?', answer: 'World of Warcraft (WoW)', value: 400 },
            { text: 'Diese geheimnisvollen, ringförmigen Welten namens Halos werden in einer Shooter-Reihe erforscht.', answer: 'Halo', value: 500 }
          ]
        },
        {
          name: 'Helden & Schurken 🦸',
          questions: [
            { text: 'Dieser rote Mützen tragende Klempner ist das weltberühmte Maskottchen von Nintendo.', answer: 'Mario', value: 100 },
            { text: 'Diese Archäologin und Grabräuberin ist die Heldin der Tomb Raider-Reihe.', answer: 'Lara Croft', value: 200 },
            { text: 'Er ist der grüngewandete Held, der Prinzessin Zelda retten muss.', answer: 'Link', value: 300 },
            { text: 'Dieser grimmige Hexer mit weißen Haaren jagt Monster in "The Witcher".', answer: 'Geralt von Riva', value: 400 },
            { text: 'Dieser wütende Kriegsgott kämpft mit Chaosklingen gegen den Olymp und Asgard.', answer: 'Kratos', value: 500 }
          ]
        },
        {
          name: 'Entwickler 🏢',
          questions: [
            { text: 'Dieses legendäre Studio erschuf die Blockbuster-Reihen GTA und Red Dead Redemption.', answer: 'Rockstar Games', value: 100 },
            { text: 'Dieses PC-Vertriebsplattform-Betreiber schuf Half-Life und Steam.', answer: 'Valve', value: 200 },
            { text: 'Dieses französische Studio ist bekannt für Assassin’s Creed und Far Cry.', answer: 'Ubisoft', value: 300 },
            { text: 'Aus welchem polnischen Studio stammt das Rollenspiel The Witcher 3?', answer: 'CD Projekt Red', value: 400 },
            { text: 'Dieser japanische Kult-Entwickler erschuf Dark Souls und Elden Ring.', answer: 'FromSoftware', value: 500 }
          ]
        },
        {
          name: 'Zitate & Trivia 💬',
          questions: [
            { text: 'Welcher Satz aus Skyrim über ein bestimmtes Körperteil wurde zum weltweiten Meme?', answer: 'Abenteurer, bis ich einen Pfeil ins Knie bekam', value: 100 },
            { text: 'Aus welchem Spiel stammt das Zitat „Die Torte ist eine Lüge“ (The cake is a lie)?', answer: 'Portal', value: 200 },
            { text: 'Wie heißt die wertvolle Währung in den Animal Crossing-Spielen?', answer: 'Sternis', value: 300 },
            { text: 'Welcher berühmte Counter-Strike-Modus befasst sich mit Geiselbefreiungen (Präfix)?', answer: 'cs_ (z.B. cs_office)', value: 400 },
            { text: 'In welchem Jahr erschien die allererste Sony PlayStation in Japan?', answer: '1994', value: 500 }
          ]
        }
      ]
    },
    {
      id: 'ai-quiz-movies',
      name: 'Reines Film Quiz 🎬',
      icon: '🎥',
      categories: [
        {
          name: 'Klassiker 🎞️',
          questions: [
            { text: 'In dieser dreiteiligen Reihe reist Marty McFly mit einem DeLorean durch die Zeit.', answer: 'Zurück in die Zukunft', value: 100 },
            { text: 'Dieser Pate-Schauspieler prägte als Don Vito Corleone die Kinogeschichte.', answer: 'Marlon Brando', value: 200 },
            { text: 'In welchem Thriller von 1999 darf man nicht über den „Club“ sprechen?', answer: 'Fight Club', value: 300 },
            { text: 'Welcher berühmte Gefängnis-Film mit Tim Robbins gilt auf IMDb als der bestbewertete Film aller Zeiten?', answer: 'Die Verurteilten (The Shawshank Redemption)', value: 400 },
            { text: 'In diesem legendären Film von Orson Welles dreht sich alles um das letzte Wort „Rosebud“.', answer: 'Citizen Kane', value: 500 }
          ]
        },
        {
          name: 'Regisseure 🎬',
          questions: [
            { text: 'Dieser Regisseur drehte Titanic, Aliens und die Avatar-Filme.', answer: 'James Cameron', value: 100 },
            { text: 'Er inszenierte düstere Meisterwerke wie Inception, Interstellar und The Dark Knight.', answer: 'Christopher Nolan', value: 200 },
            { text: 'Dieser Kult-Regisseur drehte Pulp Fiction, Kill Bill und Ingourious Basterds.', answer: 'Quentin Tarantino', value: 300 },
            { text: 'Dieser Regisseur gilt als „Master of Suspense“ und schuf den Klassiker Psycho.', answer: 'Alfred Hitchcock', value: 400 },
            { text: 'Welcher Regisseur schuf Blockbuster wie Jurassic Park, E.T. und Schindlers Liste?', answer: 'Steven Spielberg', value: 500 }
          ]
        },
        {
          name: 'Berühmte Zitate 🗣️',
          questions: [
            { text: 'Aus welchem Boxer-Film stammt der emotionale Schrei „Adrian!“?', answer: 'Rocky', value: 100 },
            { text: '„Ich seh dir in die Augen, Kleines“ ist ein weltberühmtes Zitat aus welchem Filmklassiker?', answer: 'Casablanca', value: 200 },
            { text: '„Ich werde ihm ein Angebot machen, das er nicht ablehnen kann“ stammt aus welchem Meisterwerk?', answer: 'Der Pate (The Godfather)', value: 300 },
            { text: 'Aus welchem Horror-Klassiker stammt das Zitat „Hier ist Jack!“ (Here’s Johnny!)?', answer: 'The Shining', value: 400 },
            { text: '„Das Leben ist wie eine Schachtel Pralinen“ ist das Lebensmotto von welchem Filmhelden?', answer: 'Forrest Gump', value: 500 }
          ]
        },
        {
          name: 'Soundtracks 🎵',
          questions: [
            { text: 'Dieser Komponist schuf die Soundtracks für Star Wars, Harry Potter und Indiana Jones.', answer: 'John Williams', value: 100 },
            { text: 'Dieser deutsche Starkomponist untermalte Fluch der Karibik, Gladiator und Inception.', answer: 'Hans Zimmer', value: 200 },
            { text: 'Die epische Musik zur „Der Herr der Ringe“-Trilogie stammt aus der Feder welches Komponisten?', answer: 'Howard Shore', value: 300 },
            { text: 'In welchem Tanz- und Musikfilm singt Gene Kelly im Regen?', answer: 'Singin’ in the Rain', value: 400 },
            { text: 'Dieser italienische Komponist schuf das weltberühmte Mundharmonika-Thema aus „Spiel mir das Lied vom Tod“.', answer: 'Ennio Morricone', value: 500 }
          ]
        },
        {
          name: 'Blockbuster 🍿',
          questions: [
            { text: 'Welches Filmuniversum enthält Iron Man, Captain America und die Avengers?', answer: 'Marvel Cinematic Universe (MCU)', value: 100 },
            { text: 'Welcher Film von 2009 hielt jahrelang den Rekord als finanziell erfolgreichster Film weltweit?', answer: 'Avatar', value: 200 },
            { text: 'Dieses Agenten-Franchise dreht sich um den Geheimagenten 007 des MI6.', answer: 'James Bond', value: 300 },
            { text: 'In dieser Action-Reihe vollführt Keanu Reeves spektakuläre Schießereien wegen seines Hundes.', answer: 'John Wick', value: 400 },
            { text: 'Welcher Film über ein historisches britisches Luxusschiff gewann im Jahr 1998 sagenhafte 11 Oscars?', answer: 'Titanic', value: 500 }
          ]
        }
      ]
    }
  ];

  for (const q of quizzes) {
    const categoriesJson = JSON.stringify(q.categories);
    await db.run(`
      INSERT INTO quizzes (id, name, user_email, categories, is_complete, is_public)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        name=excluded.name, 
        categories=excluded.categories, 
        is_complete=excluded.is_complete, 
        is_public=excluded.is_public
    `, [q.id, q.name, aiEmail, categoriesJson, 1, 1]);
  }
}

module.exports = { getDatabase };
