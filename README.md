# Roland Garros 2026 — Family Bracket

A shared web page where everyone in the family fills out a full 128-player
bracket for the men's and women's singles draws, and a live leaderboard scores
the predictions as the tournament plays out.

## What's in here

| File | What it is |
|------|------------|
| `index.html` | The page everyone opens |
| `app.js` | All the app logic (picking, scoring, leaderboard) |
| `draws.js` | The official Roland Garros 2026 draws (128 players each) |
| `styles.css` | Styling |
| `firebase-config.js` | **You must fill this in once** — see below |

## How it works

- Each person opens the link, types their name, and picks a winner for every
  match from the Round of 128 down to the champion (127 picks per draw).
- Picks save automatically. Round 2 fills in from your Round 1 winners, and so on.
- The **commissioner** (you) records the real match results and locks the
  brackets when play starts.
- Scoring per correct pick: **10 / 20 / 40 / 80 / 160 / 320 / 640** for
  R128 → R64 → R32 → R16 → QF → SF → Final. Each round is worth 640 points in
  total, so a complete correct first round and a correct champion are worth the
  same. Max per draw is 4,480; max overall 8,960.
- Other people's picks stay hidden until the brackets are locked.

## One-time setup (about 5 minutes)

The app uses **Firebase Firestore** (free) so picks and the leaderboard sync
between everyone.

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Add project**, give it a name (e.g. `rg-family-bracket`), and finish.
   You can disable Google Analytics — it isn't needed.

### 2. Register a web app
1. On the project overview page, click the **`</>`** (Web) icon.
2. Give it a nickname and click **Register app**. You do **not** need Firebase
   Hosting here.
3. Firebase shows a `firebaseConfig` object. Copy each value into
   `firebase-config.js`, replacing the `PASTE_...` placeholders.

### 3. Create the Firestore database
1. In the left menu: **Build → Firestore Database → Create database**.
2. Pick a location near you and continue.

### 4. Set the security rules
In the Firestore **Rules** tab, replace the contents with the following and
click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

This makes the data fully open. That's fine for a private family link — just
don't post the link publicly. (If you'd like tighter rules later, that's a
follow-up.)

### 5. Set the commissioner password
At the bottom of `firebase-config.js`, change `COMMISSIONER_PASSWORD` to
something only you know. This gates results entry and locking the brackets.

## Sharing it with the family

The app is just static files, so any static host works. Two easy options:

**Option A — GitHub Pages (a real shareable link)**
1. Create a repo and upload these files (or use `git`).
2. In the repo: **Settings → Pages → Branch: main / root → Save**.
3. After a minute the family bracket is live at
   `https://<your-username>.github.io/<repo-name>/`. Share that link.

**Option B — try it locally first**
From this folder run a static server, e.g.:
```
python3 -m http.server 8000
```
then open <http://localhost:8000>. (Opening `index.html` directly as a
`file://` URL will not work — it must be served over http.)

## Running the pool

1. **Before play starts:** everyone fills out their bracket. Once the qualifier
   spots are confirmed you can optionally edit `draws.js` to replace
   `Qualifier` entries with real names — do this before locking.
2. **When the tournament begins:** open the **Commissioner** tab, enter your
   password, and click **Lock brackets now**. Picks are now final.
3. **As matches finish:** in the Commissioner tab, tap the actual winner of each
   match. The leaderboard updates live for everyone.

## Notes

- The draws were taken from the official rolandgarros.com draw on 2026-05-21.
- One bracket is stored per device. If two people share a device, use the
  "not you?" link to start a separate bracket.
- The commissioner password is a light gate to prevent accidental edits, not
  strong security.
