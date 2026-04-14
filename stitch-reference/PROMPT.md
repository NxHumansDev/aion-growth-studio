# Prompt para Claude Code: Implementar plataforma AION Growth Studio — Fases 1 y 2

## Contexto

Necesito que construyas la plataforma cliente de AION Growth Studio en Astro SSR + Tailwind CSS. Tengo el diseño de UI generado en Google Stitch con HTML de referencia exacto para cada pantalla. Tu trabajo es traducir cada HTML estático de Stitch a componentes Astro dinámicos con fidelidad visual exacta.

**En la carpeta `stitch-reference/` tienes 10 HTMLs + screenshots + DESIGN.md.** Cada HTML es la referencia exacta para una página. Copia la estructura, las clases Tailwind, los componentes y el layout de cada HTML — NO inventes diseño propio.

### Mapeo de archivos Stitch → Páginas Astro

| Archivo Stitch | Página Astro | Ruta |
|---|---|---|
| `01-home-overview.html` + `.png` | `pages/dashboard/index.astro` | `/dashboard` |
| `02-monthly-report.html` + `.png` | `pages/dashboard/report/[month].astro` | `/dashboard/report/mayo-2026` |
| `03-evolution.html` + `.png` | `pages/dashboard/evolution.astro` | `/dashboard/evolution` |
| `04-alerts.html` + `.png` | `pages/dashboard/alerts.astro` | `/dashboard/alerts` |
| `05-onboarding-ga4.html` + `.png` | `pages/dashboard/onboarding.astro` | `/dashboard/onboarding` |
| `06-paid-intelligence.html` + `.png` | `pages/dashboard/paid.astro` | `/dashboard/paid` |
| `07-content-briefs.html` + `.png` | `pages/dashboard/briefs.astro` | `/dashboard/briefs` |
| `08-seo-opportunities.html` + `.png` | `pages/dashboard/seo-opportunities.astro` | `/dashboard/seo-opportunities` |
| `09-advisor-chat.html` + `.png` | `pages/advisor/index.astro` | `/advisor` (ruta interna) |
| `10-subscription.html` + `.png` | `pages/dashboard/subscription.astro` | `/dashboard/subscription` |
| `DESIGN.md` | `tailwind.config.mjs` + guía de diseño | — |

### Cómo usar los HTMLs de referencia

Para CADA página:
1. Abre el HTML de Stitch correspondiente
2. Extrae la **sidebar** como componente compartido (`Sidebar.astro`) — es la misma en todos
3. Extrae el **top bar / header** como componente compartido (`TopBar.astro`)
4. El **contenido principal** (todo lo que está dentro del `<main>`) se convierte en el contenido de la página Astro
5. Convierte los datos hardcodeados del HTML en **props dinámicos** que vienen de Supabase
6. Mantén las **clases Tailwind exactas** del HTML de Stitch — no cambies los tamaños, colores, spacing ni border-radius
7. Convierte los **iconos Material Symbols** tal cual están (con data-icon y font-variation-settings)

El stack es:
- **Frontend:** Astro SSR + Tailwind CSS (ya existente — el informe de diagnóstico gratuito ya está construido)
- **Backend:** API routes en Astro (Vercel serverless)
- **Base de datos:** Supabase (Postgres + Auth)
- **Pagos:** Stripe (suscripciones + webhooks + Customer Portal)
- **Iconos:** Google Material Symbols Outlined (ya en los HTMLs de Stitch)
- **Font:** Inter (ya en los HTMLs de Stitch)
- **Deploy:** Vercel

---

## SISTEMA DE DISEÑO — Extraído de Stitch (DESIGN.md)

### Filosofía: "The Digital Curator"
El diseño NO es un dashboard genérico. Es una experiencia editorial donde el whitespace es un elemento estructural. Rechaza el "flat box epidemic" — usa contraste de superficies en vez de bordes.

### Regla crítica: NO BORDERS para separar secciones
Los bordes de 1px están prohibidos para separación estructural. La jerarquía visual se consigue con capas de fondo:
- Base (canvas): `#fcf8ff` (surface)
- Sección: `#f5f2ff` (surface-container-low) — para agrupar bloques
- Card/acción: `#ffffff` (surface-container-lowest) — para cards interactivas
- Hover/activo: `#e8e5ff` (surface-container-high) — para estados

