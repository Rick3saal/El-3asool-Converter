# El 3asool Converter 🍯 — Sabre GDS Itinerary Converter

Personal flight-itinerary converter that turns pasted itineraries, e-tickets and screenshots into
accurate, copy-ready Sabre GDS itinerary and sell entries.

Static client-side app: **Vite 7 + React 19 + Tailwind 4**, built into a single self-contained
`dist/index.html` (via `vite-plugin-singlefile`) plus the files in `public/`. There is no server,
no database and no build-time secret — which is exactly why it deploys cleanly on Vercel.

---

## Deploy to Vercel (recommended)

The deployable project lives in the **root of this repository** (the folder containing
`package.json`, `index.html` and `vite.config.ts`).

1. Push this repository to GitHub.
2. In [Vercel](https://vercel.com): **Add New > Project > Import** the repository.
3. **Root Directory**: `./` — do not point it at a subfolder.
4. Leave the build settings alone. `vercel.json` already pins them:

   | Setting | Value |
   |---|---|
   | Framework preset | `Vite` |
   | Install command | `npm ci --include=dev` |
   | Build command | `npm run build` |
   | Output directory | `dist` |
   | Node.js version | `22.x` (from `engines` in `package.json`) |

5. Click **Deploy**. Every later push to `main` publishes a new production deployment.

If you re-import an existing project or the dashboard shows values from a previous attempt, make
the four fields above match exactly — dashboard settings take precedence over `vercel.json`.

### After the first successful build

- **Custom domain**: *Project Settings > Domains*. Then add the environment variable `SITE_URL`
  (e.g. `https://converter.example.com`) so link previews carry an absolute `og:image` and
  canonical URL. Without it, Vercel's own deployment host is used automatically.
- **Vercel's default `.vercel.app` domain is fine for this app** — no env vars, no functions,
  no CORS configuration needed.

### Optional: deploy from the command line

If the remote builder is ever unavailable, this builds the Vercel output locally and uploads it
without re-running a remote build:

```bash
npx vercel@latest login
npx vercel@latest link
npm run deploy:vercel   # = vercel build --prod && vercel deploy --prebuilt --prod
```

### Verify before you push

```bash
npm ci
npm run check   # typecheck + 209 parser assertions + production build
```

---

## Local development

```bash
npm install
npm run dev        # dev server
npm run build      # production build into dist/
npm run preview    # serve the built dist/ locally
```

Scripts: `dev`, `build`, `preview`, `typecheck`, `selftest` (53 parser cases),
`selftest:extra` (156 regression cases), `cathaycheck` (end-to-end CX itinerary),
`check` (all of the above plus a production build) and `deploy:vercel`.

The test suites run on the parser alone — no browser, no network — so they are safe to run
before every push. They are intentionally **not** part of `npm run build`, so a flaky test can
never take the deployment down.

---

## Project layout

```
index.html            entry HTML (meta tags, fonts)
src/App.tsx           the whole UI
src/lib/parser.ts     deterministic itinerary parser
src/lib/converter.ts  Sabre sell-entry / itinerary formatting
src/lib/ai.ts         optional browser-side AI assist (Gemini / OpenAI / custom) + online aircraft lookup
src/lib/cabinClasses.ts booking-class letter → cabin (per-airline maps)
src/lib/ocr.ts        Tesseract.js OCR for screenshots
src/lib/learning.ts   self-learning rules kept in localStorage
scripts/              parser self-tests (run with npm run selftest)
public/               favicon, webmanifest, social preview
vercel.json           Vercel build + header settings (authoritative)
netlify.toml          equivalent settings for a Netlify deploy
```

### Why the build tooling sits in `dependencies`

`vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite` and `vite-plugin-singlefile` are
intentionally listed under `dependencies`, not `devDependencies`. Vercel builds with
`NODE_ENV=production`, and npm then omits dev dependencies by default — which is what caused the
earlier `vite: command not found` failures. Please don't "tidy" them away.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `SITE_URL` | Vercel env (optional) | Absolute canonical URL + `og:image` host |

Copy `.env.example` to `.env` for local overrides. No other variables exist — AI provider keys are
typed into the app and stored only in that browser's local storage, never in the deployment.

## Cabin & aircraft intelligence

**Booking class → cabin (automatic, offline).** Sabre/GDS-style rows carry a single
booking-class letter right after the flight number (`EY 22 W 14DEC YYZ AUH …`). That letter's
meaning is **airline-specific** — `W` is Business on Emirates but Economy elsewhere. The parser
captures the letter (glued `EY 22W` or spaced `EY 22 W`) and `src/lib/cabinClasses.ts` maps it to
the cabin using per-airline tables (EY, BA, LH, AF/KL, QR, SQ, MS, TK, CX, AC, JL/NH, …) plus a
deliberately tiny generic set. A printed cabin word always wins; an unknown/ambiguous letter
never guesses — it falls through to your manual cabin choice. The letter is also preserved in the
`<--additional-->` lines and sell entries (`EY 22W 14DEC`).

**Online aircraft lookup (AI Assist, opt-in).** When a segment still shows equipment `---`, you
can let AI Assist fill it in: enable **AI Assist** and the **🌐 Look up missing aircraft online**
toggle. With a Gemini key the app asks the model — using **Google Search grounding**, i.e. a real
online check of the schedule/aircraft for that flight on that date — for the operating type, and
maps it to the Sabre equipment code through the same mapper the local parser uses (airline-specific
filings are honored, e.g. Emirates files the 787-10 as `781`). Found aircraft are memorized by
self-learning so the next conversion of the same flight needs no AI call. Note: search-grounded
responses are billed per search on your own key; with OpenAI-compatible providers the lookup uses
the model's own knowledge instead (no live search). Default model is `gemini-3.6-flash`
(1M-token context); the model field suggests other current Flash/Pro models.

## Browser requirements on the live site

- **HTTPS is required** for Clipboard API access (paste-to-OCR, copy buttons). Vercel provides it.
- **OCR** runs in the browser; Tesseract's worker/WASM/language files load from the jsDelivr CDN on
  first use, so the visitor needs internet access at that moment. Text is never sent anywhere.
- **AI Assist** calls the selected provider directly from the browser; keys live in local storage.
- **Self-learning rules and learned itineraries** are stored in local storage, scoped per domain.

## Moving to a different domain

Local storage does not transfer between origins. Rules learned on `localhost`, a preview URL or an
older domain will not appear on the final domain — start (or re-import) learning on the permanent
production domain.

## Alternatives

- **Netlify**: the included `netlify.toml` supplies the same build settings; or run `npm run build`
  and drop the `dist/` folder onto Netlify Drop.
- **GitHub Pages**: `.github/workflows/deploy-pages.yml` builds and publishes `dist/`, but only
  when run manually (it is `workflow_dispatch`-only so it never competes with Vercel or fails on
  every push). Enable *Repository Settings > Pages > GitHub Actions* first.
