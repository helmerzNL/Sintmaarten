# Sint Maarten – interactieve wijkkaart

Publieke kaart van de wijk waarop huizen groen of rood zijn gemarkeerd, met een beheerscherm
(`/beheer`) dat beveiligd is met een **passkey**.

## Screenshots

Voorbeeld met willekeurige huizen (kaartgegevens © OpenStreetMap-bijdragers).

**Publieke kaart** – met het logo van de vereniging; klik op een huis voor de notitie. Bovenaan staan de knoppen voor de uitleg, de PDF en (op een telefoon) het installeren als app.

![Publieke kaart](docs/screenshots/publiek.png)

**Mobiel** – bovenaan alleen het logo, de titel en de schakelaar voor huisnummers; de acties (uitleg, straten, PDF opslaan) staan onderaan.

![Mobiel](docs/screenshots/mobiel.png)

**Straten** – met het straat-icoon (🛣️) in de menubalk zet je per straat de huizen op de kaart (en in de PDF) aan of uit. Per straat staat hoeveel huizen **groen** en **rood** zijn, en bovenaan het totaal van de zichtbare straten.

![Straten](docs/screenshots/straten-popup.png)

**Uitleg** – de tekst van de vereniging; wordt de eerste keer automatisch getoond.

![Uitleg](docs/screenshots/uitleg.png)

### Beheer (`/beheer`)

**Onboarding** – de eerste keer maak je een passkey aan met de installatiecode.

![Onboarding](docs/screenshots/onboarding.png)

**Inloggen** – alleen met passkey (vingerafdruk, gezicht, pincode of beveiligingssleutel).

![Inloggen](docs/screenshots/beheer-login.png)

**Huis tekenen** – kies een kleur en klik de hoekpunten van het huis; sluit af met het gele beginpunt, dubbelklik of Enter.

![Huis tekenen](docs/screenshots/beheer-tekenen.png)

**Huis bewerken** – selecteer een huis om de kleur, het huisnummer en de notitie aan te passen, of sleep de hoekpunten.

![Beheerscherm](docs/screenshots/beheer.png)

**Instellingen** – het tandwiel (⚙) in de balk schuift het instellingen-menu in beeld, met drie onderdelen:

- *Beveiliging*: passkeys toevoegen/verwijderen en een optioneel wachtwoord (bevestigen met passkey).

  ![Instellingen: beveiliging](docs/screenshots/instellingen-beveiliging.png)

- *Backups*: na elke opslagpoging wordt automatisch een backup gemaakt van de layout en teksten. Je kunt een backup terugzetten of downloaden;
  verwijderen (één of meer tegelijk) moet je bevestigen met je passkey.

  ![Instellingen: backups](docs/screenshots/instellingen-backups.png)

- *Logo & uitleg*: logo uploaden, naam van de app en de uitlegtekst voor de site en de PDF.

  ![Instellingen: logo en uitleg](docs/screenshots/instellingen-logo.png)

**PDF-export** – A4 liggend met legenda en aantallen (pagina 2 bevat een overzicht van de huizen).

![PDF-export](docs/screenshots/pdf.png)

Pagina 2 bevat het logo, de uitleg en het overzicht van de gemarkeerde huizen.

![PDF-toelichting](docs/screenshots/pdf-toelichting.png)

## Bewoners: huis wijzigen
- In de **geïnstalleerde app** (PWA) staat in de menubalk altijd een knop **Huis wijzigen**, plus een knop **Sync** (🔄) waarmee je de huizen direct bijwerkt (de app ververst ook zelf elke 30 seconden).
- In een **gewone browser** staat bovenin een schakelaar **Bewerken** (✏️). Zet je die aan, dan verschijnt de knop *Huis wijzigen* in de menubalk. *PDF opslaan*, *PDF bekijken* en *Installeer app* staan altijd onder het menu **Meer** (⋯), ook in de app. Het balkje met de statuskleuren zweeft op een klein scherm altijd net boven de menubalk. In de app is deze schakelaar verborgen.

![Bewerken en Meer-menu](docs/screenshots/bewerken-meer-mobiel.png)

**Wijzigen plannen** – zet onder *Instellingen → Wijzigingen* de schakelaar *Wijzigen automatisch uitschakelen* aan en kies met de datum-/tijdkiezer wanneer. Tot dat moment kunnen bewoners wijzigen (browser én app); daarna staat het uit. De twee schakelaars eronder worden in die tijd uitgeschakeld en genegeerd; zet je de planning uit, dan gelden ze weer.

**Infovlak** – onder *Instellingen → Logo & uitleg* staat een apart tekstveld voor het infovlak. Dat staat als opvallend groen blok bovenaan de uitleg op de website en legt uit dat bewoners hun eigen huis kunnen wijzigen. Het verdwijnt vanzelf zodra wijzigen door bewoners uit staat (of de geplande datum is verstreken).

