# Lunch Hondenrace (webversie)

Collega's openen de link, vullen één keer hun naam in en kiezen een restaurant: dat wordt hun hond in de startlijst.
De beheerder (met de beheerderscode) start de race op het grote scherm en beheert restaurants en instellingen.

## Wat zit erin

| Bestand | Wat |
|---|---|
| `index.html` | De hele app (racebaan, 3D-honden, restaurants, statistieken) |
| `api/db.js` | Kleine serverfunctie voor de gedeelde opslag (startlijst, restaurants, races) |

Er hoeft niets gebouwd of geïnstalleerd te worden.

## Online zetten (ongeveer 10 minuten, alleen klikken)

1. **GitHub**: maak een nieuwe, privé repository (bijvoorbeeld `lunch-hondenrace`).
   Kies *uploading an existing file* en sleep `index.html`, `README.md`, `package.json` en de map `api` erin. Klik *Commit changes*.
2. **Vercel** (vercel.com, inloggen met GitHub): *Add New → Project* → kies de repository → *Import*.
   - Framework Preset: **Other**
   - Bij *Environment Variables*: naam `ADMIN_CODE`, waarde: een code die alleen jij weet.
   - Klik *Deploy*.
3. **Database koppelen**: open het project in Vercel → tabblad **Storage** → *Create Database* → **Upstash for Redis** (gratis plan) → koppel aan dit project.
   Vercel zet de sleutels zelf als omgevingsvariabelen.
4. Ga naar **Deployments** → bij de bovenste deployment *⋯ → Redeploy* (zodat de database-sleutels meegenomen worden).
5. Open de site → **Instellingen** → vul je beheerderscode in → **Restaurants** → *Standaardlijst laden* (of importeer via Thuisbezorgd).
6. Deel de link in Teams. Klaar.

## Dagelijks gebruik

- Collega's: link openen → restaurant aanklikken → staat erin met hun naam. Opnieuw klikken op een ander restaurant = wisselen, kruisje = weghalen.
- Jij: vult eventueel aan met *willekeurig*, start de race op het grote scherm, en zet de lijst daarna op *Leeg* voor de volgende keer.

## Goed om te weten

- Iedereen met de link kan een hond kiezen (één per persoon). Al het andere kan alleen met de beheerderscode.
- Code vergeten of wijzigen: pas `ADMIN_CODE` aan in Vercel (*Settings → Environment Variables*) en doe een *Redeploy*.
- Zonder `ADMIN_CODE` is iedereen beheerder.
- De pagina vraagt de database alleen om de paar seconden om wijzigingen, en niet als het tabblad op de achtergrond staat;
  dat blijft ruim binnen het gratis Upstash-plan.
