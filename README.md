# Popelnice

Backendová aplikace pro připomínky svozu komunálního a BIO odpadu a obecních poplatků formou e‑mailových notifikací.

## Technologie

- Node.js + TypeScript
- Express (REST API)
- SendGrid (odesílání e‑mailů)

## Struktura projektu

- `backend/` – Node.js + TypeScript backend
  - `src/index.ts` – startovací bod aplikace, HTTP server + periodické zpracování notifikací
  - `src/config.ts` – načítání konfigurace (.env)
  - `src/models.ts` – základní datové typy (uživatel, svoz, poplatky, notifikace)
  - `src/emailSender.ts` – odesílání e‑mailů přes SendGrid
  - `src/scheduler.ts` – jednoduchý plánovač a zpracování notifikací (zatím pouze v paměti)

## Požadavky

- Node.js 18+ (doporučeno)

## Instalace backendu

```bash
cd projekty/Popelnice/backend
npm install
```

V adresáři `backend/` je připraven soubor `.env.example`. Zkopíruj jej jako `.env` a doplň vlastní hodnoty:

```bash
cd projekty/Popelnice/backend
cp .env.example .env   # ve Windows můžeš vytvořit .env ručně podle .env.example
```

Do `.env` pak nastav:

- `SENDGRID_API_KEY` – 
- `EMAIL_FROM_ADDRESS` – 
- `TEST_RECIPIENT_EMAIL` – 
- `APP_TIMEZONE` – např. `Europe/Prague`.
- `PORT` – např. `4000`.

> **Bezpečnost:**  
> - Soubor `.env` je pouze pro tebe lokálně, nikdy ho necommituj do Gitu ani nikam neposílej.  
> - API klíče a hesla patří jen do `.env` nebo do zabezpečeného konfiguráku na serveru, ne do kódu ani do README.

## Spuštění v režimu vývoje

```bash
cd projekty/Popelnice/backend
npm run dev
```

Backend se spustí na `http://localhost:4000/health`.

Po startu se naplánuje jedna testovací notifikace, která se odešle zhruba za 1 minutu na adresu z proměnné `TEST_RECIPIENT_EMAIL` (případně `EMAIL_FROM_ADDRESS`). Slouží pouze k ověření, že funguje propojení se SendGridem.

## Restart backendu

- Pokud běží `npm run dev`, ukončíš ho v terminálu klávesami `Ctrl + C`.
- Změny v kódu se v režimu `npm run dev` (ts-node-dev) obvykle načítají automaticky – při uložení souboru se server restartuje.
- Kdykoli chceš ručně znovu spustit backend:

```bash
cd projekty/Popelnice/backend
npm run dev
```

## Nasazení (GitHub, Vercel, mobil)

Projekt je připraven na GitHub a nasazení frontendu na Vercel, aby šla aplikace na mobilu uložit na plochu (PWA).

### Frontend na Vercelu

1. Na [vercel.com](https://vercel.com) přidej nový projekt a **Import** z GitHubu (vyber repozitář Popelnice).
2. **Root Directory:** nastav na `frontend` (tlačítko Edit vedle názvu projektu).
3. Build a výstup jsou v `frontend/vercel.json` – Vercel při deployi spustí `npm run build` (vygeneruje `config.js` z env).
4. **Environment Variables** v projektu Vercel:
   - `API_BASE` = plná URL backendu **bez** koncového lomítka, např. `https://tvoj-backend.railway.app`  
   (doplníš až bude backend nasazený).
5. Deploy – Vercel nasadí a dá ti URL (např. `https://popelnice.vercel.app`).

### Render – celá aplikace na jedné URL (doporučeno)

Backend i frontend běží spolu, jedna adresa, žádné API_BASE ani CORS.

1. Jdi na [render.com](https://render.com) → **New** → **Web Service**.
2. Připoj repozitář **Popelnice** z GitHubu.
3. Render načte [render.yaml](render.yaml) – **Root Directory** nech prázdné (celý repo), **Build Command** a **Start Command** jsou už v yaml.
4. V **Environment** přidej proměnné (stejné jako v `backend/.env`):
   - **GMAIL_USER** – tvůj Gmail
   - **GMAIL_APP_PASSWORD** – App heslo z Google účtu
   - **APP_TIMEZONE** – `Europe/Prague`
   - **TEST_RECIPIENT_EMAIL** – e‑mail pro testy
5. **Create Web Service**. Render přidělí URL (např. `https://popelnice.onrender.com`).
6. Aplikace běží na této URL – frontend i API. Na mobilu otevři tuto URL a použij „Přidat na plochu“.

### Backend samostatně (Railway / Render s Root = backend)

Frontend na Vercelu a backend jinde – potřebuješ **API_BASE** na Vercelu a **FRONTEND_ORIGIN** na backendu.

1. Zvol službu (např. [Railway](https://railway.app) nebo [Render](https://render.com)).
2. Nový projekt z GitHubu, **Root** = `backend`.
3. **Build:** `npm install && npm run build`  
   **Start:** `npm start` (nebo `node dist/index.js`).
4. Nastav **env** podle `backend/.env.example`:  
   `PORT`, `APP_TIMEZONE`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `TEST_RECIPIENT_EMAIL`.  
   Pro CORS: **`FRONTEND_ORIGIN`** = URL frontendu na Vercelu.
5. Po nasazení zkopíruj URL backendu a na Vercelu doplň **`API_BASE`** a redeployni frontend.

### Uložení aplikace do mobilu (PWA)

1. Otevři v prohlížeči na telefonu URL frontendu (např. `https://popelnice.vercel.app`).
2. V menu prohlížeče zvol **„Přidat na plochu“** / **„Install app“** / **„Uložit jako aplikaci“**.
3. Aplikace se přidá na plochu s ikonou a bude se otevírat v okně bez adresního řádku (HTTPS zajišťuje Vercel).

---

## Další kroky

- Nahradit dočasné in‑memory úložiště notifikací skutečnou databází (např. SQLite).
- Přidat import reálných dat:
  - kalendář svozu 2026 (komunál + BIO),
  - období poplatků 2026.
- Rozšířit API:
  - správa uživatelů/domácností,
  - nastavení e‑mailové adresy,
  - přehled naplánovaných notifikací.