### Paleta de colores (Tailwind config)
Copia este objeto EXACTO en tu `tailwind.config.mjs`:

```javascript
colors: {
  "on-surface": "#1a1a2e",
  "outline-variant": "#c3c6d2",
  "outline": "#737781",
  "inverse-primary": "#aac7ff",
  "on-primary-fixed": "#001b3e",
  "surface-variant": "#e2e0fc",
  "surface-bright": "#fcf8ff",
  "on-background": "#1a1a2e",
  "background": "#fcf8ff",
  "surface-tint": "#325ea0",
  "surface-container-high": "#e8e5ff",
  "primary-fixed": "#d6e3ff",
  "on-primary-fixed-variant": "#124687",
  "surface": "#fcf8ff",
  "on-secondary-fixed-variant": "#00458f",
  "on-secondary-fixed": "#001b3f",
  "surface-dim": "#dad7f3",
  "secondary": "#205db0",
  "on-surface-variant": "#434750",
  "surface-container-lowest": "#ffffff",
  "on-primary-container": "#99bdff",
  "surface-container-low": "#f5f2ff",
  "secondary-fixed-dim": "#abc7ff",
  "on-secondary-container": "#003a7a",
  "on-primary": "#ffffff",
  "surface-container-highest": "#e2e0fc",
  "error-container": "#ffdad6",
  "primary": "#00346d",
  "error": "#ba1a1a",
  "primary-container": "#1a4b8c",
  "surface-container": "#efecff",
  "on-secondary": "#ffffff",
  "inverse-surface": "#2f2e43",
  "on-error": "#ffffff",
  "secondary-fixed": "#d7e3ff",
  "secondary-container": "#73a6fe",
  "primary-fixed-dim": "#aac7ff",
  // Colores funcionales adicionales
  "green": "#1d9e75",
  "amber": "#ba7517",
  "coral": "#d85a30",
}
```

### Tipografía
- Font: Inter, importada via Google Fonts (weights 300-900)
- Display (scores, números grandes): `text-5xl font-black tracking-tighter`
- Headlines (títulos de sección): `text-lg font-black tracking-tight`
- Labels (categorías): `text-[11px] font-bold uppercase tracking-widest text-on-surface-variant`
- Body: `text-sm text-on-surface-variant`
- Micro text: `text-[10px] text-slate-400`

### Iconos
Google Material Symbols Outlined. Importar:
```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
```
Uso: `<span class="material-symbols-outlined">icon_name</span>`
Para iconos rellenos: añadir `style="font-variation-settings: 'FILL' 1;"`

### Componentes clave del diseño

**Sidebar (fija, 256px):**
- Fondo: `bg-[#1a1a2e]` — SIN borde derecho, la separación es por contraste de color
- Logo + nombre arriba: `text-lg font-bold tracking-tighter text-white`
- Items de nav: `flex items-center gap-3 px-4 py-3 text-slate-400` con hover `hover:text-white hover:bg-slate-800/50`
- Item activo: `text-white bg-blue-600/10 border-r-4 border-blue-500 font-semibold`
- Items bloqueados (tier superior): `opacity-40` + badge `text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded`
- Separadores de grupo: `text-[10px] text-slate-500 uppercase tracking-widest font-bold px-4 pt-8 pb-2`
- User card abajo: `rounded-xl bg-slate-900 border border-slate-800 p-4`

**Metric cards:**
- Container: `bg-surface-container-lowest p-6 rounded-xl shadow-sm` (SIN border)
- Label: `text-[11px] font-bold uppercase tracking-widest text-on-surface-variant`
- Valor: `text-5xl font-black tracking-tighter text-on-surface`
- Delta positivo: `text-green-600 font-bold text-sm` con icono `trending_up`
- Delta negativo: `text-error font-bold text-sm` con icono `trending_down`
- Badge de fuente: `px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed text-[10px] font-bold`

**Alert cards:**
- Container: `flex gap-4 p-4 rounded-lg bg-surface-container-lowest shadow-sm`
- Dot de severidad: `w-2 h-2 rounded-full shrink-0 mt-1.5` + `bg-error` / `bg-amber-500` / `bg-green-500`
- Título: `text-xs font-bold text-on-surface`
- Descripción: `text-[11px] text-on-surface-variant`
- Timestamp: `text-[10px] text-slate-400 font-medium`

