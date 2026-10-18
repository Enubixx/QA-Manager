# QA Manager (QA Field Tester) — Workspace & Deployment Instructions

## Workspace Location
- **Cloudtop Repository Path:** `/usr/local/google/home/huankevin/projects/QA Manager`
- **GitHub Remote:** `https://github.com/Enubixx/QA-Manager.git` (branch: `main`)
- **Tech Stack:** React 18 + Vite 5 + TypeScript + Tailwind CSS + Supabase + Gemini (`@google/genai`) + Capacitor/Bubblewrap Android APK + Google Apps Script helper (`google-apps-script/`)

---

## Live Deployment Paths

### 1. Web App Deployment (Vercel — Automatic & CLI)
- **Vercel Project:** `qa-manager` (`prj_mpDNSmRULgSnMyuvfl9qE92mXY9p`, Org: `team_sLy749bTMCrXCrYNVKgeSPAz`)
- **Automatic Deploy (Preferred):**
  1. Run type-check and build verification:
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

### 2. Google Apps Script Backend (`google-apps-script/`)
- **Script ID:** `1okjLaxHFV_jZEMoUswRHXKtzAt7B_f-NlZArSl7sZYn8LrUSAfTk8zwK`
- **Deploy Command:**
  ```bash
  cd "/usr/local/google/home/huankevin/projects/QA Manager/google-apps-script"
  npx @google/clasp push
  ```
  *(OAuth credentials are in `~/.clasprc.json`).*

### 3. Android APK (`QA_Field_Tester`)
- Sync web build into Capacitor Android project:
  ```bash
  npm run build
  npx cap sync android
  ```
- To install an APK onto a phone connected to the user's Mac over the reverse SSH tunnel (`127.0.0.1:2222`):
  ```bash
  ssh -p 2222 huankevin@127.0.0.1 "adb install -r '/path/to/apk'"
  ```
