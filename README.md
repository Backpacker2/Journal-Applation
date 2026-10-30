# Leerjournaal

Leg je gedachten vast per **project** (school, werk) of per **chat** (alles waar je even over wilt nadenken).
Elke gedachte wordt een los, versleuteld `.txt`-bestand met de datum en tijd in de naam. Alles gaat via git naar
een privé GitHub-repository, waar niemand het kan lezen zonder jouw sleutel. Met één klik maak je er een document
van, volgens een template dat je per project of chat zelf instelt.

**Inhoud**

1. [Wat de app kan](#1-wat-de-app-kan)
2. [Installeren](#2-installeren)
3. [Instellingen (config.json)](#3-instellingen-configjson)
4. [Dagelijks gebruik](#4-dagelijks-gebruik)
5. [Sleutels](#5-sleutels)
6. [Je gedachten koppelen aan GitHub](#6-je-gedachten-koppelen-aan-github)
7. [Updaten](#7-updaten)
8. [Hoe de bestanden eruitzien](#8-hoe-de-bestanden-eruitzien)
9. [Veiligheid en privacy](#9-veiligheid-en-privacy)
10. [Commando's](#10-commandos)
11. [Problemen oplossen](#11-problemen-oplossen)

---

## 1. Wat de app kan

- **Projecten en chats** in de zijbalk, elk met hun eigen gedachten, documenten en template
- **Gedachten** opslaan met Enter, **reageren** op een eerdere gedachte (zoals in WhatsApp) en gedachten **bewerken**
- **Eigen vragen** stellen en beantwoorden, en **AI-vragen** laten genereren (de AI stelt alleen vragen, nooit antwoorden)
- **Template per project of chat**: bepaalt de kopjes, taal en toon van het document
- **Documenten**: een ruwe versie laten maken over een gekozen periode, bewerken, opslaan als eindversie, downloaden als `.md`
- **Werkt ook zonder API-sleutel**: "Kopieer prompt", plakken in Claude, en het resultaat terugzetten met "Plak resultaat"
- **Versleuteling** van alle inhoud én van de namen van je projecten en chats (AES-256-GCM)
- **Meerdere sleutels**: oude sleutels toevoegen, zodat je data van vorige versies leesbaar blijft
- **Automatische git-commit** bij elke wijziging en een **Sync-knop** voor GitHub
- **Updates via de app**: knop *Nu bijwerken*, de app start zichzelf opnieuw
- Standaard een **donker thema** (knop *Thema* wisselt naar licht)

## 2. Installeren

Je installeert de app één keer als git-clone. Daarna komen nieuwe functies binnen via de knop **Nu bijwerken**;
je hoeft nooit meer iets opnieuw te koppelen.

1. Installeer Node.js 18 of nieuwer: `brew install node` (of via nodejs.org). Extra pakketten zijn niet nodig.
2. Clone de app-repository naar een vaste plek:
   ```bash
   git clone https://github.com/Backpacker2/Journal-Applation.git ~/Leerjournaal
   cd ~/Leerjournaal
   ```
3. Maak je instellingen: `cp config.example.json config.json` en pas ze aan (zie [hoofdstuk 3](#3-instellingen-configjson)).
4. Start de app: dubbelklik **`start.command`**, of `npm start` in de terminal. De browser opent http://localhost:4173.

> **Eerste start:** staat er nog geen sleutel op de plek van `keyFile`, dan maakt de app een nieuwe.
> **Maak daar meteen een back-up van** (bijvoorbeeld in je wachtwoordmanager). Zonder sleutel zijn je gedachten
> voorgoed onleesbaar. Had je al een vorige versie? Lees dan eerst [hoofdstuk 5](#5-sleutels).

**Heb je de app al in een map staan (bijvoorbeeld uit een zip)?** Koppel die map dan aan de repository,
zonder iets opnieuw te installeren. Je `data/`, `config.json` en sleutels blijven staan:

```bash
cd pad/naar/je/leerjournaal-map
git init -b main
git remote add origin https://github.com/Backpacker2/Journal-Applation.git
git fetch origin
git reset --hard origin/main
git branch -u origin/main
```

**Overstappen van een eerdere versie (zip)?**

1. Kopieer de map `data` uit je oude app-map naar `~/Leerjournaal/data` (of zet `dataDir` in `config.json` op de oude map).
2. Voer `npm run sleutels` uit om je oude sleutel automatisch te vinden ([hoofdstuk 5](#5-sleutels)).

## 3. Instellingen (config.json)

| Instelling | Uitleg | Standaard |
|---|---|---|
| `port` | Poort van de app in je browser | `4173` |
| `dataDir` | Map met je versleutelde gedachten. Wordt automatisch een eigen git-repo | `./data` |
| `keyFile` | Waar je **hoofdsleutel** staat. Het voorbeeld zet hem in iCloud Drive | `./secret.key` |
| `extraKeyFiles` | Paden naar oude sleutels. Elk `.key`-bestand naast je hoofdsleutel wordt ook geladen | `[]` |
| `anthropicApiKey` | Nodig voor de knoppen *AI-vragen* en *Genereer ruwe versie* | leeg |
| `model` | Het Claude-model voor de AI-functies | `claude-sonnet-5-5` |
| `autoSyncMinutes` | `0` = alleen syncen via de knop; bijvoorbeeld `15` = elk kwartier | `0` |

Paden mogen met `~` beginnen. `config.json`, `data/` en alle `.key`-bestanden staan in `.gitignore`, dus ze komen
nooit in de app-repository terecht.

**Tip:** zet alleen de **sleutels** in iCloud, niet de hele `data`-map. iCloud en git werken slecht samen
(iCloud kan bestanden in `.git` halverwege synchroniseren). GitHub is al de back-up van je data.

## 4. Dagelijks gebruik

**Projecten en chats.** Klik op `+` naast *Projecten* of *Chats*. Projecten zijn voor school en werk en krijgen
later extra tabbladen (Kanban, Feedback). Chats zijn voor alles waar je even over wilt nadenken.

**Gedachten.** Typ onderaan en druk op **Enter** (Shift+Enter = nieuwe regel). Elke gedachte wordt een apart bestand.
- **Reageer**: koppelt je nieuwe gedachte aan een eerdere; klik op het citaat om terug te springen.
- **Bewerk**: pas een gedachte achteraf aan (git bewaart de oude versie).

**Vragen.**
- **+ Eigen vraag toevoegen**: typ een vraag aan jezelf; het antwoord geef je in het kaartje.
- **✦ AI-vragen genereren**: de AI leest je gedachten en stelt drie open vragen. Hij geeft zelf geen antwoorden.

**Template.** In het tabblad *Template* bepaal je hoe het document eruitziet. `{titel}` wordt vervangen door de titel
die je bij het genereren invult. Projecten krijgen standaard een Engels leerverslag, chats een Nederlands persoonlijk
verslag. Met *Standaardtemplate* zet je het origineel terug.

**Documenten.** In het tabblad *Documenten*:
1. Kies een titel en een periode (standaard de laatste twee weken).
2. **Genereer ruwe versie** (met API-sleutel), of **Kopieer prompt** → plak in Claude → **Plak resultaat**.
3. Open het document, klik **Bewerken** en sla op als **eindversie**. **Download .md** om het te exporteren.

De AI mag alleen jouw eigen gedachten en antwoorden ordenen en verwoorden. Lees de ruwe versie altijd even na.

## 5. Sleutels

Je data is versleuteld met een **hoofdsleutel**. Alles wat je nu schrijft gaat met die sleutel. Daarnaast kun je
**oude sleutels** toevoegen, zodat je data van vorige versies (of een andere computer) leesbaar blijft.
Elk bestand onthoudt welke sleutel het nodig heeft.

### Oude sleutels automatisch vinden

```bash
npm run sleutels
```

Of dubbelklik **`sleutels-zoeken.command`**. Dit commando:

1. zoekt op je Mac naar `.key`-bestanden (via Spotlight en in Bureaublad, Documenten, Downloads, iCloud Drive en je projectmappen);
2. test elke gevonden sleutel op je data en laat zien op hoeveel bestanden hij past;
3. meldt andere Leerjournaal-datamappen, bijvoorbeeld van een vorige versie;
4. vraagt of je de bruikbare sleutels wilt toevoegen. Ze worden dan als `oud-<id>.key` naast je hoofdsleutel gezet.

| Variant | Wat het doet |
|---|---|
| `npm run sleutels -- --ja` | Toevoegen zonder te vragen |
| `npm run sleutels -- --map ~/Oud/leerjournaal` | Ook in een extra map zoeken |
| `npm run sleutels -- --alles` | Ook sleutels toevoegen die nog op geen enkel bestand passen |

De app pikt toegevoegde sleutels meteen op: ververs de pagina, een herstart is niet nodig.

### Een sleutel met de hand toevoegen

- **In de app:** klik linksonder op **Sleutels**, plak de inhoud van je oude `secret.key` en klik op *Sleutel toevoegen*.
  Kopiëren kan met `pbcopy < pad/naar/oude-map/secret.key`.
- **Als bestand:** zet het sleutelbestand met de extensie `.key` in dezelfde map als je hoofdsleutel.
- **Via de instellingen:** voeg het pad toe aan `extraKeyFiles` in `config.json`.

### Alles omzetten naar je hoofdsleutel

Op de pagina **Sleutels** zet **Alles omzetten naar je hoofdsleutel** alle bestanden met een oude sleutel om. Daarna
heb je in de app alleen je hoofdsleutel nog nodig. **Bewaar de oude sleutel toch**: oudere versies in je
GitHub-geschiedenis zijn er nog mee versleuteld.

### Back-up

- Hoofdsleutel en oude sleutels in **iCloud Drive** (via `keyFile`) én in je **wachtwoordmanager**.
- Zie je in de zijbalk *Vergrendeld · sleutel ontbreekt*? Dan is een bestand versleuteld met een sleutel die
  de app niet heeft. Voer `npm run sleutels` uit of voeg hem toe via **Sleutels**.

## 6. Je gedachten koppelen aan GitHub

Je gedachten gaan naar een **tweede, aparte** repository. Zo staan app-code en data nooit door elkaar.

| Repository | Wat erin staat | Wie wijzigt |
|---|---|---|
| `Backpacker2/Journal-Applation` | de app-code | jij en Claude; updates via de knop |
| `jouw-naam/Journal-Data` (privé) | je versleutelde gedachten en documenten | alleen de app, via *Sync met GitHub* |

1. Maak op GitHub een **privé** repository aan (zonder README). Bij jou is dat `jouw-naam/Journal-Data`.
2. Koppel hem in de terminal:
   ```bash
   cd ~/Leerjournaal/data
   git remote add origin https://github.com/jouw-naam/Journal-Data.git
   ```
3. Klik in de app op **Sync met GitHub**. Wil je automatisch syncen, zet dan `autoSyncMinutes` in `config.json`.

## 7. Updaten

Staat er een nieuwe versie op GitHub, dan zie je linksonder **Update beschikbaar** met een lijstje van wat er
nieuw is. Klik op **Nu bijwerken**: de app haalt de nieuwe code op, start zichzelf opnieuw en laadt de pagina.

- Je gedachten (`data/`), `config.json` en je sleutels staan in `.gitignore`. Een update raakt ze nooit.
- Heb je zelf app-bestanden aangepast, dan wacht de update tot je die hebt gecommit, zodat er niets verloren gaat.
- Liever in de terminal? `git pull` in `~/Leerjournaal` en daarna de app opnieuw starten werkt ook.
- De versie en commit van je app staan linksonder.

## 8. Hoe de bestanden eruitzien

```
~/Leerjournaal/                 app-code (repository Backpacker2/Journal-Applation)
  start.command                 app starten
  sleutels-zoeken.command       oude sleutels zoeken
  config.json                   jouw instellingen (niet in git)
  data/                         je gedachten (aparte repository jouw-naam/Journal-Data)
    projecten/5fe7b71a965b/              willekeurige code, geen naam
      ruimte.txt                         echte naam + template (versleuteld)
      gedachten/2026-10-30_13-02-15.txt  één gedachte of vraag (versleuteld)
      documenten/2026-10-30_14-10-00_ruw.txt
    chats/1d7d20c69902/
      ...

iCloud Drive/Leerjournaal/
  secret.key                    hoofdsleutel
  oud-ac985eea.key              oude sleutel(s)
```

Een versleuteld bestand begint met `LJ2:<sleutel-id>:` gevolgd door onleesbare tekst. Bestanden van versie 0.1 t/m 0.3
beginnen met `LJ1:`; die blijven gewoon werken.

## 9. Veiligheid en privacy

- De server luistert alleen op `127.0.0.1`: andere apparaten in je netwerk kunnen er niet bij.
- Alleen de eigen pagina van de app mag de API gebruiken; andere websites in je browser worden geweigerd.
- Elke gedachte wordt apart versleuteld met AES-256-GCM en een willekeurige IV. Aangepaste bestanden worden herkend.
- **Versleuteld:** de inhoud van alles, en de namen van je projecten en chats (mappen heten een willekeurige code).
- **Niet versleuteld:** of iets een project of chat is, de datum en tijd in bestandsnamen, en hoeveel bestanden er zijn.
- Bij de AI-knoppen gaat de tekst van die ruimte naar de Anthropic API. Met "Kopieer prompt" regel je dat zelf.

## 10. Commando's

| Commando | Wat het doet |
|---|---|
| `npm start` of `start.command` | De app starten (herstart zichzelf na een update) |
| `npm run sleutels` of `sleutels-zoeken.command` | Oude sleutels zoeken, testen en toevoegen |
| `git pull` | Handmatig bijwerken (in de app-map) |

## 11. Problemen oplossen

| Probleem | Oplossing |
|---|---|
| *Vergrendeld · sleutel ontbreekt* in de zijbalk | `npm run sleutels`, of de oude sleutel plakken via **Sleutels** |
| Mijn oude gedachten zijn weg | Ze staan waarschijnlijk in de `data`-map van je vorige versie. `npm run sleutels` laat zien waar |
| *Nog geen GitHub-remote ingesteld* | Volg [hoofdstuk 6](#6-je-gedachten-koppelen-aan-github) |
| Sync mislukt | Controleer of je in de terminal kunt pushen (`cd data && git push`); vaak is het een SSH- of inlogprobleem |
| Update wil niet | Je hebt app-bestanden aangepast: `git status` in de app-map, commit of herstel ze |
| AI-knoppen geven een fout | Zet `anthropicApiKey` in `config.json`, of gebruik *Kopieer prompt* |
| De app start niet | Staat Node.js erop? `node --version` moet 18 of hoger zijn |
| *Er draait al een Leerjournaal* | Een oude versie draait nog. Sluit dat terminalvenster, of: `lsof -ti tcp:4173 \| xargs kill`. Vanaf versie 0.5.1 neemt een nieuwe versie het zelf over |
| *Poort is bezet door een ander programma* | Zet in `config.json` een andere `port`, bijvoorbeeld `4174` |
