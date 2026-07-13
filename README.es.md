🇩🇪 Deutsch: [README.de.md](README.de.md)
🇬🇧 English: [README.md](README.md)
# Telemetry Tracker

![License](https://img.shields.io/github/license/Telemetry-Tracker/telemetry-tracker)
![GitHub Stars](https://img.shields.io/github/stars/Telemetry-Tracker/telemetry-tracker)
![GitHub Issues](https://img.shields.io/github/issues/Telemetry-Tracker/telemetry-tracker)
![CI](https://github.com/Telemetry-Tracker/telemetry-tracker/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
[![npm version](https://img.shields.io/npm/v/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)
[![npm downloads](https://img.shields.io/npm/dm/@telemetry-tracker/core)](https://www.npmjs.com/package/@telemetry-tracker/core)

<p align="center">
  <strong>Seguimiento de errores, análisis de productos y telemetría de sesiones open-source.</strong>
</p>

<p align="center">
  Ligero y autoalojable en tu propia infraestructura, o usa la <strong>nube oficial alojada</strong> en
  <a href="https://telemetry-tracker.com">telemetry-tracker.com</a> con facturación mediante Stripe (EUR).
</p>

<p align="center">
  <a href="https://telemetry-tracker.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-dashboard-dark.png" />
      <img src="apps/dashboard/public/screenshot-dashboard-light.png" alt="Vista general del panel con errores, eventos, sesiones y métricas de rendimiento" width="920" />
    </picture>
  </a>
</p>

<p align="center">
  <sub><strong>Visión general</strong> — Tarjetas KPI, tendencias de eventos, principales errores, releases y métricas de rendimiento (claro/oscuro).</sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/screenshot-errors-dark.png" />
    <img src="apps/dashboard/public/screenshot-errors-light.png" alt="Página de errores con KPIs, tendencias, tipos de error principales y tabla de errores agrupados" width="920" />
  </picture>
</p>

<p align="center">
  <sub><strong>Errores</strong> — KPIs, tendencias por tipo, principales errores y tabla de errores agrupados con filtros (claro/oscuro).</sub>
</p>

---

## Características

| Característica | Soportado |
|----------------|-----------|
| Errores | ✅ |
| Eventos | ✅ |
| Sesiones | ✅ |
| Organizaciones | ✅ |
| Proyectos | ✅ |
| API keys | ✅ |
| Panel | ✅ |
| API REST | ✅ |
| SDKs (@telemetry-tracker/*) | ✅ |
| Autoalojado | ✅ |
| Nube alojada ([telemetry-tracker.com](https://telemetry-tracker.com)) | ✅ |
| Planes de pago (Gratis / Pro / Business, EUR mediante Stripe) | ✅ |
| Alertas | ✅ |
| Source maps | ✅ |

Configuración autoalojada: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## ¿Por qué Telemetry Tracker?

Telemetry Tracker proporciona los bloques fundamentales que la mayoría de las aplicaciones necesitan—seguimiento de errores, eventos de análisis de productos y telemetría de sesiones—sin la complejidad de las plataformas de observabilidad empresariales.

- Autoalojable para tus propios productos
- Nube oficial alojada con facturación en EUR
- Ligero
- APIs simples
- Open source ([MIT](LICENSE))
- Fácil de desplegar ([DEPLOYMENT.md](DEPLOYMENT.md))

---

## Arquitectura

```
Client SDK
    ↓  ingest (API key)
   API  ←──  Dashboard (session auth)
    ↓
 PostgreSQL
```

Las apps envían errores, eventos y sesiones a la API a través de @telemetry-tracker/*. El dashboard lee la telemetría a través de la misma API, nunca directamente desde la base de datos.

---

## 🚀 Inicio rápido

Pon en marcha Telemetry Tracker localmente en menos de 5 minutos.

**Requisitos previos:** Node.js 18+, pnpm 9, PostgreSQL 16 (Docker funciona).

```bash
git clone https://github.com/Telemetry-Tracker/telemetry-tracker.git
cd telemetry-tracker
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
pnpm db:migrate
```

En dos terminales:

```bash
pnpm dev:api        # API → http://localhost:3001
pnpm dev:dashboard  # Dashboard → http://localhost:3000
```

Luego:

1. Abre http://localhost:3000, haz clic en Start tracking y crea una cuenta.
2. Crea una organización y un proyecto en los ajustes de Organización.
3. Crea una clave de API en Configuración → Claves de API (copia el secreto tt_live_… una vez que se muestre).
4. Instrumenta tu aplicación (consulta el ejemplo del SDK más abajo) y revisa el panel Overview en el dashboard.

---

## SDK

Funciona con:

- ✓ React / Vue — @telemetry-tracker/core
- ✓ Next.js — @telemetry-tracker/next
- ✓ Node / NestJS — @telemetry-tracker/node
- ✓ Nuxt — @telemetry-tracker/core (guía: docs/sdk-nuxt.md)
- ✓ React Native — @telemetry-tracker/react-native
- ✓ Vanilla JS — @telemetry-tracker/core

Guías: core (docs/sdk-core.md) · Next.js (docs/sdk-next.md) · Node (docs/sdk-node.md) · NestJS (docs/sdk-nestjs.md) · Vue (docs/sdk-vue.md) · Nuxt (docs/sdk-nuxt.md) · React Native (docs/sdk-react-native.md)

### Ejemplo

Instalación desde npm:

```bash
pnpm add @telemetry-tracker/core
```

```ts
import { init, trackEvent, trackError } from "@telemetry-tracker/core";

init({
  ingestUrl: "http://localhost:3001",
  app: "my-app",
  apiKey: process.env.TELEMETRY_API_KEY!, // tt_live_… del dashboard
  environment: "development",
});

trackEvent("user_registered");
trackError(new Error("Algo falló"));
```

---

## 🏗 Estructura del Proyecto

```
apps/
  api/          # API de ingesta + lectura con Fastify, Prisma, autenticación, facturación
  dashboard/    # Interfaz de usuario con Next.js

packages/
  telemetry-core/
  telemetry-node/
  telemetry-next/
  telemetry-react-native/
  telemetry-vite-plugin/
```

---

## Construido con

- Next.js — dashboard
- Fastify — API
- Prisma — ORM y migraciones
- PostgreSQL — base de datos
- TypeScript
- pnpm — monorepo
- Docker — desarrollo local (Postgres mediante docker compose; imagen de producción del dashboard)

---

## Hoja de ruta

Las funcionalidades ya implementadas se encuentran en **[Características](#características)** más arriba. A continuación se detalla el trabajo **planificado y en exploración** — agrupado por área, no por calendario de lanzamiento. Los elementos marcados como *Próximamente* en el dashboard coinciden con esta lista ([#96](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/96)).

| Estado | Significado |
|--------|-------------|
| **Planificado** | Definido o registrado en un issue de GitHub |
| **En exploración** | Etiquetado como *Próximamente* en el producto; fecha y alcance por definir |

<details>
<summary><strong>Planificado y en exploración</strong> (11 áreas — Observabilidad, Plataforma, Cuenta)</summary>

### Observabilidad

| Área | Estado |
|------|--------|
| Rendimiento / Web Vitals | Planificado |
| Trazas | En exploración |
| Logs | En exploración |

### Plataforma

| Área | Estado |
|------|--------|
| Paneles personalizados | Planificado |
| Lanzamientos | En exploración |
| Feature flags | En exploración |
| Exportar informes | En exploración |

### Cuenta y organización

| Área | Estado |
|------|--------|
| Registro de auditoría del equipo | Planificado |
| Integraciones | En exploración |
| Perfil, preferencias y seguridad | En exploración |

</details>

¿Tienes una idea? [Abre una solicitud de funcionalidad](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md).

---

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) para conocer la configuración local y lo que ejecuta CI.

Buenos puntos para empezar:

- [**Buenos primeros issues**](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- Issues con etiqueta [help wanted](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)

Por favor, sigue el [Código de Conducta](CODE_OF_CONDUCT.md). Reporta problemas de seguridad en privado a través de [SECURITY.md](SECURITY.md) — no en issues públicos.

---

## 📚 Documentación

| Tema | Documento |
|------|-----------|
| Descripción general de la arquitectura | docs/ARCHITECTURE.md |
| Despliegue (visión general) | DEPLOYMENT.md |
| Configuración y solución de problemas en Railway | docs/RAILWAY.md |
| Stripe y Resend (opcional) | docs/BILLING.md |
| Lista de verificación para producción | docs/PRODUCTION-READINESS.md |
| Lanzamientos y runbook de despliegue | docs/RELEASE.md |
| Registro de cambios | CHANGELOG.md |
| RBAC y modelo de organización | docs/RBAC.md |
| Planes y autenticación de ingesta | docs/ENTITLEMENTS.md |
| Guías del SDK | docs/sdk-core.md, docs/sdk-next.md, docs/sdk-node.md, docs/sdk-nestjs.md, docs/sdk-vue.md, docs/sdk-nuxt.md, docs/sdk-react-native.md |
| Source maps | docs/source-maps.md |

**Publicar paquetes del SDK:** `npm login` → `pnpm publish:packages` (consulta CONTRIBUTING.md y los scripts en package.json de la raíz).

**Vista previa social en GitHub:** En el repositorio, ve a **Settings → General → Social preview** y usa `https://telemetry-tracker.com/og-banner.png` (banner marketing de 1024×409) una vez que el dashboard esté desplegado. Ruta de instalación para documentación y marketing: `@telemetry-tracker/core` (consulta las insignias de npm más arriba).

---

## ❤️ Apoya el Proyecto

Si Telemetry Tracker te resulta útil:

- ⭐ Dale una estrella a este repositorio
- 🐛 [Reporta errores](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=bug_report.md)
- 💡 [Sugiere funcionalidades](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new?template=feature_request.md)
- 🤝 Abre una pull request contra la rama **`develop`** (consulta CONTRIBUTING.md)

---

## 📄 Licencia, marca registrada y alojamiento

### Software (MIT)

El **código fuente** de este proyecto está bajo la licencia [MIT License](LICENSE). Puedes usar, modificar, alojar por tu cuenta y distribuir el software según esos términos, incluyendo el aviso de copyright en las copias que distribuyas.

MIT cubre los **derechos de autor sobre el código**. No otorga derechos para usar el nombre **Telemetry Tracker** o su marca de forma que sugiera que Tacko opera o respalda tu servicio. Consulta TRADEMARK.md.

### Autoalojamiento

Puedes ejecutar Telemetry Tracker en infraestructura que controles para tus propias aplicaciones — no se necesita permiso adicional bajo MIT.

### Nube alojada oficial

El **servicio gestionado** en telemetry-tracker.com es operado por Tacko. Los planes **Pro** y **Business** allí se facturan en **EUR** a través de Stripe.

### Marca y servicios alojados competidores

No ofrezcas un servicio alojado multiinquilino **a terceros** utilizando el nombre **Telemetry Tracker**, su logotipo o marketing como si fuera el producto oficial. Los forks y despliegues internos deben usar un **nombre distinto** a menos que tengas permiso por escrito de Tacko.

Detalles y ejemplos: TRADEMARK.md · Alianzas: info@tacko.io