**Action items del plan:**
- Completada: icono `check_circle` verde filled + texto `line-through opacity-50`
- En progreso: círculo con dot ámbar + texto `font-bold` + fondo `bg-surface-container-low ring-1 ring-primary/10`
- Pendiente: icono `radio_button_unchecked` gris + texto normal
- Badge impacto: `px-2 py-0.5 rounded-full text-[10px] font-bold` — alto: `bg-primary-fixed text-on-primary-fixed-variant`, medio: `bg-surface-container-high text-on-surface-variant`

**Card de próxima revisión:**
- Fondo oscuro: `bg-on-surface text-white rounded-2xl p-6 shadow-xl`
- Fecha: card interna `bg-white/10 p-4 rounded-xl`

**Callouts de upsell:**
- Ámbar (→ Señales): `background-color: #FAEEDA; border-left: 3px solid #f59e0b; font-size: 12px;`
- Violeta (→ Palancas): `background-color: #EEEDFE; border-left: 3px solid #534AB7; font-size: 12px;`

---

## ESTRUCTURA DE ARCHIVOS A CREAR

```
src/
├── layouts/
│   └── DashboardLayout.astro      # Shell: sidebar + header + contenido principal
├── components/
│   ├── dashboard/
│   │   ├── Sidebar.astro           # Sidebar de navegación con lógica de tier
│   │   ├── TopBar.astro            # Header con nombre empresa + tier + fecha
│   │   ├── MetricCard.astro        # Card de métrica reutilizable
│   │   ├── AlertCard.astro         # Card de alerta
│   │   ├── ActionItem.astro        # Item del plan de acción
│   │   ├── NextReviewCard.astro    # Card de próxima revisión
│   │   ├── SparkLine.astro         # Mini sparkline SVG
│   │   ├── UpsellCallout.astro     # Callout de upsell por tier
│   │   ├── TierGate.astro          # Wrapper que bloquea contenido por tier
│   │   └── StatusBadge.astro       # Badge de estado (bien/medio/mal)
│   └── charts/
│       ├── ScoreGauge.astro        # Gauge semicircular del score
│       ├── GEOProgressBar.astro    # Barras de progreso GEO (2/15)
│       ├── EvolutionLine.astro     # Gráfico de línea de evolución (SVG)
│       ├── ChannelBars.astro       # Barras horizontales de canales
│       └── CompetitorTable.astro   # Tabla comparativa benchmark
├── pages/
│   ├── dashboard/
│   │   ├── index.astro             # Home / Resumen (Overview)
│   │   ├── report/
│   │   │   └── [month].astro       # Informe mensual por mes
│   │   ├── evolution.astro         # Vista de evolución histórica
│   │   ├── competitors.astro       # Benchmark competitivo
│   │   ├── alerts.astro            # Feed de alertas (Señales)
│   │   ├── seo-opportunities.astro # Keyword gap (Señales)
│   │   ├── paid.astro              # Paid intelligence (Señales)
│   │   ├── briefs.astro            # Content briefs (Señales)
│   │   ├── settings.astro          # Ajustes + conexiones
│   │   ├── subscription.astro      # Plan + comparativa + equipo
│   │   └── onboarding.astro        # Wizard de onboarding (3 pasos)
│   └── api/
│       ├── auth/
│       │   ├── login.ts            # Supabase auth
│       │   └── callback.ts         # OAuth callback
│       ├── stripe/
│       │   └── webhook.ts          # Stripe webhook handler
│       └── dashboard/
│           ├── overview.ts         # Datos para el home
│           ├── report/[month].ts   # Datos del informe mensual
│           └── alerts.ts           # Datos de alertas
```

---

## LÓGICA DE TIERS — Qué ve cada cliente

El tier del cliente se almacena en la tabla `clients` de Supabase. Cada página y componente verifica el tier antes de renderizar.

