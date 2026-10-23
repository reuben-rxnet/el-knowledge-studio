# Local development

```bash
npm install
cp .env.example .env
npm run setup
npm run dev            # or: npx next dev -p 3010 if port 3000 is taken
```

- Sign in at `/sign-in` with any persona, or switch persona from the top bar.
- Reset demo data: `npm run db:reset`.
- To exercise Codex locally, see [integrations.md](integrations.md). Leave `AI_PROVIDER=mock` for offline work.
- If routes return 404 after adding new route folders while the dev server runs, stop the server, delete `.next/` and restart (Turbopack cache).
- npm 11 blocks install scripts. The ones this project needs are listed under `allowScripts` in `package.json`.
