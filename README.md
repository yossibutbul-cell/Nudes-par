# nudes par & ordering

Par count and supplier ordering for Nudes Yogurt (165 S Crescent Heights Blvd, Los Angeles).
A single-page web app hosted on Firebase Hosting, with Google sign-in and Firestore.
No build step: `public/` is served as-is.

## How it works

- **Sign-in** is Google only. Access is an allowlist: a document in `users/{email}` with a `role` of
  `staff` or `admin`. `admin@nudesyogurt.com` is the owner and is always an admin (hardcoded in
  `firestore.rules` and `public/firebase-config.js`), so the very first sign-in works.
- **Staff** see today, the count and the order report. **Admins** also get items & par,
  suppliers, count history, team and settings.
- **Counts** are sporadic, not daily. Someone starts a count (picking the date it is for), everyone
  edits the same `counts/{id}` document in real time (`entries[itemId] = { on, par, by, at }`), and
  the order report is built from the latest count. **Finalizing** (on the order report) locks the
  count, stores an order summary snapshot on it, and opens one email to the order manager(s) listed
  in settings with every supplier's order and estimated cost. The next count starts fresh.
- **Orders**: order = par − on hand, rounded up to whole cases. "Send" opens the user's mail app,
  WhatsApp, or SMS with the order pre-filled (or copies it for phone / portal suppliers) and logs the
  order in `orders/{countId_supplierId}` with lines and estimated cost.
- **Categories**: every item belongs to one category (`items.group`), e.g. food, paper goods,
  equipment. Admins manage the ordered list in settings (`settings.categories`); renaming updates
  every item in it. The items screen groups and filters by category. `items.category` is the older
  free-text "product line" (the supplier's own grouping). The first time an admin opens the app after
  categories were added, existing items are sorted automatically by name keywords.
- **Fractional counts**: on-hand can be 2.5, 2 1/2, ½, etc. The ¼ ½ ¾ buttons set the partial unit.
  Shortfall = par − on hand; orders still round up to whole cases.
- **Pricing**: each item has a case price, units per case and unit weight (oz).
  price per unit = case price ÷ units per case; price per oz = price per unit ÷ unit weight.

## Files

| path | what |
| --- | --- |
| `public/index.html` | markup for every screen, modals and the sign-in gate |
| `public/styles.css` | the mockup's design tokens and layout, plus app additions |
| `public/app.js` | all logic: auth, Firestore listeners, rendering, forms |
| `public/seed.js` | starter items and suppliers (from the preliminary ordering sheet) |
| `public/firebase-config.js` | Firebase web config, owner email, timezone |
| `firestore.rules` | security rules (allowlist + roles) |
| `firebase.json` | hosting + firestore deploy config |

## One-time Firebase setup

1. **Firestore**: Firebase console → Build → Firestore Database → Create database
   (production mode, region `us-west1` or `nam5`). Rules are deployed from this repo.
2. **Authentication**: Build → Authentication → Get started → Sign-in method → enable **Google**.
   Under Settings → Authorized domains make sure `<project-id>.web.app` is listed (it is by default).
3. **Web app config**: Project settings → Your apps → Add app → Web. Copy the config object into
   `public/firebase-config.js`. Or from the CLI: `firebase apps:sdkconfig web`.

## Deploy

```bash
firebase use <project-id>
firebase deploy --only firestore:rules,hosting
```

The app is then at `https://<project-id>.web.app`.

## First run

1. Sign in as `admin@nudesyogurt.com`.
2. Settings → "load starter items & suppliers" (only offered while the item list is empty).
3. Items & par → set real par levels, case prices and unit weights.
4. Suppliers → fill in contact, delivery days and cut-offs.
5. Settings → order manager emails (who receives the summary when a count is finalized).
6. Team → add staff emails.

## Local development

`dev/` holds a mock: `./dev/sync.sh` builds `dev/site`, a copy of `public/` with an import map that swaps the
Firebase SDK for an in-memory mock, so every screen can be exercised without a project.
Serve it with `python3 -m http.server 8765 --directory dev/site`, sign in; `?as=someone@example.com` picks the mock account.