### Componente TierGate.astro
```astro
---
interface Props {
  requiredTier: 'radar' | 'señales' | 'palancas';
  currentTier: 'radar' | 'señales' | 'palancas';
  tierLabel?: string;
}

const { requiredTier, currentTier, tierLabel } = Astro.props;

const tierOrder = { radar: 1, señales: 2, palancas: 3 };
const hasAccess = tierOrder[currentTier] >= tierOrder[requiredTier];
---

{hasAccess ? (
  <slot />
) : (
  <div class="relative">
    <div class="opacity-30 pointer-events-none select-none blur-[1px]">
      <slot name="preview" />
    </div>
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="bg-surface-container-lowest/90 backdrop-blur-sm px-6 py-4 rounded-xl text-center max-w-sm">
        <p class="text-sm font-bold text-on-surface">Disponible en {tierLabel || requiredTier}</p>
        <p class="text-xs text-on-surface-variant mt-1">Mejora tu plan para acceder a esta funcionalidad</p>
      </div>
    </div>
  </div>
)}
```

### Sidebar — Items por tier
```
SIEMPRE VISIBLE (Radar):
  Overview          /dashboard
  Monthly Report    /dashboard/report/[month]
  Evolution         /dashboard/evolution
  Competitors       /dashboard/competitors

SEÑALES (gris + opacity-40 + badge "Señales" si Radar):
  Alerts            /dashboard/alerts
  SEO Opportunities /dashboard/seo-opportunities
  Paid Intelligence /dashboard/paid
  Content Briefs    /dashboard/briefs

PALANCAS (gris + opacity-40 + badge "Palancas" si Radar o Señales):
  Technical Optimization   (no implementado en Fase 2 — link disabled)
  Content Generator        (no implementado en Fase 2 — link disabled)
  Schema Markup            (no implementado en Fase 2 — link disabled)

SIEMPRE VISIBLE (abajo):
  Settings          /dashboard/settings
  Subscription      /dashboard/subscription
```

Los items bloqueados:
- Se VEN en la sidebar (no desaparecen)
- Tienen `opacity-40` y `pointer-events-none`
- Muestran un badge con el nombre del tier requerido
- Si el cliente hace click (por accesibilidad), redirige a `/dashboard/subscription`

---

## GRÁFICOS — Todos dinámicos con datos reales

TODAS las gráficas del diseño de Stitch son estáticas/decorativas. En la implementación real, CADA gráfica debe construirse programáticamente con datos del snapshot.

### Gráficos a implementar:

