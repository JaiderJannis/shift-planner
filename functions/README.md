# Pushmelding de avond vóór je dienst

De app zelf geeft de herinnering al wanneer je hem 's avonds opent of open hebt staan.
Wil je de melding **ook als de app gesloten is**, dan moet deze kleine Cloud Function
één keer in Firebase gezet worden.

## Wat je nodig hebt
- Het Firebase-project `shift-planner-dc7ad` op het **Blaze-abonnement** (betalen per gebruik;
  voor deze ene melding per dag blijf je ruim binnen het gratis deel).
- Een computer met [Node.js 20](https://nodejs.org).

## Eenmalig installeren
```bash
npm install -g firebase-tools
firebase login
cd shift-planner            # deze map
cd functions && npm install && cd ..
firebase deploy --only functions
```

Daarna loopt `avondMelding` elke dag om 20:00 (Brussel). Je ziet de logboeken in de
Firebase-console onder **Functions**.

Pushmeldingen komen alleen op toestellen waar je in de app bij Profiel op
**Activeer meldingen** tikte (op iPhone: eerst de app op je beginscherm zetten).
