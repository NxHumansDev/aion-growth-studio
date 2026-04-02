# CRITERIOS DE ACEPTACIÓN — Informe AION Growth Studio

Generado: 2026-04-02
Referencia: P0-S1a

---

## General

- [ ] Pipeline completa en < 90 segundos
- [ ] 0 módulos con status "MISSING" al finalizar
- [ ] Status API devuelve los 25 módulos (raw, no mapped) al frontend
- [ ] Informe renderiza todas las secciones sin error

---

## Sección: Hero (Score + Semáforo)

- [ ] Score total 0-100 visible con animación gauge
- [ ] Breakdown por las 5+ dimensiones (no solo 1)
- [ ] Semáforo de color correcto (verde/amarillo/rojo según score)
- [ ] Sector del negocio detectado correctamente

## Sección: SEO

- [ ] Keywords top 3, top 10, top 30 con datos numéricos
- [ ] Domain rank visible
- [ ] Tráfico orgánico estimado
- [ ] Top keywords listados
- [ ] **Top páginas SEO** con datos (requiere fix seo_pages)
- [ ] Backlinks total y dominios de referencia
- [ ] Páginas indexadas

## Sección: IA / GEO

- [ ] Score GEO overall visible (0-100)
- [ ] Brand score y sector score
- [ ] Queries de prueba con resultados
- [ ] Menciones detectadas en motores IA
- [ ] Datos cross-model si disponibles

## Sección: Competidores (Radar)

- [ ] 3-5 competidores identificados con nombre y URL
- [ ] Radar chart con 5 ejes renderizado
- [ ] **Tráfico de competidores** con datos comparativos
- [ ] **Keyword gap** con oportunidades (requiere fix keyword_gap)
- [ ] **PageSpeed de competidores** con scores (requiere fix competitor_pagespeed)

## Sección: Experiencia (UX + Conversión)

- [ ] PageSpeed mobile: performance, LCP, CLS, FCP
- [ ] PageSpeed desktop: performance score
- [ ] SSL: válido, issuer, protocolo, expiración
- [ ] Análisis de conversión: CTAs, formularios, lead magnets
- [ ] Funnel score visible
- [ ] TechStack: herramientas detectadas (analytics, CRM, chat)

## Sección: Contenido + Social

- [ ] Claridad del contenido (score)
- [ ] Cadencia editorial: posts, frecuencia, último post
- [ ] Blog detectado correctamente (incluir rutas no estándar)
- [ ] Instagram: followers, engagement si encontrado
- [ ] LinkedIn: followers, employees si encontrado
- [ ] Detección automática de perfiles sin handle manual

## Sección: Reputación

- [ ] Google Business Profile: rating, reviews
- [ ] Trustpilot: encontrado/no encontrado
- [ ] Noticias: headlines, conteo
- [ ] Nivel de reputación general

## Sección: Publicidad

- [ ] Meta Ads: detectar si hay campañas activas
- [ ] Google Shopping: detectar si hay productos (solo ecommerce)
- [ ] Clasificación ecommerce correcta para tiendas online

## Sección: Plan de Acción (Insights)

- [ ] Executive summary generado
- [ ] 3-5 iniciativas priorizadas
- [ ] Bullets de mejoras concretas
- [ ] Resumen por área (visibilidad, experiencia, benchmark)
- [ ] QA: validación de insights sin contradicciones

## Sección: Datos Transversales

- [ ] Tráfico web con datos reales (no stub)
- [ ] Tiempo de auditoría registrado
- [ ] Coverage % reportado al finalizar

---

## Criterios por tipo de sitio

### WordPress / Pyme
- [ ] Blog detectado y cadencia calculada
- [ ] GBP encontrado si tiene presencia local

### SPA / SaaS
- [ ] Crawl captura contenido renderizado (no HTML vacío)
- [ ] TechStack identifica framework

### Ecommerce
- [ ] Clasificado como ecommerce (businessType)
- [ ] Google Shopping ejecutado
- [ ] Productos/catálogo detectados

### Corporativo grande
- [ ] Múltiples competidores identificados
- [ ] Social profiles encontrados automáticamente

### WAF / Cloudflare
- [ ] Crawl completa sin bloqueo
- [ ] PageSpeed no timeout por protección