**1. Mini sparkline (en metric card de visitas):**
SVG inline, 80x20px. Recibe un array de valores (últimos 6 meses). Dibuja una polyline con stroke `#325ea0` (surface-tint) y fill suave debajo.
```astro
---
interface Props { values: number[]; width?: number; height?: number; }
const { values, width = 80, height = 20 } = Astro.props;
const max = Math.max(...values);
const min = Math.min(...values);
const points = values.map((v, i) => {
  const x = (i / (values.length - 1)) * width;
  const y = height - ((v - min) / (max - min || 1)) * height;
  return `${x},${y}`;
}).join(' ');
---
<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
  <polyline points={points} fill="none" stroke="#325ea0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

**2. GEO progress bar (2/15):**
Barras segmentadas como en el diseño: N barras rellenas (primary) + resto vacías (surface-container-high). Recibe `current` y `total`.

**3. Score gauge (para la pantalla de evolución):**
Gauge semicircular SVG, mismo componente que el del informe de diagnóstico.

**4. Barras de canal de tráfico (informe mensual):**
Barras horizontales SVG. Recibe array de `{label, value, color}`.

**5. Gráfico de evolución del score (pantalla Evolución):**
Línea SVG con puntos clickeables. Recibe array de `{month, score}`. Cada punto muestra el valor al hover.

**6. Gráficos del informe mensual:**
Todos los gráficos del informe (benchmark, keyword gap, etc.) se generan con datos del snapshot. NUNCA hardcodeados.

---

## PÁGINAS A IMPLEMENTAR — Fase 1 y 2

### Página 1: Overview (Home) — `/dashboard`
ES LA PANTALLA MÁS IMPORTANTE. Replica EXACTAMENTE el diseño de la captura de Stitch.

Layout (de arriba a abajo):
1. TopBar: nombre empresa + dominio + badge tier + "Last Report: [mes año]"
2. 3 metric cards en grid: Score + Visitas + GEO — cada una con datos del último snapshot
3. Grid 4+8 columnas: Alertas activas (4 cols) + Plan de acción (8 cols)
4. Card de próxima revisión (centrada, fondo oscuro)

Datos: vienen del último snapshot del cliente (tabla `snapshots` de Supabase).

Alertas: si el cliente es Radar, mostrar 2-3 alertas como preview con blur + callout "Disponible en Señales". Si es Señales+, mostrar las 3-5 alertas más recientes de la tabla `alerts`.

Plan de acción: viene del campo `actions` del snapshot + la tabla `context_entries` para saber qué acciones están completadas/en progreso.

### Página 2: Informe mensual — `/dashboard/report/[month]`
El informe completo de 5 bloques renderizado dentro del shell del dashboard.

Header de la página:
- Breadcrumb: "Dashboard > Informes > Mayo 2026"
- Dropdown selector de mes (lista de snapshots disponibles)
- Botones: "Exportar PDF" + "Exportar PPT" (PPT solo si tier >= Señales, sino botón gris con tooltip)

El informe se renderiza debajo — es la MISMA página del informe de diagnóstico que ya tienes, pero embebida en el DashboardLayout en vez de renderizarse standalone. La diferencia es que en la versión de pago:
- Cada metric card muestra delta vs mes anterior
- El plan de acción muestra el estado de cada acción (completada/progreso/pendiente)
- Los callouts de upsell aparecen según el tier del cliente

### Página 3: Evolución — `/dashboard/evolution`
Vista histórica. Datos de todos los snapshots del cliente.

- Gráfico de línea del score (SVG, últimos 6-12 meses)
- Grid 3x2 de sub-scores con sparklines
- Timeline de hitos (acciones implementadas con fecha, de `context_entries`)
- Tabla mes a mes con colores de semáforo para variaciones

### Página 4: Competidores — `/dashboard/competitors`
Benchmark competitivo con los competidores fijos del perfil (Capa 1).
- Tabla comparativa con datos del último snapshot + datos de competidores
- Cards por dimensión con frase narrativa

### Página 5: Alertas — `/dashboard/alerts` (SOLO Señales+)
Si el cliente es Radar: redirigir a `/dashboard/subscription` o mostrar preview con TierGate.

- Filtros por categoría (pills)
- Feed de alertas de la tabla `alerts`
- Click para expandir con detalle

### Página 6: Suscripción — `/dashboard/subscription`
- Card del plan actual con botón "Gestionar" (abre Stripe Customer Portal)
- Comparativa 3 tiers con precios (149/349/699€) y features
- Sección equipo (lista de users + invitar)

### Página 7: Onboarding — `/dashboard/onboarding`
Wizard de 3 pasos (Conectar → Verificar → Activar). Se muestra la primera vez que el cliente entra después de pagar.
- Paso 1: Cards de conexión OAuth (GA4, Google Ads, Meta Ads)
- Paso 2: Auditoría GA4 (10 checks con resultado en tiempo real)
- Paso 3: Confirmación + "Generar mi primer informe"

### Página 8: Settings — `/dashboard/settings`
- Conexiones (APIs): estado + reconectar/desconectar
- Perfil de la empresa (dominio, sector, objetivo — read-only excepto notas)

---

## AUTH Y MIDDLEWARE

### Supabase Auth
- Login por magic link (email) o Google OAuth
- Después del login, verificar que el user tiene un `clientId` asociado en la tabla `users`
- Si no tiene clientId (nuevo usuario), redirigir a `/dashboard/onboarding`

### Middleware de Astro (`src/middleware.ts`)
```typescript
// Todas las rutas /dashboard/* requieren auth
// Verificar sesión de Supabase
// Cargar client data (tier, domain, name) y adjuntar a locals
// Verificar tier para rutas protegidas (alerts, seo-opportunities, paid, briefs)
```

---

## FLUJO COMPLETO: Del diagnóstico gratuito a la plataforma de cliente

El cliente llega a AION, hace un diagnóstico gratuito (que ya está montado), y al final del informe hay un CTA que le lleva al onboarding de la plataforma de pago.

### Paso 1 — El diagnóstico gratuito (YA EXISTE)
El cliente introduce su URL, recibe el informe de 5 bloques. Al final del informe (bloque 5, plan de acción) hay un CTA:

**Card de conversión a añadir al final del informe existente:**
```
Card con borde 2px solid #4A7FD4, border-radius 12px, padding 24px, centrada:
  Título: "¿Quieres que monitorizemos esto cada mes?"
  Subtítulo: "Conecta tus herramientas, elige tu plan, y recibe cada mes este análisis 
  actualizado con datos reales, tendencias y un plan de acción priorizado."
  Botón primario: "Empezar ahora →" → link a /dashboard/onboarding
  Nota debajo en 11px: "Sin compromiso. Puedes cancelar en cualquier momento."
