# QA Manager (QA Field Tester) — Workspace & Deployment Instructions

## Workspace Location
- **Cloudtop Repository Path:** `/usr/local/google/home/huankevin/projects/QA Manager`
- **GitHub Remote:** `https://github.com/Enubixx/QA-Manager.git` (branch: `main`)
- **Tech Stack:** React 18 + Vite 5 + TypeScript + Tailwind CSS + Supabase + Gemini (`@google/genai`) + Capacitor/Bubblewrap Android APK

---

## Live Deployment Paths

### 1. Web App Deployment (Vercel — Automatic & CLI)
- **Vercel Project:** `qa-manager` (`prj_mpDNSmRULgSnMyuvfl9qE92mXY9p`, Org: `team_sLy749bTMCrXCrYNVKgeSPAz`)
- **Automatic Deploy (Preferred):**
  1. Run unit tests, type-check, and build verification (`npm run build` runs `vitest run && tsc && vite build`; run `npm run test:e2e` for the offline browser smoke test):
     ```bash
     npm run build
     ```
  2. Commit and push to `origin main`:
     ```bash
     git push origin main
     ```
     *(GitHub credentials are configured in `~/.netrc`; pushing to `main` automatically triggers the production Vercel deployment).*
- **Direct CLI Deploy:**
  ```bash
  npx vercel --prod
  ```
  *(Vercel CLI auth is stored in `~/.local/share/com.vercel.cli/auth.json` and `~/.config/com.vercel.cli/auth.json`).*

### 2. Android APK (`QA_Field_Tester`)
- Sync web build into Capacitor Android project:
  ```bash
  npm run build
  npx cap sync android
  ```
- To install an APK onto a phone connected to the user's Mac over the reverse SSH tunnel (`127.0.0.1:2222`):
  ```bash
  ssh -p 2222 huankevin@127.0.0.1 "adb install -r '/path/to/apk'"
  ```