![Infovlak in de uitleg](docs/screenshots/info-vlak-mobiel.png)

**Misbruik tegengaan** – onder *Instellingen → Wijzigingen* staat bij elke openstaande wijziging en bij elk aangemeld apparaat een knop **Blokkeren**. Het apparaat verliest zijn koppeling en openstaande wijzigingen, en kan niet meer wijzigen of een huis kiezen. Je kunt er ook het **IP-adres** bij blokkeren (let op: huisgenoten of buren achter dezelfde router delen vaak een IP). Onder *Geblokkeerd* haal je een blokkade weer weg.

**Alleen in de app toestaan** – onder *Instellingen → Wijzigingen* zet je **Alleen in de geïnstalleerde app (niet in de browser)** aan. De schakelaar *Bewerken* verdwijnt dan voor browserbezoekers (ook bij een open pagina, na het verversen), en de server weigert wijzigingen die niet vanuit de app komen. De app meldt zich daarvoor met een kop (`X-App-Mode: standalone`). Dat is een gebruiksbeperking: wie de verzoeken zelf nabootst kan de kop meesturen, maar elke wijziging moet nog steeds door de beheerder worden goedgekeurd.

![Alleen in de app](docs/screenshots/instellingen-alleen-app.png)
- Een bewoner tikt op zijn huis (of kiest zijn adres) en bevestigt dat. Dat apparaat is dan aan **één huis** gekoppeld (cookie, 1 jaar). Daarna wisselt elke tik op dat huis (of een keuze in het venster) de kleur: niet gemarkeerd → groen → rood → niet gemarkeerd. Andere huizen kunnen niet worden gewijzigd.
- De wijziging is **pas zichtbaar voor anderen nadat de beheerder die goedkeurt**. De bewoner ziet het huis in de tussentijd met een gestippelde rand en de melding *Wacht op goedkeuring*; na de beslissing volgt een bericht (goedgekeurd of niet doorgevoerd).
- Er worden alleen een willekeurig apparaat-token (als hash) en het gekozen huis bewaard, geen namen of andere persoonsgegevens.
- De koppeling en het voorstel blijven **bewaard na het afsluiten van de app**: ze staan op de server, met een lokale kopie van het token als reserve (voor als de cookie wordt gewist) en van de laatste status (voor als er geen verbinding is). Het eigen huis blijft ook buiten de wijzigmodus zichtbaar (⏳ zolang de wijziging op goedkeuring wacht, daarna 🏠).
- De app **ververst zichzelf** (elke 30 seconden, en zodra je terugkeert naar de app of weer online bent). Keurt de beheerder een wijziging goed, dan verschijnt die vanzelf op het apparaat, inclusief een melding "Je wijziging is goedgekeurd". Ook de kaart, aantallen en straten van andere bezoekers verversen zo vanzelf.

![Huis kiezen](docs/screenshots/bewoner-kies-huis.png)
![Wacht op goedkeuring](docs/screenshots/bewoner-wacht.png)

**Beheer** – *Instellingen (⚙) → Wijzigingen*: een rode teller bij het tandwiel en in de paginatitel toont het aantal openstaande wijzigingen; hier keur je wijzigingen goed of af (of alles tegelijk),
zet je het wijzigen door bewoners aan/uit, beheer je de gekoppelde apparaten (een verkeerde koppeling verwijderen) en zet je meldingen aan.

![Wijzigingen goedkeuren](docs/screenshots/instellingen-wijzigingen.png)

### Pushmeldingen voor de beheerder
- Zet in *Instellingen → Wijzigingen → Meldingen op dit apparaat* meldingen aan op je eigen telefoon of computer. De server maakt daarvoor zelf de (VAPID-)sleutels en bewaart ze in `data/db.json`.
- Bij een nieuwe wijziging ontvang je een pushmelding (meerdere wijzigingen kort na elkaar worden samengevoegd). Tik je erop, dan opent het beheer bij *Wijzigingen* en kun je goedkeuren of afwijzen; pas dan wordt de wijziging doorgevoerd.
- Vereist **HTTPS**. Op een iPhone/iPad werkt Web Push alleen als je het beheer eerst aan het beginscherm toevoegt (iOS 16.4 of nieuwer) en het daar opent. Een knop *Testmelding* controleert of het werkt.
- Verlopen apparaten worden automatisch opgeruimd. Bewoners kun je tijdelijk uitschakelen met de schakelaar in het beheer.

## Namen van de statussen
Onder *Instellingen (⚙) → Logo & uitleg* kun je de namen **Groen**, **Rood** en **Niet gemarkeerd** aanpassen, bijvoorbeeld naar *Akkoord* en *Nog niet bezocht*. De kleuren blijven groen en rood. De namen gelden overal: legenda, popups, straten-filter, de PDF, het beheer en de pushmelding. Leeg laten = standaardnaam.

