# Sint Maarten – interactieve wijkkaart

Publieke kaart van de wijk waarop huizen groen of rood zijn gemarkeerd, met een beheerscherm
(`/beheer`) dat beveiligd is met een **passkey**.

## Hoe werkt het
- **Publiek (`/`)**: de kaart met gekleurde vlakken over de huizen. Zoomen/slepen (muis, touch, pinch); klik op een huis voor naam/notitie.
- **Beheer (`/beheer`)**:
  1. Upload de kaart (PNG/JPEG/WebP).
  2. Kies *Huis tekenen*, kies groen of rood, klik de hoeken van een huis en sluit af (klik op het gele beginpunt, dubbelklik of Enter).
  3. Pas later de kleur aan (knoppen of **G**/**R**), versleep hoekpunten, geef een huisnummer/notitie, en klik *Opslaan* (Ctrl+S).
- **Onboarding**: de allereerste keer vraagt `/beheer` om de `SETUP_TOKEN` en maakt dan een passkey aan. Daarna kun je
  via *Passkeys* extra apparaten toevoegen (doe dat zodat je niet buitengesloten raakt).

## Draaien op de NAS
1. Zet `docker-compose.yml` en een `.env` (kopie van `.env.example`) in een map op je NAS.
2. Vul `.env` in: `ORIGIN` (je https-adres), `SETUP_TOKEN`, `SESSION_SECRET`.
3. `docker compose up -d`. Data (kaart + huizen + passkeys) staat in `./data`.
4. Zet een reverse proxy met **HTTPS** voor poort 3000 (Synology: *Inloggegevens → Reverse Proxy*, of Nginx Proxy Manager / Traefik).
   Passkeys werken alleen over HTTPS (of op `localhost`), en `ORIGIN` moet exact het adres in de browser zijn.

> Is het GHCR-package privé? Maak het publiek (GitHub → Packages → Package settings), of log op de NAS in met
> `docker login ghcr.io` (gebruikersnaam + Personal Access Token met `read:packages`).

## GitHub Actions
`.github/workflows/docker.yml` draait de tests en bouwt bij elke push naar `main`/`master` een multi-arch image
(amd64 + arm64) naar `ghcr.io/helmerznl/sintmaarten:latest`. Update op de NAS met `docker compose pull && docker compose up -d`.

## Lokaal ontwikkelen
```
npm install
ORIGIN=http://localhost:3000 SETUP_TOKEN=lokaal-test-token-1 npm start
npm test
```

## Beveiliging
Passkeys via WebAuthn (SimpleWebAuthn), sessiecookie `HttpOnly`/`SameSite=Strict`/`Secure`, origin-check op wijzigingen,
beperking op mislukte pogingen, uploads gecontroleerd op echte PNG/JPEG/WebP-inhoud.
Back-up: kopieer de map `data/`. Passkey kwijt en geen ander apparaat? Verwijder `data/db.json` → passkeys (en huizen) zijn weg;
verwijder liever alleen het `passkeys`-deel (zet `"passkeys": []`) en doorloop de onboarding opnieuw.