```

Adicionalmente, los callouts de transparencia que ya existen en el informe ("Para datos reales → Radar") deben llevar un link a `/dashboard/onboarding`.

### Paso 2 — Selección de plan (/dashboard/onboarding — paso 0)
ANTES del wizard de conexión GA4, el cliente ve la selección de plan. Es la comparativa de 3 tiers (igual que en `10-subscription.html`) pero como primer paso del onboarding.

Layout:
- Título: "Elige tu plan"
- 3 columnas con los tiers (Radar 149€, Señales 349€, Palancas 699€)
- Botón "Seleccionar" en cada tier
- Al seleccionar → se guarda el tier elegido y pasa al paso 1 (conectar APIs)

### Paso 3 — Wizard de onboarding (3 pasos)
Ya especificado en la pantalla 05-onboarding-ga4.html:
1. Conectar APIs (GA4, Google Ads, Meta Ads)
2. Verificar GA4 (10 checks)
3. Activar → genera primer informe

### Paso 4 — Dashboard
Al completar el onboarding, el cliente entra logado en `/dashboard` y ve el Overview con sus datos.

### Transición visual
El informe gratuito tiene el estilo visual del informe (fondo claro, sin sidebar). La plataforma de pago tiene el estilo del dashboard (sidebar dark, layout de Stitch). La transición se hace con la pantalla de onboarding, que ya tiene el shell del dashboard.

---

## PASARELA DE PAGO — MODO DEMO (Stripe NO configurado)

**IMPORTANTE: NO configurar Stripe real todavía.** La plataforma debe funcionar completa sin pasarela de pago real. Todo el flujo de pago es fake/simulado para poder probar la UX completa sin darse de alta en ningún servicio.

### Cómo implementar el modo demo:

**Selección de plan:** El botón "Seleccionar" en el onboarding simplemente guarda el tier en la base de datos local (o en memoria/cookie si Supabase tampoco está configurado). No hay checkout real.

**Página de suscripción:** El botón "Gestionar suscripción" muestra un toast/alert: "Stripe no configurado — modo demo activo". La comparativa de tiers funciona pero los botones de upgrade hacen lo mismo: cambian el tier en la DB directamente.

**Cambio de tier para testing:** En la página de Settings, añadir un selector visible (SOLO en modo demo) que permita cambiar el tier del cliente entre Radar/Señales/Palancas instantáneamente. Esto permite probar cómo se ve cada tier sin flujo de pago real.

```astro
<!-- Solo visible en modo demo -->
{import.meta.env.DEV && (
  <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
    <p class="text-sm font-bold text-amber-800">Modo demo — Cambiar tier para testing</p>
    <div class="flex gap-2 mt-2">
      <button onclick="setTier('radar')" class="px-3 py-1 rounded text-xs font-bold bg-amber-100">Radar</button>
      <button onclick="setTier('señales')" class="px-3 py-1 rounded text-xs font-bold bg-blue-100">Señales</button>
      <button onclick="setTier('palancas')" class="px-3 py-1 rounded text-xs font-bold bg-purple-100">Palancas</button>
    </div>
  </div>
)}
```

**Stripe preparado pero no activo:** Deja los archivos de webhook y la lógica de Stripe como código comentado con `// TODO: Activar cuando Stripe esté configurado`. La tabla `clients` mantiene los campos `stripe_customer_id` y `stripe_subscription_id` como nullable.

---

## MODO DEMO GLOBAL — Probar todo sin sistemas externos

La plataforma debe poder ejecutarse y probarse SIN necesidad de:
- Supabase configurado (usar datos mock en memoria)
- Stripe configurado (flujo fake como arriba)
- OAuth de GA4/Meta/Google Ads (botones de conectar muestran "Conectado (demo)")

### Implementación del modo demo:

Crear un archivo `src/lib/demo-data.ts` con datos de ejemplo completos de "Soluciones Verdes":
- Un client con tier "señales" 
- 3 snapshots (últimos 3 meses) con datos realistas
- 5 alertas de ejemplo
- 3 context_entries
- 2 users (admin + viewer)