## Nieuwe huizen tekenen
Een nieuw getekend huis heeft standaard **geen status** (niet gemarkeerd; kies in het beheer desgewenst een andere status voor nieuwe huizen). Het veld **Straat voor nieuwe huizen** toont de actieve of laatst gebruikte straat: die volgt het huis dat je selecteert, het straat-filter of wat je zelf invult. Nieuwe, nog lege huizen krijgen die straat vooraf ingevuld, zodat je alleen het huisnummer hoeft in te vullen.

## Huisnummers en straten
- In het beheer heeft elk huis een **straat** en een **huisnummer** (aparte velden; het straatveld stelt bestaande straten voor). Met *Filter op straat* toon je alleen de huizen van één straat in de lijst; de rest wordt op de kaart gedimd.
- De schakelaar *Huisnummers op de kaart* toont het nummer midden op elk huis (wit met donkere rand, dus goed leesbaar). Nummers die niet in het huis passen verdwijnen en komen terug bij verder inzoomen.
- In *Kaartweergave instellen* bepaal je of de nummers voor bezoekers **standaard** aan staan; bezoekers kunnen dat zelf wisselen met de schakelaar in de menubalk (de keuze wordt onthouden).
- Op de site kun je met het straat-icoon per straat de huizen verbergen of tonen. De PDF volgt die keuzes (huisnummers en zichtbare straten).
- Oudere gegevens met één veld *huisnummer/naam* worden automatisch omgezet: dat veld wordt het huisnummer.

## Hoe werkt het
- **Kaart**: OpenStreetMap (via Leaflet), geen API-sleutel nodig. Google Maps is bewust niet gebruikt: dat vereist een betaalde sleutel en de voorwaarden staan het overtekenen en exporteren naar PDF niet toe.
- **Publiek (`/`)**: de kaart met gekleurde vlakken over de huizen; klik op een huis voor naam/notitie.
  Knoppen **PDF bekijken** en **PDF downloaden** maken in de browser een A4-liggend PDF van het hele wijkgebied
  (kaart, legenda met aantallen, bronvermelding, en een tweede pagina met overzicht van de gemarkeerde huizen).
- **Logo & uitleg**: in het beheer (*Instellingen* ⚙ → *Logo & uitleg*) upload je het logo (PNG/JPEG/WebP, max 5 MB) en plak je een tekst. Het logo staat in de kop van de site en de PDF;
  de tekst is op de site te lezen (knop *Uitleg*) en staat op pagina 2 van de PDF.
