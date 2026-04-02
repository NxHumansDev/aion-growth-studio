# BUGS CONOCIDOS — AION Growth Studio

Generado: 2026-04-02
Auditorías de referencia: 5 URLs diversas
Ejecutado por: Claude Code (P0-S1a)

---

## Severidad: CRÍTICO

### BUG-001: Status API devuelve solo 13/25 módulos en dev mode
- **Módulo:** `src/pages/api/audit/[id]/status.ts` + `src/lib/api-auth.ts`
- **Descripción:** En dev mode, `process.env.STUDIO_API_KEY` es `undefined` (Astro/Vite solo inyecta `import.meta.env`). Esto hace que `validateApiKey()` devuelva `source: 'dev'`, luego `isPlatform = true`, y el endpoint usa `mapResultsForPlatform()` que solo mapea 13 de 25 módulos.
- **Impacto:** El frontend del informe recibe datos incompletos. Faltan sector, competitors, reputation, insights, seo_pages, content_cadence, competitor_traffic, keyword_gap, competitor_pagespeed, meta_ads, google_shopping, qa.
- **Reproducibilidad:** 100% — ocurre en TODAS las auditorías en dev server.
- **Fix sugerido:** En `api-auth.ts`, usar `import.meta.env.STUDIO_API_KEY || process.env.STUDIO_API_KEY`. O en `status.ts`, no mapear resultados para la respuesta "completed" (siempre devolver raw).

### BUG-002: seo_pages — DataForSEO 404 en todas las auditorías
- **Módulo:** `src/lib/audit/modules/seo-pages.ts`
- **Descripción:** El endpoint de DataForSEO para páginas devuelve 404 en el 100% de los casos.
- **Impacto:** Sección "Top páginas SEO" del informe siempre vacía.
- **Reproducibilidad:** 5/5 auditorías (100%).
- **URLs probadas:** bufeterosales.es, getquipu.com, freshlycosmetics.com, endesa.com, stripe.com

### BUG-003: keyword_gap — nunca encuentra datos
- **Módulo:** `src/lib/audit/modules/keyword-gap.ts`
- **Descripción:** Devuelve "No se encontraron keywords gap con los datos disponibles" en todas las auditorías, incluyendo sitios con competidores claros (stripe.com, endesa.com).
- **Impacto:** Sección "Oportunidades keyword gap" siempre vacía en el informe.
- **Reproducibilidad:** 5/5 auditorías (100%).

### BUG-004: Tiempo total auditoría > 240s (objetivo <90s)
- **Módulo:** Pipeline general
- **Descripción:** Las 5 auditorías tardaron entre 242s y 268s. Los cuellos de botella principales son:
  - `insights`: 38-47s (el más lento, llamada LLM larga)
  - `qa`: 30s constante (parece un timeout fijo)
  - `pagespeed`: 14-40s (depende del sitio, a veces timeout)
  - `geo`: 18-26s (múltiples llamadas a LLMs)
- **Impacto:** Experiencia de usuario inaceptable. Un usuario espera >4 minutos por un informe.
- **Tiempos medidos:**
  - bufeterosales.es: 242s
  - getquipu.com: 259s
  - freshlycosmetics.com: 266s
  - endesa.com: 268s
  - stripe.com: 262s

---

## Severidad: ALTO

### BUG-005: competitor_pagespeed — timeout 100% de los casos
- **Módulo:** `src/lib/audit/modules/competitor-pagespeed.ts`
- **Descripción:** Timeout de 15s en TODAS las auditorías (5/5). El módulo intenta obtener PageSpeed de todos los competidores en serie, consumiendo el timeout antes de completar.
- **Impacto:** Comparativa de rendimiento con competidores nunca disponible.
- **Reproducibilidad:** 5/5 (100%).
- **Fix sugerido:** Limitar a 1-2 competidores, o usar Promise.allSettled con timeout individual por competidor.

### BUG-006: pagespeed — timeout intermitente en sitios grandes
- **Módulo:** `src/lib/audit/modules/pagespeed.ts`
- **Descripción:** Timeout de 40s en freshlycosmetics.com y endesa.com (2/5 auditorías). Sitios con muchos recursos/scripts pesados superan el timeout de Google PageSpeed API.
- **Impacto:** Score de rendimiento web falta en el informe para ~40% de sitios.
- **Reproducibilidad:** 2/5 (40%).

### BUG-007: traffic — módulo stub sin datos reales
- **Módulo:** `src/lib/audit/modules/traffic.ts`
- **Descripción:** Devuelve `{ _stub: true }` en todas las auditorías. No implementado.
- **Impacto:** Sección de tráfico en el informe sin datos o con datos derivados de SEO.
- **Reproducibilidad:** 5/5 (100%).

