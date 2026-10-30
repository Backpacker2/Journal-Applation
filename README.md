# Leerjournaal

Leg je gedachten vast per **project** (school, werk) of per **chat** (alles waar je even over wilt nadenken).
Elke gedachte wordt een los, versleuteld `.txt`-bestand met de datum en tijd in de naam. Alles gaat via git naar
een privé GitHub-repository, waar niemand het kan lezen zonder jouw sleutel. Met één klik maak je er een document
van, volgens een template dat je per project of chat zelf instelt.

## Wat zit erin

- **Projecten en chats** in de zijbalk, elk met hun eigen gedachten, documenten en template
- **Gedachten** opslaan met Enter, **reageren** op een eerdere gedachte (zoals in WhatsApp) en gedachten **bewerken**
- **Eigen vragen** stellen en beantwoorden, en **AI-vragen** laten genereren (de AI stelt alleen vragen)
- **Template per ruimte**: bepaalt de kopjes, taal en toon van het document
- **Document genereren**: ruwe versie via de AI, daarna bewerken en opslaan als eindversie, downloaden als `.md`
- **Zonder API-sleutel**: "Kopieer prompt", plak in Claude, en zet het resultaat terug met "Plak resultaat"
- **AES-256-GCM-versleuteling** van alle inhoud, automatische git-commit bij elke wijziging, Sync-knop voor GitHub
- Standaard **donker thema** (knop "Thema" wisselt naar licht)

## Installeren (Mac)

Je installeert de app één keer als git-clone. Daarna komen alle nieuwe functies binnen via de knop
**Nu bijwerken** in de app; je hoeft nooit meer iets opnieuw te koppelen.

1. Installeer Node.js 18 of nieuwer: `brew install node` (of via nodejs.org).
2. Clone de app-repository naar een vaste plek:
   ```bash
   git clone git@github.com:jouw-naam/Journal-Data.git ~/Leerjournaal
   cd ~/Leerjournaal
   ```
3. Kopieer de instellingen: `cp config.example.json config.json` en pas ze aan (zie hieronder).
4. Start de app: dubbelklik `start.command`, of `npm start` in de terminal. Open http://localhost:4173.

> Bij de eerste start maakt de app een nieuwe sleutel. **Maak daar meteen een back-up van.** Zonder sleutel zijn je
> gedachten voorgoed onleesbaar.

### config.json

| Instelling | Uitleg |
|---|---|
| `dataDir` | Map met je versleutelde gedachten. Wordt automatisch een eigen git-repo. Standaard `./data`. |
| `keyFile` | Waar je sleutel staat. Het voorbeeld zet hem in iCloud Drive, zodat je hem niet kwijtraakt. |
| `anthropicApiKey` | Optioneel. Nodig voor de knoppen "AI-vragen" en "Genereer ruwe versie". |
| `model` | Het Claude-model voor de AI-functies. |
| `autoSyncMinutes` | `0` = alleen syncen via de knop. Bijvoorbeeld `15` = elk kwartier automatisch. |

`config.json` en `secret.key` staan in `.gitignore`, dus ze komen nooit op GitHub.

**Tip:** zet alleen de **sleutel** in iCloud, niet de hele `data`-map. iCloud en git werken slecht samen
(iCloud kan bestanden in `.git` halverwege synchroniseren). GitHub is al de back-up van je data.

## Je gedachten koppelen aan GitHub

Je gedachten gaan naar een **tweede, aparte** repository. Zo staan app-code en data nooit door elkaar.

1. Maak op GitHub een **privé** repository aan, bijvoorbeeld `leerjournaal-data` (zonder README).
2. Koppel hem in de terminal:
   ```bash
   cd ~/Leerjournaal/data
   git remote add origin git@github.com:<jouw-naam>/leerjournaal-data.git
   ```
3. Klik in de app op **Sync met GitHub**.

Op GitHub zie je alleen willekeurige mapcodes en datums, maar de inhoud van elk bestand begint met `LJ1:` gevolgd door onleesbare tekst.

## Hoe de bestanden eruitzien

```
data/
  projecten/5fe7b71a965b/              willekeurige code, geen naam
    ruimte.txt                         echte naam + template (versleuteld)
    gedachten/2026-10-30_13-02-15.txt  één gedachte of vraag (versleuteld)
    documenten/2026-10-30_14-10-00_ruw.txt
  chats/1d7d20c69902/
    ...
```

## Updaten

Staat er een nieuwe versie op GitHub, dan zie je linksonder **Update beschikbaar** met een lijstje van wat er
nieuw is. Klik op **Nu bijwerken**: de app haalt de nieuwe code op, start zichzelf opnieuw en laadt de pagina.

- Je gedachten (`data/`), `config.json` en je sleutel staan in `.gitignore`. Een update raakt ze nooit.
- Heb je zelf app-bestanden aangepast, dan wacht de update tot je die hebt gecommit, zodat er niets verloren gaat.
- Liever in de terminal? `git pull` in `~/Leerjournaal` en daarna de app opnieuw starten werkt ook.

| Repository | Wat erin staat | Wie wijzigt |
|---|---|---|
| `jouw-naam/Journal-Data` | de app-code | jij en Claude; updates via de knop |
| `leerjournaal-data` (privé) | je versleutelde gedachten en documenten | alleen de app, via *Sync met GitHub* |

## Veiligheid

- De server luistert alleen op `127.0.0.1`, dus andere apparaten in je netwerk kunnen er niet bij.
- Elke gedachte wordt apart versleuteld met AES-256-GCM en een willekeurige IV. Aangepaste bestanden worden herkend.
- Namen van projecten en chats staan alleen versleuteld in `ruimte.txt`; de mappen heten een willekeurige code.
- Wat níet versleuteld is: of iets een project of chat is, de datum en tijd in bestandsnamen, en hoeveel bestanden er zijn.
- Bij AI-functies gaat de tekst van die ruimte naar de Anthropic API. Gebruik "Kopieer prompt" als je dat zelf wilt regelen.
