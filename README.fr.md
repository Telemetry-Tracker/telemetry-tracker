🇬🇧 English: [README.md](README.md)
🇩🇪 Deutsch: [README.de.md](README.de.md)
🇪🇸 Español: [README.es.md](README.es.md)
# Telemetry Tracker

![License](https://img.shields.io/github/license/Telemetry-Tracker/telemetry-tracker)
![GitHub Stars](https://img.shields.io/github/stars/Telemetry-Tracker/telemetry-tracker)
![GitHub Issues](https://img.shields.io/github/issues/Telemetry-Tracker/telemetry-tracker)
![CI](https://github.com/Telemetry-Tracker/telemetry-tracker/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
[![npm version](https://img.shields.io/npm/v/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)
[![npm downloads](https://img.shields.io/npm/dm/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)

<p align="center">
  <strong>Suivi d'erreurs open-source, analytics produit et télémétrie de session.</strong>
</p>

<p align="center">
  Léger et auto-hébergé pour votre propre infrastructure—ou utilisez le <strong>cloud officiel hébergé</strong> sur
  <a href="https://telemetry-tracker.com">telemetry-tracker.com</a> avec facturation Stripe (EUR).
</p>

<p align="center">
  <a href="https://telemetry-tracker.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-dashboard-dark.png" />
      <img src="apps/dashboard/public/screenshot-dashboard-light.png" alt="Aperçu du tableau de bord avec erreurs, événements, sessions et métriques de performance" width="920" />
    </picture>
  </a>
</p>

<p align="center">
  <sub><strong>Aperçu</strong> — Cartes KPI, tendances des événements, principales erreurs, versions et métriques de performance (clair/sombre).</sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-errors-dark.png" />
    <img src="apps/dashboard/public/screenshot-errors-light.png" alt="Page des erreurs avec KPI, tendances, principaux types d'erreurs et tableau d'erreurs groupé" width="920" />
  </picture>
</p>

<p align="center">
  <sub><strong>Erreurs</strong> — KPI, tendances par type, principales erreurs et tableau d'erreurs groupé filtrable (clair/sombre).</sub>
</p>

---

## Fonctionnalités

| Fonctionnalité | Supportée |
|---------|-----------|
| Erreurs | ✅ |
| Événements | ✅ |
| Sessions | ✅ |
| Performance / Web Vitals | ✅ |
| Versions | ✅ |
| Recherche globale | ✅ |
| Organisations | ✅ |
| Projets | ✅ |
| Clés API | ✅ |
| Tableau de bord | ✅ |
| API REST | ✅ |
| SDKs (`@telemetry-tracker/*`) | ✅ |
| Auto-hébergement | ✅ |
| Cloud hébergé ([telemetry-tracker.com](https://telemetry-tracker.com)) | ✅ |
| Forfaits payants (Gratuit / Pro / Business, EUR via Stripe) | ✅ |
| Alertes (notifications & canaux) | ✅ |
| Règles d'alerte (conditions & destinations) | ✅ |
| Source maps | ✅ |

Configuration auto-hébergée : [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Pourquoi Telemetry Tracker ?

Telemetry Tracker fournit les blocs de construction essentiels dont la plupart des applications ont besoin—suivi d'erreurs, analytics produit et télémétrie de session—sans la complexité des plateformes d'observabilité d'entreprise.

- Auto-hébergé pour vos propres produits
- Cloud officiel hébergé avec facturation en EUR
- Léger
- APIs simples
- Open source ([MIT](LICENSE))
- Facile à déployer ([DEPLOYMENT.md](DEPLOYMENT.md))

---

## Architecture

```
Client SDK
    ↓  ingestion (clé API)
   API  ←──  Tableau de bord (authentification par session)
    ↓
 PostgreSQL
```

Les applications envoient les erreurs, événements et sessions à l'**API** via `@telemetry-tracker/*`. Le **tableau de bord** lit la télémétrie via la même API—jamais directement depuis la base de données.

---

## 🚀 Démarrage rapide

Faites fonctionner Telemetry Tracker localement en moins de 5 minutes.

**Prérequis :** Node.js 18+, pnpm 9, PostgreSQL 16 (Docker fonctionne).

```bash
git clone https://github.com/Telemetry-Tracker/telemetry-tracker.git
cd telemetry-tracker
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
pnpm db:migrate
```

Dans deux terminaux :

```bash
pnpm dev:api        # API → http://localhost:3001
pnpm dev:dashboard  # Tableau de bord → http://localhost:3000
```

Ensuite :

1. Ouvrez **http://localhost:3000**, cliquez sur **Start tracking** et créez un compte.
2. Créez une **organisation** et un **projet** dans les paramètres de l'organisation.
3. Créez une **clé API** dans Paramètres → Clés API (copiez le secret `tt_live_…` une seule fois).
4. Instrumentez votre application (voir l'exemple SDK ci-dessous) et consultez l'**Aperçu** dans le tableau de bord.

---

## SDK

Fonctionne avec :

- ✓ **React / Vue** — `@telemetry-tracker/core`
- ✓ **Next.js** — `@telemetry-tracker/next`
- ✓ **Node / NestJS** — `@telemetry-tracker/node`
- ✓ **Nuxt** — `@telemetry-tracker/core` ([guide](docs/sdk-nuxt.md))
- ✓ **React Native** — `@telemetry-tracker/react-native`
- ✓ **Vanilla JS** — `@telemetry-tracker/core`

Guides : [core](docs/sdk-core.md) · [Next.js](docs/sdk-next.md) · [Node](docs/sdk-node.md) · [NestJS](docs/sdk-nestjs.md) · [Vue](docs/sdk-vue.md) · [Nuxt](docs/sdk-nuxt.md) · [React Native](docs/sdk-react-native.md)

### Exemple

Installation depuis npm :

```bash
pnpm add @telemetry-tracker/core
```

```ts
import { init, trackEvent, trackError } from "@telemetry-tracker/core";

init({
  ingestUrl: "http://localhost:3001",
  app: "mon-app",
  apiKey: process.env.TELEMETRY_API_KEY!, // tt_live_… depuis le tableau de bord
  environment: "development",
});

trackEvent("utilisateur_inscrit");
trackError(new Error("Quelque chose s'est mal passé"));
```

---

## 🏗 Structure du projet

```
apps/
  api/          # API Fastify d'ingestion + lecture, Prisma, auth, facturation
  dashboard/    # Interface Next.js

packages/
  telemetry-core/
  telemetry-node/
  telemetry-next/
  telemetry-react-native/
  telemetry-vite-plugin/
```

---

## Construit avec

- [Next.js](https://nextjs.org/) — tableau de bord
- [Fastify](https://fastify.dev/) — API
- [Prisma](https://www.prisma.io/) — ORM & migrations
- [PostgreSQL](https://www.postgresql.org/) — base de données
- [TypeScript](https://www.typescriptlang.org/)
- [pnpm](https://pnpm.io/) — monorepo
- [Docker](https://www.docker.com/) — développement local (Postgres via `docker compose` ; image de production du tableau de bord)

---

## Feuille de route

Les fonctionnalités livrées sont dans **[Fonctionnalités](#fonctionnalités)** ci-dessus. Ce qui suit est un **travail planifié et exploratoire**—regroupé par domaine, pas un calendrier de publication. Les éléments marqués *Bientôt disponible* dans le tableau de bord correspondent à cette liste ([#96](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/96)).

| Statut | Signification |
|--------|---------|
| **Planifié** | Délimité ou suivi dans un ticket GitHub |
| **Exploration** | Étiqueté *Bientôt disponible* dans le produit ; calendrier et périmètre à déterminer |

<details>
<summary><strong>Planifié & exploration</strong> (9 domaines — Observabilité, Plateforme, Compte)</summary>

### Observabilité

| Domaine | Statut |
|------|--------|
| Traces | Exploration |
| Logs | Exploration |

### Plateforme

| Domaine | Statut |
|------|--------|
| Tableaux de bord personnalisés | Planifié |
| Feature flags | Exploration |
| Exportation de rapports | Exploration |

### Compte & organisation

| Domaine | Statut |
|------|--------|
| Journal d'audit d'équipe | Planifié |
| Intégrations | Exploration |
| Profil, préférences & sécurité | Exploration |

</details>

Vous avez une idée ? [Ouvrez une demande de fonctionnalité](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md).

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Lisez [CONTRIBUTING.md](CONTRIBUTING.md) pour la configuration locale et ce que CI exécute.

Bons points de départ :

- [**Bonnes premières issues**](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- Tickets [help wanted](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)

Veuillez suivre le [Code de conduite](CODE_OF_CONDUCT.md). Signalez les problèmes de sécurité en privé via [SECURITY.md](SECURITY.md)—pas dans les tickets publics.

---

## 📚 Documentation

| Sujet | Doc |
|-------|-----|
| Aperçu de l'architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Jalons de la feuille de route produit | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Règles d'alerte | [docs/ALERT-RULES.md](docs/ALERT-RULES.md) |
| Webhooks d'alerte / livraison | [docs/ALERT-WEBHOOKS.md](docs/ALERT-WEBHOOKS.md) |
| Déploiement (aperçu) | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Configuration Railway & dépannage | [docs/RAILWAY.md](docs/RAILWAY.md) |
| Stripe & Resend (optionnel) | [docs/BILLING.md](docs/BILLING.md) |
| Emails de mise à jour produit | [docs/MARKETING-EMAIL.md](docs/MARKETING-EMAIL.md) |
| Liste de contrôle de production | [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) |
| Versions & manuel de déploiement | [docs/RELEASE.md](docs/RELEASE.md) |
| Journal des modifications | [CHANGELOG.md](CHANGELOG.md) |
| RBAC & modèle d'organisation | [docs/RBAC.md](docs/RBAC.md) |
| Forfaits & auth d'ingestion | [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md) |
| Nettoyage des PII à l'ingestion | [docs/PII-SCRUBBING.md](docs/PII-SCRUBBING.md) |
| Guides SDK | [docs/sdk-core.md](docs/sdk-core.md), [docs/sdk-next.md](docs/sdk-next.md), [docs/sdk-node.md](docs/sdk-node.md), [docs/sdk-nestjs.md](docs/sdk-nestjs.md), [docs/sdk-vue.md](docs/sdk-vue.md), [docs/sdk-nuxt.md](docs/sdk-nuxt.md), [docs/sdk-react-native.md](docs/sdk-react-native.md) |
| Source maps | [docs/source-maps.md](docs/source-maps.md) |

**Publier les packages SDK :** `npm login` → `pnpm publish:packages` (voir [CONTRIBUTING.md](CONTRIBUTING.md) et les scripts dans le `package.json` racine).

**Aperçu social GitHub :** Dans le dépôt **Paramètres → Général → Aperçu social**, utilisez `https://telemetry-tracker.com/og-banner.png` (bannière marketing 1024×409) une fois le tableau de bord déployé. Chemin d'installation pour la documentation et le marketing : `@telemetry-tracker/core` (voir les badges npm ci-dessus).

---

## ❤️ Soutenir le projet

Si vous trouvez Telemetry Tracker utile :

- ⭐ Mettez une étoile sur ce dépôt
- 🐛 [Signalez des bugs](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=bug_report.md)
- 💡 [Suggérez des fonctionnalités](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md)
- 🤝 Ouvrez une pull request contre **`develop`** ([CONTRIBUTING.md](CONTRIBUTING.md))

---

## 📄 Licence, marque commerciale & hébergement

### Logiciel (MIT)

Le **code source** de ce projet est sous licence [MIT License](LICENSE). Vous pouvez utiliser, modifier, auto-héberger et distribuer le logiciel selon ces conditions, y compris la mention de copyright dans les copies que vous distribuez.

La licence MIT couvre le **copyright sur le code**. Elle n'accorde pas de droits pour utiliser le nom **Telemetry Tracker** ou l'image de marque de manière à suggérer que Tacko exploite ou approuve votre service. Voir [TRADEMARK.md](TRADEMARK.md).

### Auto-hébergement

Vous pouvez exécuter Telemetry Tracker sur une infrastructure que vous contrôlez pour vos propres applications—aucune permission supplémentaire requise sous la licence MIT.

### Cloud officiel hébergé

Le **service managé** sur [telemetry-tracker.com](https://telemetry-tracker.com) est opéré par [Tacko](https://tacko.io). Les forfaits **Pro** et **Business** y sont facturés en **EUR** via Stripe.

### Marque & services hébergés concurrents

N'offrez pas de service hébergé multi-tenant **à des tiers** utilisant le nom **Telemetry Tracker**, le logo ou le marketing comme s'il s'agissait du produit officiel. Les forks et les déploiements internes doivent utiliser un **nom distinct** sauf si vous avez une autorisation écrite de Tacko.

Détails et exemples : **[TRADEMARK.md](TRADEMARK.md)** · Partenariats : [info@tacko.io](mailto:info@tacko.io)

## Contribuer

<!-- gfi-323 -->
Merci d'envisager une contribution ! Voir les tickets ouverts étiquetés `good first issue`.