### BUG-008: meta_ads — nunca detecta anuncios
- **Módulo:** `src/lib/audit/modules/meta-ads.ts`
- **Descripción:** Devuelve "No Meta Ads detected or endpoint unavailable" en 4/5 auditorías, incluyendo endesa.com que probablemente tiene campañas activas.
- **Impacto:** Sección de publicidad del informe siempre vacía.
- **Reproducibilidad:** 4/5 (80%).

### BUG-009: google_shopping — clasificación ecommerce incorrecta
- **Módulo:** `src/lib/audit/modules/google-shopping.ts` + `crawl.ts`
- **Descripción:** freshlycosmetics.com (ecommerce DTC real) se clasifica como "Not ecommerce" porque `crawl.businessType` no detecta correctamente la naturaleza ecommerce del sitio.
- **Impacto:** Análisis Google Shopping no se ejecuta en ecommerce reales.
- **Reproducibilidad:** 1/5 (pero el único ecommerce de la muestra falló).

---

## Severidad: MEDIO

### BUG-010: qa module — siempre tarda exactamente 30s
- **Módulo:** `src/lib/audit/modules/qa-agent.ts`
- **Descripción:** El módulo QA tarda 30.004-30.025ms en todas las auditorías, lo que sugiere un sleep/timeout fijo innecesario o un prompt que siempre consume el máximo.
- **Impacto:** Añade 30s constantes al tiempo total sin clara proporcionalidad al trabajo realizado.
- **Reproducibilidad:** 5/5 (100%).

### BUG-011: content_cadence — falso negativo en blogs
- **Módulo:** `src/lib/audit/modules/content-cadence.ts`
- **Descripción:** freshlycosmetics.com tiene un blog activo pero el módulo reporta "No se ha detectado blog ni contenido publicado".
- **Impacto:** Métricas de cadencia editorial ausentes para sitios con blogs en rutas no estándar.
- **Reproducibilidad:** 1/5 (20%).

### BUG-012: gbp — nunca encuentra el negocio
- **Módulo:** `src/lib/audit/modules/gbp.ts`
- **Descripción:** Devuelve `found: false` en 4/5 auditorías (todas excepto donde no aplica). Endesa debería tener perfil de Google Business.
- **Impacto:** Sección Google Business Profile siempre vacía.
- **Reproducibilidad:** 4/5 (80%).

### BUG-013: instagram/linkedin — no encuentra perfiles sin handle explícito
- **Módulo:** `src/lib/audit/modules/instagram.ts`, `linkedin.ts`
- **Descripción:** Devuelve `found: false` cuando no se proporciona handle en los parámetros. bufeterosales.es y freshlycosmetics.com no fueron detectados automáticamente (pero sí getquipu.com, endesa.com, stripe.com).
- **Impacto:** Datos sociales faltan en ~40% de auditorías sin input manual del usuario.
- **Reproducibilidad:** 2/5 (40%).

---

## Severidad: BAJO

### BUG-014: score.breakdown incompleto
- **Módulo:** `src/lib/audit/modules/score.ts`
- **Descripción:** El breakdown del score solo muestra `conversion: 58` en bufeterosales.es. Faltan las otras dimensiones (seo, geo, web, social, reputation).
- **Impacto:** El gauge del informe muestra score total pero el desglose es incompleto.
- **Reproducibilidad:** Verificar en más detalle.

---

## Resumen de bugs por frecuencia

| Bug | Frecuencia | Severidad |
|-----|-----------|-----------|
| BUG-001 Status API mapped | 5/5 | CRÍTICO |
| BUG-002 seo_pages 404 | 5/5 | CRÍTICO |
| BUG-003 keyword_gap vacío | 5/5 | CRÍTICO |
| BUG-004 Tiempo >240s | 5/5 | CRÍTICO |
| BUG-005 competitor_ps timeout | 5/5 | ALTO |
| BUG-007 traffic stub | 5/5 | ALTO |
| BUG-010 qa 30s fijo | 5/5 | MEDIO |
| BUG-008 meta_ads no detecta | 4/5 | ALTO |
| BUG-012 gbp not found | 4/5 | MEDIO |
| BUG-006 pagespeed timeout | 2/5 | ALTO |
| BUG-013 social sin handle | 2/5 | MEDIO |
| BUG-009 ecommerce misclass | 1/5 | ALTO |
| BUG-011 blog falso negativo | 1/5 | MEDIO |
| BUG-014 score breakdown | TBD | BAJO |
