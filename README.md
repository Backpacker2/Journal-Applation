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
12. [Wensen en voortgang (GitHub Issues)](#12-wensen-en-voortgang-github-issues)
13. [Op je telefoon (Mac Mini + Tailscale)](#13-op-je-telefoon-mac-mini--tailscale)

---

## 1. Wat de app kan

- **Projecten en chats** in de zijbalk, elk met hun eigen gedachten, documenten en template
- **Gedachten** opslaan met Enter, **reageren** op een eerdere gedachte (zoals in WhatsApp) en gedachten **bewerken**
- **Eigen vragen** stellen en beantwoorden, en **AI-vragen** laten genereren (de AI stelt alleen vragen, nooit antwoorden)
- **Template per project of chat**: bepaalt de kopjes, taal en toon van het document
- **Documenten**: een ruwe versie laten maken over een gekozen periode, bewerken, opslaan als eindversie; bekijken als preview, md of txt en downloaden als `.md`, `.txt` of Word (`.docx`)
- **Werkt ook zonder API-sleutel**: "Kopieer prompt", plakken in Claude, en het resultaat terugzetten met "Plak resultaat"
- **Versleuteling** van alle inhoud én van de namen van je projecten en chats (AES-256-GCM)
- **Meerdere sleutels**: oude sleutels toevoegen, zodat je data van vorige versies leesbaar blijft
- **Automatisch naar GitHub**: elke wijziging wordt binnen een paar seconden geüpload; lukt dat niet, dan probeert de app het later opnieuw
- **Updates via de app**: knop *Nu bijwerken*, de app start zichzelf opnieuw
- Standaard een **donker thema**; onder *Instellingen* kies je uit zes thema's

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
| `anthropicApiKey` | Oude manier om Claude in te stellen; liever via *Instellingen → AI* (daar kan ook ChatGPT, Gemini, Mistral, Ollama) | leeg |
| `model` | Het Claude-model voor de AI-functies | `claude-sonnet-5-5` |
| `autoSync` | Na elke nieuwe of aangepaste gedachte, vraag of document automatisch uploaden naar GitHub | `true` |
| `autoSyncMinutes` | Daarnaast elke zoveel minuten ophalen en uploaden (handig als je ook op je telefoon schrijft); `0` = uit | `10` |

Paden mogen met `~` beginnen. `config.json`, `data/` en alle `.key`-bestanden staan in `.gitignore`, dus ze komen
nooit in de app-repository terecht.

**Tip:** zet alleen de **sleutels** in iCloud, niet de hele `data`-map. iCloud en git werken slecht samen
(iCloud kan bestanden in `.git` halverwege synchroniseren). GitHub is al de back-up van je data.

## 4. Dagelijks gebruik

**Projecten en chats.** Klik op `+` naast *Projecten* of *Chats*. Projecten zijn voor school en werk en krijgen
later extra tabbladen (Kanban, Feedback). Chats zijn voor alles waar je even over wilt nadenken.

**Chats binnen een project.** Boven de gedachten van een project staan de chats: *Algemeen* en de chats die je zelf
maakt met **+ Nieuwe chat** (bijvoorbeeld per onderwerp of user story). Wat je typt, komt in de gekozen chat. Met
*☐ Selecteren → Verplaatsen naar…* zet je bestaande berichten in een andere chat. Bij het genereren van een document
kies je welke chats meedoen (standaard alle); in het document staat bij elke gedachte uit welke chat hij komt.

**Gedachten.** Typ onderaan en druk op **Enter** (Shift+Enter = nieuwe regel). Elke gedachte wordt een apart bestand.
- **Reageer**: koppelt je nieuwe gedachte aan een eerdere; klik op het citaat om terug te springen.
- **Bewerk**: pas een gedachte achteraf aan (git bewaart de oude versie).

**Berichten beheren.** Onder elk bericht staan ook:
- **Naam weghalen**: losse berichten krijgen geen naam meer (alleen chats en projecten). Had een bericht al een naam, dan blijft die staan tot je hem weghaalt.
- **Verwijder**: haalt het bericht weg (in de git-geschiedenis blijft het versleuteld bestaan).
- **☐ Selecteren** (boven het invoerveld): vink meerdere berichten aan en kies **Delen** (via het deelmenu, of gekopieerd naar je klembord) of **Verwijderen**.

**Projecten en chats beheren.** Rechtsboven: **Naam wijzigen** en **Archiveren**. Een gearchiveerde chat of
project blijft gewoon bestaan, maar staat in de zijbalk alleen nog onder **Archief**. Met **Uit archief halen** zet je hem terug.

**Zoeken.** Het zoekveld bovenaan de zijbalk doorzoekt al je gedachten, vragen, antwoorden en documenten
(ook in het archief). Hoofdletters en accenten maken niet uit. Klik op een resultaat om er direct naartoe te gaan.

**Alle documenten.** Onder het zoekveld: één overzicht van alle ruwe versies en eindversies uit al je projecten en
chats, te filteren en direct te downloaden.

**Sprints (projecten).** In het tabblad *Documenten* leg je vaste periodes vast: naam, begin- en einddatum, of met
**+ Volgende sprint** meteen de volgende van dezelfde lengte. Bij het genereren kies je een sprint en worden titel en
datums vanzelf ingevuld. In de tijdlijn zie je waar een sprint begint.

**Kanban (projecten).** Tabblad *Kanban* met de kolommen Backlog, Mee bezig, Waiting for review en Done. Typ een
kaart onderaan een kolom en druk op Enter. Sleep kaarten tussen kolommen, of klik op een kaart om titel, beschrijving en
kolom te wijzigen. Het bord wordt versleuteld opgeslagen (`kanban.txt`).
Met veel kaarten blijft het overzichtelijk: kolommen staan naast elkaar (scroll opzij) en elke kolom scrolt zelf,
zodat de pagina niet lang wordt. **Zoek in kaarten** filtert, **Compact** verbergt de beschrijvingen, en met **‹** klap je
een kolom in (klik erop om hem weer uit te klappen). Met **+ Kolom** voeg je een kolom toe; bij een gekoppeld Trello-bord
wordt dat een lijst in Trello. Heeft een gekoppeld bord geen kolom voor afgeronde kaarten, dan kun je met één klik een
kolom *Done* toevoegen (Jira-kolommen pas je in Jira zelf aan).

**Kanban koppelen met Trello of Jira.** Per project kun je het bord koppelen, bijvoorbeeld het groepsproject aan Jira
en je persoonlijke project aan Trello.
1. Stel eenmalig je account in: *Instellingen → Koppelingen*.
   - **Trello**: maak op [trello.com/apps/admin](https://trello.com/apps/admin) een nieuwe app en kies **Mijn app gebruikt
     geen Power-Up-mogelijkheden** (dan is er geen Iframe-URL nodig). Open het tabblad **Trello Auth** en klik
     **Generate a new API Key**. Gebruik níet de Client-ID van het tabblad OAuth 2.0; die werkt hier niet. Plak de sleutel in
     de app, klik **Token ophalen**, kies *Allow* en plak het token.
   - **Jira**: maak een API-token op [id.atlassian.com → API-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
     (*Create API token*, zonder scopes). Vul de site in (`jouwteam.atlassian.net`), je e-mailadres en het token.
   - Klik **Opslaan en testen**. De gegevens staan versleuteld in `data/koppelingen.txt`.
2. Open in het project het tabblad *Kanban* en kies **Koppelen met Trello** of **Koppelen met Jira**. Kies het bord of
   project. Heb je al kaarten, vink dan aan of die ook naar Trello/Jira moeten; anders blijven ze alleen hier (label *alleen hier*).
3. De kolommen worden die van Trello/Jira. Bij het openen van het tabblad en met **↻ Verversen** haalt de app de laatste
   stand op. Wat je hier toevoegt, wijzigt of verplaatst, gaat meteen terug.
4. **Conflicten.** Is dezelfde titel, beschrijving of kolom hier én daar veranderd, dan overschrijft de app niets. Bovenaan
   verschijnt *Kies welke versie blijft*: **Mijn versie houden** of **Deze versie nemen**.
5. **Jira-regels.** Laat de workflow van je team een stap niet toe (bijvoorbeeld direct van To Do naar Done), dan zegt de
   app dat en blijft de kaart staan waar hij in Jira staat. Issues verwijderen doe je in Jira zelf; een Trello-kaart wordt
   gearchiveerd. Jira-issues die al langer dan 30 dagen klaar zijn, worden niet meer opgehaald.
6. **Ontkoppelen** houdt alle kaarten hier; ze worden alleen niet meer bijgewerkt.

**Alles koppelen aan een kaart (ticket).** Typ in een gedachte `@` met een stukje van de titel of het nummer
(bijvoorbeeld `@22` of `@sensor`): er verschijnt een lijstje met kaarten, en met Enter of een klik koppel je de gedachte
aan die kaart (`@UTC-22`). Feedback koppel je in het feedbackformulier; documenten in een geopend document met
*Koppelen aan kaart…*. Open je een kaart op het Kanbanbord, dan zie je alles wat eraan hangt. Daar kun je ook direct
een **bestand toevoegen** (bijvoorbeeld een testrapport) en **Document over deze kaart** maken: dan gaan alleen de
gekoppelde gedachten, feedback en documenten naar de AI, met de kaart zelf als context. Je gedachten gaan nooit naar
Trello of Jira; de koppeling bestaat alleen in Leerjournaal.

**Feedback (projecten).** Tabblad *Feedback*: leg feedback vast (titel, van wie, datum, de feedback zelf), beantwoord de
vragen die erin stonden, schrijf op wat je ervan leerde en koppel het aan documenten of kaarten. Feedback uit de gekozen
periode gaat mee naar het document; de AI gebruikt de feedback zelf alleen als context, jouw antwoorden en lessen als inhoud.

**Instellingen.** Linksonder *Instellingen*: kies een **thema** (Donker, Licht, Nacht, Sepia, Bos, Oceaan), zet
**functies** aan of uit (Kanban, Feedback, AI-knoppen), stel **automatisch uploaden** en het interval in, kies of
gegenereerde documenten **datums** bevatten (geen, alleen de dag, of dag en tijd; tijden staan er standaard niet in),
stel je Trello- en Jira-accounts in en kies je **AI**. Alles wordt bewaard in `instellingen.json` op je eigen computer (staat in `.gitignore`).

**AI kiezen.** Onder *Instellingen → AI* stel je een of meer AI's in: Claude, ChatGPT, Gemini, Mistral, Ollama (gratis,
draait op je eigen computer) of een andere dienst die werkt zoals de OpenAI API. Je kunt ook meerdere sleutels van
dezelfde aanbieder toevoegen (bijvoorbeeld een van school en een eigen). Kies de aanbieder, plak de sleutel, klik
**Modellen ophalen**, kies een model en klik **Toevoegen en testen**. Met het rondje kies je welke AI actief is; bij
*Genereer ruwe versie* kun je ook per keer een andere kiezen. Een oude `anthropicApiKey` in `config.json` blijft werken
en staat in de lijst als *Claude*.

**Templatebibliotheek.** In het tabblad *Template*: **Opslaan in bibliotheek…** bewaart het template zodat je het in
andere projecten en chats kunt gebruiken. In de bibliotheek kies je **Gebruiken**, en daarna **Opslaan**. Je eigen
templates staan versleuteld in `data/templates/`; de twee standaardtemplates zitten er altijd in.

**Vragen.**
- **+ Eigen vraag toevoegen**: typ een vraag aan jezelf; het antwoord geef je in het kaartje.
- **✦ AI-vragen genereren**: de AI leest je gedachten en stelt drie open vragen. Hij geeft zelf geen antwoorden.

**Template.** In het tabblad *Template* bepaal je hoe het document eruitziet. `{titel}` wordt vervangen door de titel
die je bij het genereren invult. Projecten krijgen standaard een Engels leerverslag, chats een Nederlands persoonlijk
verslag. Met *Standaardtemplate* zet je het origineel terug.

**Documenten.** In het tabblad *Documenten*:
1. Kies een titel en een periode (standaard de laatste twee weken).
2. **Genereer ruwe versie** (met API-sleutel), of **Kopieer prompt** → plak in Claude → **Plak resultaat**.
3. Open het document, klik **Bewerken** en sla op als **eindversie**. Elke keer opslaan maakt een **nieuwe versie**; de
   vorige blijft bestaan. In de lijst klap je *N versies* open, en bovenaan een geopend document zie je alle versies met
   datum en tijd om snel terug te kijken.
4. Bovenaan kies je hoe je het bekijkt: **Preview** (opgemaakt), **md** (de Markdown-tekst) of **txt** (platte tekst).
5. **Download** als `.md`, `.txt` of `.docx` (Word) met de knoppen bovenaan, of direct vanuit de lijst met documenten.
6. **⇪ Document uploaden** zet je eigen bestanden erbij (Word, Markdown, tekst, pdf, afbeeldingen; max. 20 MB per stuk).
   Het origineel wordt versleuteld bewaard in `bijlagen/` en is altijd terug te downloaden. Van Word-, Markdown- en
   tekstbestanden toont de app ook de tekst, zodat je ze kunt lezen, doorzoeken en als nieuwe versie bewerken.

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
3. **Inloggen**: ga naar *Instellingen → GitHub → Beheren* en volg de stappen. Je maakt een fine-grained token dat
   alleen bij je data-repository mag (Contents: Read and write) en plakt het in de app. Kies *No expiration*, dan hoef je
   nooit opnieuw in te loggen. Het token staat in `github.json` op je eigen computer (in `.gitignore`).
   Liever *Inloggen met GitHub* met één klik? Maak eenmalig een OAuth-app met *Device Flow* aan en zet de Client ID
   als `githubClientId` in `config.json` (de stappen staan op de inlogpagina).
4. Klik in de app één keer op **Sync met GitHub**. Daarna gaat alles vanzelf:
   - elke nieuwe of aangepaste gedachte, vraag of document wordt na een paar seconden geüpload;
   - linksonder zie je de status: *wijziging wacht op upload*, *Uploaden…* of *Alles staat op GitHub*;
   - zonder internet blijft alles gewoon lokaal staan; de app probeert het later opnieuw (na 30 s, 1 min, 2 min, … tot 10 min);
   - heb je de repository op GitHub hernoemd, dan neemt de app het nieuwe adres zelf over.

   Liever met de hand? Zet `"autoSync": false` in `config.json` en gebruik de knop.

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
- Bij een gekoppeld Kanbanbord gaan alleen de kaarten (titel, beschrijving, kolom) naar Trello/Jira, nooit je gedachten.
  Je Trello- en Jira-tokens staan versleuteld in `data/koppelingen.txt`.

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
| *GitHub vraagt om in te loggen* | Klik linksonder op de melding en log in met een token (zie hoofdstuk 6) |
| Upload mislukt | Klik linksonder op de status voor de uitleg. Alles staat in `data/.git/leerjournaal-sync.log`. Test in de terminal: `cd data && git push` |
| Update wil niet | Je hebt app-bestanden aangepast: `git status` in de app-map, commit of herstel ze |
| AI-knoppen geven een fout | Kijk onder *Instellingen → AI*: klik **Wijzig** en **Modellen ophalen** om de sleutel te testen. Of gebruik *Kopieer prompt* |
| De app start niet | Staat Node.js erop? `node --version` moet 18 of hoger zijn |
| *Er draait al een Leerjournaal* | Een oude versie draait nog. Sluit dat terminalvenster, of: `lsof -ti tcp:4173 \| xargs kill`. Vanaf versie 0.5.1 neemt een nieuwe versie het zelf over |
| *Poort is bezet door een ander programma* | Zet in `config.json` een andere `port`, bijvoorbeeld `4174` |

## 12. Wensen en voortgang (GitHub Issues)

Alle geplande veranderingen staan als **issues** in [Journal-Applation](https://github.com/Backpacker2/Journal-Applation/issues).

- Elke taak heeft een Goal, Description en Acceptance criteria, en een label per fase.
- **bezig** = Claude werkt eraan. **wacht op keuze** = er is eerst een keuze van jou nodig.
- Is een taak af, dan sluit de commit met de nieuwe code het issue automatisch (`Closes #nummer`), met een reactie over wat er gedaan is.
- **Nieuwe wens?** Klik op *New issue* → *Nieuwe wens of aanpassing* en vul het formulier in. Vraag Claude daarna om de open issues op te pakken.
- Let op: deze repository is **openbaar**. Zet in issues nooit gedachten, sleutels of andere privégegevens.

## 13. Op je telefoon (Mac Mini + Tailscale)

De app draait op je Mac Mini en je opent hem op je iPhone als app op je beginscherm. Tailscale zorgt dat alleen
jouw apparaten erbij kunnen. Je laptop gebruikt voortaan hetzelfde adres, zodat er één plek is die schrijft.

**Wat de app al kan op je telefoon**
- Aangepaste weergave: menu via ☰, groot invoerveld (geschikt voor dicteren), geen inzoomen bij typen.
- Installeerbaar: Safari → Deel → **Zet op beginscherm** geeft een eigen icoon en volledig scherm.
- Offline: ben je even zonder verbinding, dan wordt je gedachte bewaard en verstuurd zodra je weer online bent.
- Snel vastleggen met Siri via een opdracht (Shortcut), zie hieronder.

### Stap 1 – Mac Mini (Ubuntu)

**Snelste manier:** zet op de Mini SSH aan (`sudo apt-get install -y openssh-server`, en noteer `hostname -I`) en
voer dan op je **Mac** in de app-map uit:

```bash
bash tools/mini-installeren.sh gebruiker@ip-van-de-mini
```

Dat script doet alles hieronder in één keer (Node, git, beide repositories, sleutels, GitHub-inlog, `config.json`,
de dienst en desgewenst Tailscale). Wat al op de Mini staat, wordt overgeslagen, dus je kunt het gerust opnieuw
draaien. Log eerst in de app in bij GitHub (*Instellingen → GitHub → Beheren*), want die inlog gaat mee.

**Met de hand:**

```bash
sudo apt-get install -y git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
git clone https://github.com/Backpacker2/Journal-Applation.git ~/Leerjournaal
git clone https://github.com/jouw-naam/Journal-Data.git ~/Leerjournaal/data   # privé: log in met een token of 'gh auth login'
```

Zet je sleutel(s) op de Mini (Ubuntu heeft geen iCloud). Vanaf je Mac:

```bash
ssh mini 'mkdir -p ~/.leerjournaal && chmod 700 ~/.leerjournaal'
scp ~/Library/Mobile\ Documents/com~apple~CloudDocs/Leerjournaal/*.key mini:~/.leerjournaal/
```

Maak op de Mini `~/Leerjournaal/config.json`:

```json
{ "dataDir": "./data", "keyFile": "~/.leerjournaal/secret.key" }
```

En installeer de app als vaste dienst (start vanzelf na een herstart of stroomstoring):

```bash
cd ~/Leerjournaal && bash tools/install-ubuntu.sh
```

### Stap 2 – Tailscale

1. Installeer Tailscale op de Mini (`curl -fsSL https://tailscale.com/install.sh | sh`, dan `sudo tailscale up`) en op je iPhone (App Store), met hetzelfde account.
2. Zet in het Tailscale-beheerscherm **MagicDNS** en **HTTPS Certificates** aan.
3. Op de Mini: `sudo tailscale serve --bg localhost:4173`. Met `tailscale serve status` zie je je adres, bijvoorbeeld `https://mini.tail1234.ts.net`.
4. Optioneel: alleen jouw account toelaten, in `config.json`: `"tailscaleUsers": ["jouw@email"]`.

### Stap 3 – iPhone

1. Open je `https://…ts.net`-adres in Safari.
2. Deel → **Zet op beginscherm**.

### Stap 4 – Snel een gedachte inspreken (Siri)

Maak in de app **Opdrachten** een nieuwe opdracht:

1. **Dicteer tekst**.
2. **Haal inhoud van URL op**: URL `https://…ts.net/api/quick`, methode **POST**, header `x-leerjournaal` = `1`,
   verzoek-body **JSON** met `text` = *Gedicteerde tekst*. Optioneel `chat` = de naam van een chat of project
   (standaard gaat alles naar de chat *Snelle gedachten*, die vanzelf wordt aangemaakt).
3. **Toon melding**: *Opgeslagen*.

Noem de opdracht **Gedachte**; dan werkt *“Hé Siri, gedachte”*.
