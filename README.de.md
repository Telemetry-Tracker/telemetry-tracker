# Telemetry Tracker
🇩🇪 Deutsch: [README.de.md](README.de.md)

![License](https://img.shields.io/github/license/Telemetry-Tracker/telemetry-tracker)
![GitHub Stars](https://img.shields.io/github/stars/Telemetry-Tracker/telemetry-tracker)
![GitHub Issues](https://img.shields.io/github/issues/Telemetry-Tracker/telemetry-tracker)
![CI](https://github.com/Telemetry-Tracker/telemetry-tracker/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
[![npm version](https://img.shields.io/npm/v/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)
[![npm downloads](https://img.shields.io/npm/dm/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)

<p align="center">
  <strong>Open-source Fehlerverfolgung, Produktanalyse, und Sitzungstelemetrie.</strong>
</p>

<p align="center">
  Entweder lightweight und self-hosted für die eigene Infrastruktur — oder über den <strong>offiziellen  Cloud-Dienst</strong> bei
  <a href="https://telemetry-tracker.com">telemetry-tracker.com</a> über Stripe Billing (EUR).
</p>

<p align="center">
  <a href="https://telemetry-tracker.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-dashboard-dark.png" />
      <img src="apps/dashboard/public/screenshot-dashboard-light.png" alt="Dashboard overview with errors, events, sessions, and performance metrics" width="920" />
    </picture>
  </a>
</p>

<p align="center">
  <sub><strong>Overview</strong> — KPI cards, event trends, top errors, releases, and performance metrics (light/dark).</sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-errors-dark.png" />
    <img src="apps/dashboard/public/screenshot-errors-light.png" alt="Errors page with KPIs, trends, top error types, and grouped error table" width="920" />
  </picture>
</p>

<p align="center">
  <sub><strong>Errors</strong> — KPIs, trends by type, top errors, and a filterable grouped error table (light/dark).</sub>
</p>

---

## Features

| Feature | Supported |
|---------|-----------|
| Fehler | ✅ |
| Events | ✅ |
| Sessions | ✅ |
| Organisationen | ✅ |
| Projekte | ✅ |
| API-Keys | ✅ |
| Dashboard | ✅ |
| REST API | ✅ |
| SDKs (`@telemetry-tracker/*`) | ✅ |
| Self-hosted | ✅ |
| Hosted cloud ([telemetry-tracker.com](https://telemetry-tracker.com)) | ✅ |
| Zahlungspläne (Free / Pro / Business, in €) | ✅ |
| Benachrichtigungen | ✅ |
| Source Maps | ✅ |

Self-host setup: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Warum Telemetry Tracker?

Telemetry Tracker bietet die wichtigsten Funktionen, die die meisten Anwendungen benötigen – Fehlerverfolgung, Produktanalyse-Ereignisse und Sitzungs-Telemetrie – ohne die Komplexität von Enterprise-Observability-Plattformen.

* Self-hosted für eigene Anwendungen
* Offizielle gehostete Cloud mit Abrechnung in Euro (EUR)
* Schlank und ressourcenschonend
* Einfache APIs
* Open Source ([MIT](LICENSE))
* Einfach bereitzustellen ([DEPLOYMENT.md](DEPLOYMENT.md))

---

## Architektur

```
Client SDK
    ↓  Datenaufnahme (API key)
   API  ←──  Dashboard (Sitzungsauthentifizierung)
    ↓
 PostgreSQL
```

Anwendungen senden Fehler, Ereignisse und Sitzungen über `@telemetry-tracker/*` an die **API**. Das **Dashboard** liest die Telemetriedaten über dieselbe API – niemals direkt aus der Datenbank.


---

## 🚀 Quick Start

Starte Telemetry Tracker lokal in weniger als 5 Minuten.

**Prerequisites:** Node.js 18+, pnpm 9, PostgreSQL 16 (Docker funktioniert).

```bash
git clone https://github.com/Telemetry-Tracker/telemetry-tracker.git
cd telemetry-tracker
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
pnpm db:migrate
```

In zwei Konsolen:

```bash
pnpm dev:api        # API → http://localhost:3001
pnpm dev:dashboard  # Dashboard → http://localhost:3000
```

Then:

1. Öffne **http://localhost:3000**, klicke **Start tracking**, und erstelle einen Account.
2. Erstelle eine **organization** und ein **project** in den Organisationseinstellungen.
3. Erstelle einen **API key** unter Settings → API keys (kopiere den `tt_live_…` secret einmalig).
4. Benutze deine App (siehe SDK beispiel) und überprüfe **Overview** im Dashboard.

---

## SDK

Kompatibel mit:

- ✓ **React / Vue** — `@telemetry-tracker/core`
- ✓ **Next.js** — `@telemetry-tracker/next`
- ✓ **Node / NestJS** — `@telemetry-tracker/node`
- ✓ **Nuxt** — `@telemetry-tracker/core` ([guide](docs/sdk-nuxt.md))
- ✓ **React Native** — `@telemetry-tracker/react-native`
- ✓ **Vanilla JS** — `@telemetry-tracker/core`

Guides: [core](docs/sdk-core.md) · [Next.js](docs/sdk-next.md) · [Node](docs/sdk-node.md) · [NestJS](docs/sdk-nestjs.md) · [Vue](docs/sdk-vue.md) · [Nuxt](docs/sdk-nuxt.md) · [React Native](docs/sdk-react-native.md)

### Beispiel

Installiere von npm aus:

```bash
pnpm add @telemetry-tracker/core
```

```ts
import { init, trackEvent, trackError } from "@telemetry-tracker/core";

init({
  ingestUrl: "http://localhost:3001",
  app: "my-app",
  apiKey: process.env.TELEMETRY_API_KEY!, // tt_live_… from dashboard
  environment: "development",
});

trackEvent("user_registered");
trackError(new Error("Something broke"));
```

---

## 🏗 Project Struktur

```
apps/
  api/          # Fastify ingest + read API, Prisma, auth, billing
  dashboard/    # Next.js UI

packages/
  telemetry-core/
  telemetry-node/
  telemetry-next/
  telemetry-react-native/
```

---

## Built With

- [Next.js](https://nextjs.org/) — dashboard
- [Fastify](https://fastify.dev/) — API
- [Prisma](https://www.prisma.io/) — ORM & migrations
- [PostgreSQL](https://www.postgresql.org/) — database
- [TypeScript](https://www.typescriptlang.org/)
- [pnpm](https://pnpm.io/) — monorepo
- [Docker](https://www.docker.com/) — local development (Postgres via `docker compose`; dashboard production image)

---

## Roadmap

Die bereits verfügbaren Funktionen befinden sich oben unter **[Features](#features)**. Im Folgenden werden **geplante und in Entwicklung befindliche Arbeiten** aufgeführt, kein Veröffentlichungsplan. Elemente, die im Dashboard als *Coming soon* gekennzeichnet sind, entsprechen dieser Liste ([#96](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/96)).

| Status | Erklärung |
|--------|---------|
| **Geplant** | In einer GitHub-Issue definiert oder erfasst |
| **In Entwicklung** | Als *Coming soon* gekennzeichnet; Zeitpunkt und Umfang noch offen |

<details>
<summary><strong>Geplant & in Entwicklung</strong> (11 Bereiche — Observability, Plattform, Konto)</summary>

### Observability

| Bereich | Status |
|---------|--------|
| [Performance / Web Vitals](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/99) | Geplant |
| Traces | In Entwicklung |
| Logs | In Entwicklung |

### Plattform

| Bereich | Status |
|---------|--------|
| Benutzerdefinierte Dashboards | Geplant |
| Releases | In Entwicklung |
| Feature Flags | In Entwicklung |
| Exportberichte | In Entwicklung |

### Konto & Organisation

| Bereich | Status |
|---------|--------|
| Team-Audit-Protokoll | Geplant |
| Integrationen | In Enwticklung |
| Profil, Einstellungen & Sicherheit | In Entwicklung |

</details>

Sie haben eine Idee? [Open a feature request](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md).

---

## 🤝 Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and what CI runs.

Good places to start:

- [**Good first issues**](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- [help wanted](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) issues

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately via [SECURITY.md](SECURITY.md)—not public issues.

---

## 📚 Documentation

| Topic | Doc |
|-------|-----|
| Architecture overview | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Deploy (overview) | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Railway setup & troubleshooting | [docs/RAILWAY.md](docs/RAILWAY.md) |
| Stripe & Resend (optional) | [docs/BILLING.md](docs/BILLING.md) |
| Production checklist | [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) |
| Releases & deploy runbook | [docs/RELEASE.md](docs/RELEASE.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| RBAC & org model | [docs/RBAC.md](docs/RBAC.md) |
| Plans & ingest auth | [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md) |
| SDK guides | [docs/sdk-core.md](docs/sdk-core.md), [docs/sdk-next.md](docs/sdk-next.md), [docs/sdk-node.md](docs/sdk-node.md), [docs/sdk-nestjs.md](docs/sdk-nestjs.md), [docs/sdk-vue.md](docs/sdk-vue.md), [docs/sdk-nuxt.md](docs/sdk-nuxt.md), [docs/sdk-react-native.md](docs/sdk-react-native.md) |
| Source maps | [docs/source-maps.md](docs/source-maps.md) |

**Publish SDK packages:** `npm login` → `pnpm publish:packages` (see [CONTRIBUTING.md](CONTRIBUTING.md) and root `package.json` scripts).

**GitHub social preview:** In repo **Settings → General → Social preview**, use `https://telemetry-tracker.com/og-banner.png` (1024×409 marketing banner) once the dashboard is deployed. Install path for docs and marketing: `@telemetry-tracker/core` (see npm badges above).

---

## ❤️ Support the Project

If you find Telemetry Tracker useful:

- ⭐ Star this repository
- 🐛 [Report bugs](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=bug_report.md)
- 💡 [Suggest features](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md)
- 🤝 Open a pull request

---

## 📄 License, trademark & hosting

### Software (MIT)

This project’s **source code** is licensed under the [MIT License](LICENSE). You may use, modify, self-host, and distribute the software under those terms, including the copyright notice in copies you distribute.

MIT covers **copyright on the code**. It does not grant rights to use the **Telemetry Tracker** name or branding in ways that suggest Tacko operates or endorses your service. See [TRADEMARK.md](TRADEMARK.md).

### Self-hosting

You may run Telemetry Tracker on infrastructure you control for your own applications — no separate permission required under MIT.

### Official hosted cloud

The **managed service** at [telemetry-tracker.com](https://telemetry-tracker.com) is operated by [Tacko](https://tacko.io). **Pro** and **Business** plans there are billed in **EUR** via Stripe.

### Brand & competing hosted services

Do not offer a multi-tenant hosted service **to third parties** using the **Telemetry Tracker** name, logo, or marketing as if it were the official product. Forks and internal deployments should use a **distinct name** unless you have written permission from Tacko.

Details and examples: **[TRADEMARK.md](TRADEMARK.md)** · Partnerships: [info@tacko.io](mailto:info@tacko.io)
