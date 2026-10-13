# BinSight
Storage-bin inventory: scan a QR code on a bin to see/edit its contents, photos, room and location.

- Hosted with GitHub Pages: https://shannonklevenberg3.github.io/BinSight/
- Data: Firebase project `creek-hollow-packing` (Firestore + Google sign-in). Photos are stored compressed inside Firestore.
- QR codes encode `https://shannonklevenberg3.github.io/BinSight/#/BIN-014`. Do not rename the repo or the account after labels are printed.
- Rebuild after editing `app.js`: `npm install && npm run build`, then commit `app.bundle.js`.
- Try without signing in: add `?demo=1` to the address (nothing is saved).