Cuando Supabase no está configurado (no hay `SUPABASE_URL` en env), todos los queries a la DB devuelven los datos demo. El flag se detecta automáticamente:

```typescript
// src/lib/db.ts
const IS_DEMO = !import.meta.env.SUPABASE_URL;

export async function getClient(userId: string) {
  if (IS_DEMO) return DEMO_CLIENT; // de demo-data.ts
  // ... query real a Supabase
}
```

Esto permite que Claude Code implemente todo, yo lo pruebe visualmente con datos realistas, y después conectamos Supabase real cuando la UX esté validada.

---

## SETUP DE SISTEMAS EXTERNOS — Guía paso a paso (para cuando se active)

Cuando la UX esté validada y quiera pasar a producción, necesitaré configurar estos servicios. Claude Code: especifícame al final de la implementación un archivo `SETUP-GUIDE.md` con los pasos exactos para cada servicio:

### 1. Supabase
- Crear proyecto en supabase.com
- Copiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` al `.env`
- Ejecutar el SQL de creación de tablas (incluir el SQL completo en el guide)
- Configurar RLS policies
- Configurar auth providers (email magic link + Google OAuth)
- Configurar redirect URLs para auth

### 2. Stripe (cuando se active)
- Crear cuenta en stripe.com
- Crear 3 productos (Radar/Señales/Palancas) con precios mensual y anual
- Copiar `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` al `.env`
- Configurar webhook endpoint apuntando a `/api/stripe/webhook`
- Activar Customer Portal con opciones de cambio de plan y cancelación
- Copiar los price IDs al `.env`

### 3. Vercel
- Conectar repo de GitHub
- Configurar variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE keys)
- Configurar dominio custom

### 4. OAuth APIs (cuando se implementen en Fase 3)
- Google Cloud Console: crear proyecto, activar GA4 Data API + Search Console API, configurar OAuth consent screen
- Meta Business: crear app, configurar Marketing API
- LinkedIn: crear app, configurar Advertising API

**Claude Code: genera este archivo `SETUP-GUIDE.md` con los comandos, URLs y pasos exactos al final de la implementación.**

---

## BASE DE DATOS (Supabase)

### Tablas a crear:

```sql
-- Capa 1: Perfil del cliente (fijo)
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT CHECK (tier IN ('radar', 'señales', 'palancas')) DEFAULT 'radar',
  sector TEXT,
  online_objective TEXT,
  competitors JSONB DEFAULT '[]',
  keywords_target JSONB DEFAULT '[]',
  geo_queries JSONB DEFAULT '[]',
  social_platform TEXT DEFAULT 'linkedin',
  apis_connected JSONB DEFAULT '{}',
  advisor_id UUID,
  advisor_notes TEXT,
  ga4_audit_result JSONB,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Capa 2: Serie temporal (inmutable)
CREATE TABLE snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  pipeline_output JSONB NOT NULL, -- JSON completo del pipeline
  score_global INTEGER,
  score_pilares JSONB, -- {seo, geo, paid, social, web, conversion}
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, date)
);

-- Usuarios con roles
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK (role IN ('admin', 'viewer', 'advisor')) DEFAULT 'viewer',
  supabase_auth_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Alertas (Señales)
CREATE TABLE alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'seo', 'geo', 'competitor', 'web', 'paid'
  severity TEXT CHECK (severity IN ('critical', 'warning', 'positive')) DEFAULT 'warning',
  title TEXT NOT NULL,
  description TEXT,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Capa 3: Contexto acumulado
CREATE TABLE context_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('business', 'pattern', 'correction', 'action', 'brand')) NOT NULL,
  content TEXT NOT NULL,
  source TEXT CHECK (source IN ('advisor', 'system')) DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Secuencia de emails post-diagnóstico
CREATE TABLE email_sequences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id TEXT NOT NULL,
  email TEXT NOT NULL,
  step INTEGER CHECK (step IN (1, 2, 3)) NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_entries ENABLE ROW LEVEL SECURITY;
