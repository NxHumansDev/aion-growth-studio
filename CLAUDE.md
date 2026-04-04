# AION Platform — Reglas de trabajo

## Trello es la fuente de la verdad

El tablero https://trello.com/b/P2CFCG2k/aion es la fuente de la verdad del proyecto. Ahí están:
- Los requisitos funcionales de cada tarea (descripción de cada tarjeta)
- El registro de todo lo que hemos hecho (comentarios en cada tarjeta)
- Lo que hemos probado y ha funcionado, y lo que hemos probado y NO ha funcionado
- El estado de QA de cada funcionalidad

Si no está en Trello, no existe. Si no está documentado en Trello, no se ha hecho.

## Dónde documentar

TODO se documenta en Trello, en la tarjeta correspondiente. Al terminar cualquier tarea:

1. Comenta en la tarjeta de Trello con:
   - Qué se hizo
   - Archivos creados y modificados
   - Decisiones técnicas y por qué
   - Dependencias y variables de entorno añadidas
   - Qué tests se ejecutaron y su resultado
   - Qué se probó y NO funcionó (esto es tan importante como lo que sí funcionó)
   - Problemas conocidos o deuda técnica
   - Pasos concretos para verificar que funciona
2. Mueve la tarjeta a Done

Si te pido algo que no tiene tarjeta propia, documéntalo en la tarjeta más relacionada. Si no hay ninguna relacionada, dímelo para que decidamos dónde registrarlo.

## Antes de empezar cualquier tarea

1. Verifica que las dependencias funcionales existen en el código. Si necesitas algo que no está implementado, dímelo antes de empezar.
2. Ejecuta los tests existentes. Si hay tests rotos, repórtalos antes de tocar nada.

## Durante el trabajo

3. Haz que funcione bien. Tests, errores gestionados, edge cases cubiertos.
4. Si tienes dudas, pregunta. No asumas.
5. No reorganices el tablero sin consultarme. Puedes proponer crear subtarjetas, partir cards grandes, o cambiar dependencias — pero consúltamelo antes de hacerlo.

## Después de cada tarea

6. Ejecuta los tests. Si rompiste algo, arréglalo.
7. Documenta en Trello (ver formato arriba).
8. Si te pido algo fuera del plan de Trello, hazlo y documéntalo igual de bien.

## Conexión con Trello

Board ID: P2CFCG2k

Acceso a Trello mediante la opción que resulte más efectiva y viable:
- **MCP integration** (herramientas nativas mcp__trello__*): preferible cuando está disponible.
- **API Keys** (TRELLO_API_KEY, TRELLO_TOKEN en .env): usar si MCP no está disponible o para operaciones que MCP no soporta (ej: editar descripción de tarjetas).
- **Scripts helper** en scripts/trello/: crear bajo demanda si se necesitan operaciones recurrentes.

## Stack técnico

- Framework: Astro (Vercel)
- DB: Supabase (PostgreSQL + Auth + Storage)
- Pagos: Stripe (cuando se active)
- Email: Resend (transaccional + nurturing)
- Cache: Upstash Redis (cuando se implemente P5)
- Workflows: Inngest / Vercel Cron (cuando se implemente P4)
- Tests: Vitest + Playwright

### IA

El proyecto usa Claude API para múltiples módulos. La elección de modelo (Haiku, Sonnet, Opus) y herramienta para cada necesidad se decide en conversación según el balance coste/calidad/velocidad de cada caso. No hay asignación fija — Claude Code debe recomendar el modelo más adecuado para cada tarea.

Criterio general:
- Tareas de generación (insights, briefings, análisis): modelo que ofrezca buen balance calidad/coste
- Tareas de revisión/QA (última línea antes del cliente): modelo con mejor criterio disponible
- Tareas de clasificación (sector, techstack): modelo rápido y económico es suficiente
