---
paths:
  - 'src/ui/**'
  - 'vite.config.ts'
---

# UI conventions

- Vite's `root` is `src/ui`, so `build.outDir` is `../../dist/ui` and `index.html` references
  `/main.tsx`. React 19 ships no types; `@types/react` is a real dependency.
- Routing is react-router v8 in declarative mode (`BrowserRouter` in `main.tsx`, `<Routes>` in
  `App.tsx`). Pages live in `src/ui/feature/<name>/`. Page titles use React 19's hoisted `<title>`.
- Load data with `useFetchJson` (`src/ui/lib/api.ts`): it aborts superseded requests and keeps the
  previous data while a new URL loads. Write with `sendJson` and feed the returned record into the
  hook's `mutate` instead of refetching.
- A failed request throws `ApiError`; its `details` holds the API's per-field messages for inline
  form errors.
- Prices are typed in major units and converted to cents by string parsing in `src/ui/lib/money.ts`,
  never `* 100`, so 19.99 stays exactly 1999.
- `newIdempotencyKey()` falls back to `getRandomValues` where `crypto.randomUUID` is missing
  (plain-HTTP LAN access).
- **Never bind a text `<input>`'s `value` straight to `useSearchParams`**: the router wraps location
  updates in `startTransition`, so keystrokes get dropped. Follow `ClientListPage`: keep the text in
  local state, write it to the URL with a `location.state` marker, and copy the URL value back on
  navigations without that marker, and always on back/forward (`POP`), because history restores
  the marker.
- Only `import type` from `src/api/**/*.schema.ts`.
- Loading a new third-party origin (fonts, analytics, an API) needs a matching CSP directive in
  `src/api/app.ts`.