```

---

## ORDEN DE IMPLEMENTACIÓN

1. **Tailwind config** — Copiar la paleta de colores y tipografía del DESIGN.md
2. **Demo data** — Crear `src/lib/demo-data.ts` con datos completos de "Soluciones Verdes" (3 snapshots, 5 alertas, actions, etc.) + `src/lib/db.ts` con detección automática de modo demo
3. **DashboardLayout.astro** — Shell con Sidebar + TopBar + slot de contenido. Referencia: sidebar de `01-home-overview.html`
4. **Sidebar.astro** — Con lógica de tier (items visibles/grises/bloqueados). Incluir switch de tier demo en dev mode
5. **Componentes reutilizables** — MetricCard, AlertCard, ActionItem, SparkLine, TierGate, UpsellCallout — extraer clases de los HTMLs de Stitch
6. **Overview (Home)** — Replicar `01-home-overview.html` con datos dinámicos del demo data
7. **Informe mensual** — Embeber informe existente en DashboardLayout. Replicar `02-monthly-report.html`
8. **Evolución** — Replicar `03-evolution.html` con gráficos SVG dinámicos
9. **Competidores** — Benchmark con datos del snapshot
10. **Alertas** — Replicar `04-alerts.html` con TierGate para Radar
11. **SEO Opportunities** — Replicar `08-seo-opportunities.html`
12. **Paid Intelligence** — Replicar `06-paid-intelligence.html`
13. **Content Briefs** — Replicar `07-content-briefs.html`
14. **Suscripción** — Replicar `10-subscription.html` con comparativa + cambio de tier demo
15. **Onboarding** — Replicar `05-onboarding-ga4.html` como wizard. Añadir paso 0 (selección de plan). En demo: todo funciona sin OAuth real
16. **CTA en informe gratuito** — Añadir card de conversión al final del informe existente con link a `/dashboard/onboarding`
17. **Settings** — Conexiones (demo: todas "conectadas"), selector de tier para testing
18. **SETUP-GUIDE.md** — Guía paso a paso para configurar Supabase, Stripe, Vercel y OAuth cuando se active producción

---

## REGLAS CRÍTICAS

1. **Fidelidad al HTML de Stitch:** Para cada página, el HTML de Stitch en `stitch-reference/` es la referencia definitiva. Copia las clases Tailwind, la estructura de componentes, el spacing, y los patrones visuales TAL CUAL. No rediseñes — traduce de HTML estático a Astro dinámico.

2. **No hardcodear datos:** TODOS los números, textos de alertas, items del plan de acción, gráficos, etc. vienen de la base de datos (snapshot del cliente). Los HTMLs de Stitch tienen datos de ejemplo — reemplázalos con props dinámicos.

3. **Todos los gráficos son SVG programático:** Las sparklines, barras de GEO, gauges, barras de canal — todo se genera desde datos. Las gráficas que aparecen en los HTMLs de Stitch son estáticas/decorativas — reconstrúyelas como SVG dinámico que recibe datos por props.

4. **Items de tier superior SIEMPRE visibles:** Los items de Señales y Palancas se ven en la sidebar y en el contenido, pero atenuados (opacity-40, pointer-events-none). En los HTMLs de Stitch ya puedes ver este patrón — mantén la misma opacidad y badges. Los items de Fase 3 (Palancas: Technical Optimization, Content Generator, Schema Markup) aparecen en la sidebar pero el link está deshabilitado y no hay página implementada.

5. **Idioma:** La UI está en ESPAÑOL (castellano). Algunos HTMLs de Stitch mezclan inglés y español — normaliza todo a español. "Overview" → "Resumen", "Monthly Report" → "Informe Mensual", "Evolution" → "Evolución", "Alerts" → "Alertas", "Settings" → "Ajustes", "Competitors" → "Competidores", "Content Briefs" → "Briefs de Contenido", "Paid Intelligence" → "Inteligencia Paid", "SEO Opportunities" → "Oportunidades SEO", "Subscription" → "Suscripción".

6. **Sidebar compartida:** La sidebar aparece en TODOS los HTMLs de Stitch con ligeras variaciones. Usa `01-home-overview.html` como la referencia canónica para el componente `Sidebar.astro` — tiene la versión más completa con lógica de tiers, badges, y estados activos.

7. **Mobile responsive:** Diseñar desktop-first (el Dir. Marketing usa portátil), pero la sidebar debe colapsar en mobile con un botón hamburguesa.

8. **Performance:** Las páginas del dashboard deben cargar en < 2s. Usa Astro SSR para renderizar con datos del servidor — no cargues datos en el cliente con fetch si puedes evitarlo.