- **App (PWA)**: de site is te installeren op een telefoon of computer en werkt offline (zie hieronder).
- **Beheer (`/beheer`)**:
  1. Zoek je straat (zoekveld) en zoom ver in; stel via *Kaartweergave instellen* het midden, de startzoom en de minimale/maximale zoom in (of neem de huidige weergave over). Bezoekers openen de kaart (ook in de app) met precies die weergave; met *Automatisch* toont de site alle huizen.
  2. Kies *Huis tekenen*, kies groen of rood, klik de hoeken van een huis en sluit af (klik op het gele beginpunt, dubbelklik of Enter).
  3. Pas later de kleur aan (knoppen of **G**/**R**), versleep hoekpunten, geef een huisnummer/notitie, en klik *Opslaan* (Ctrl+S).
- **Onboarding**: de allereerste keer vraagt `/beheer` om de `SETUP_TOKEN` en maakt dan een passkey aan. Daarna kun je
  via *Instellingen* (⚙) → *Beveiliging* extra apparaten toevoegen (doe dat zodat je niet buitengesloten raakt).

> De PDF haalt kaarttegels rechtstreeks bij OpenStreetMap op; houd het gebruik bescheiden
> ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).

## Inloggen met wachtwoord (optioneel)
Standaard kun je alleen met een passkey inloggen. Wil je ook met een wachtwoord kunnen inloggen, stel dat dan in via *Instellingen* (⚙) → *Beveiliging* → *Wachtwoord*
(minimaal 10 tekens). Het instellen, wijzigen of verwijderen moet je **bevestigen met een passkey**. Het wachtwoord wordt alleen als `scrypt`-hash opgeslagen.
Een sessie die met een wachtwoord is gestart kan de kaart en teksten beheren, maar geen passkeys of wachtwoord wijzigen; daarvoor log je in met een passkey.
Mislukte pogingen worden per IP-adres en globaal beperkt.

## Na een update: oude pagina's of scripts
Scripts en stijlen worden per build met `?v=<versie>-<commit>` opgevraagd en de HTML wordt nooit gecachet; zo krijg je nooit een oude `admin.js` bij nieuwe HTML (dat geeft fouten als
*Cannot set properties of null*). Zie je zo'n fout toch na een update, ververs dan hard (Ctrl+Shift+R) of wis de sitegegevens; eventueel staat een proxy/CDN (bijv. Cloudflare) te agressief te cachen.

## Versienummer
Onderin het instellingenmenu (⚙) staat de versie en de commit van de draaiende build, bijvoorbeeld **v0.1.3 (9f2c4e1)**.
Bij elke geslaagde build van de GitHub Action gaat het patchnummer met 1 omhoog (de eerste build is v0.1.0); de build krijgt een git-tag `v0.1.N` en het image wordt
ook onder die tag gepubliceerd (`ghcr.io/helmerznl/sintmaarten:v0.1.3`). Het deel `0.1` komt uit het bestand `VERSION`: pas dat aan voor een nieuwe minor- of major-versie, dan begint de teller opnieuw bij 0.
Lokaal (zonder build) toont de app `dev` met de commit uit git. De workflow heeft schrijfrechten op de repo nodig om de tag te zetten (staat in `docker.yml`).

## Backups
Na **elke opslagpoging** (huizen/layout, teksten, kaartweergave) maakt de server een JSON-backup in `data/backups/` van de layout (huizen + kaartweergave) en de teksten (uitleg, appnaam).
Identieke staten worden niet dubbel bewaard en de nieuwste 200 blijven staan (`MAX_BACKUPS` om dat aan te passen). Het logo valt buiten de backups.
Terugzetten kan in *Instellingen → Backups* (de huidige staat wordt eerst zelf als backup bewaard); verwijderen vraagt een bevestiging met je passkey.

## Naam van de app
Bij *Instellingen* (⚙) → *Logo & uitleg* stel je ook de **naam van de site** in (naast het logo en in de PDF; standaard `SITE_TITLE`) en de **naam van de app** en een korte naam (max. 12 tekens, onder het icoon) in. Die worden gebruikt als de site op een telefoon of computer wordt geïnstalleerd.
Zonder invoer geldt de sitenaam (`SITE_TITLE`). Een al geïnstalleerde app neemt een nieuwe naam pas na een tijdje over.

## Installeren als app en offline gebruik
- **Android/Chrome en desktop**: open de site en kies *Installeer app* (knop in de kop) of het browsermenu → *App installeren*.
- **iPhone/iPad (Safari)**: deel-icoon → *Zet in beginscherm*.
- **Offline**: de app bewaart zichzelf, de laatst bekende kaartgegevens, het logo en de kaarttegels van het wijkgebied (en de PDF-uitsnede).
  Zonder verbinding zie je de laatst bekende stand (met de melding *Offline*), en de PDF blijft te maken. Alleen het beheer vereist altijd een verbinding.
- Dit werkt alleen via **HTTPS** (zie `ORIGIN`). Na een update van de site haalt de app de nieuwe versie bij het eerstvolgende bezoek op.

## Draaien op de NAS
1. Zet `docker-compose.yml` en een `.env` (kopie van `.env.example`) in een map op je NAS.
2. Vul `.env` in: `ORIGIN` (`https://sintmaarten.flux76.app`), optioneel `PORT` (standaard 9888), `SETUP_TOKEN`, `SESSION_SECRET`.
3. `docker compose up -d`. Data (huizen, passkeys, logo en uitleg) staat in `./data`. De container herstelt zelf de rechten op die map
   (hij start kort als root en draait de app daarna als gebruiker `node`).
4. Zet een reverse proxy met **HTTPS** voor de poort uit `PORT` (standaard **9888**) (Synology: *Inloggegevens → Reverse Proxy*, of Nginx Proxy Manager / Traefik).
   Passkeys werken alleen over HTTPS (of op `localhost`), en `ORIGIN` moet exact het adres in de browser zijn.

> Is het GHCR-package privé? Maak het publiek (GitHub → Packages → Package settings), of log op de NAS in met
> `docker login ghcr.io` (gebruikersnaam + Personal Access Token met `read:packages`).

## GitHub Actions
`.github/workflows/docker.yml` draait de tests en bouwt bij elke push naar `main`/`master` een multi-arch image
(amd64 + arm64) naar `ghcr.io/helmerznl/sintmaarten:latest`. Update op de NAS met `docker compose pull && docker compose up -d`.

## Lokaal ontwikkelen
```
npm install
ORIGIN=http://localhost:9888 SETUP_TOKEN=lokaal-test-token-1 npm start
npm test
```

## Beveiliging
Passkeys via WebAuthn (SimpleWebAuthn), sessiecookie `HttpOnly`/`SameSite=Strict`/`Secure`, origin-check op wijzigingen,
beperking op mislukte pogingen.
Back-up: kopieer de map `data/`. Passkey kwijt en geen ander apparaat? Zet in `data/db.json`
`"passkeys": []` en doorloop de onboarding opnieuw.
