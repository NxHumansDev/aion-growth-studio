import { describe, it, expect } from 'vitest';
const { parseSubtasks } = await import('../../src/lib/recommendations/parse-subtasks');

describe('parseSubtasks', () => {
  it('parses a numbered list', () => {
    const detail = `
1. Conecta Google Search Console
2. Revisa las consultas con impresiones sin clicks
3. Reescribe los titles de las páginas afectadas
    `.trim();
    const subs = parseSubtasks(detail);
    expect(subs).toHaveLength(3);
    expect(subs[0].text).toBe('Conecta Google Search Console');
    expect(subs[2].text).toBe('Reescribe los titles de las páginas afectadas');
    expect(subs[0].id).toBe('st-1');
    expect(subs.every(s => s.done === false)).toBe(true);
  });

  it('parses a bullet list with mixed markers', () => {
    const detail = `
- Primer paso
* Segundo paso
- Tercer paso
    `.trim();
    expect(parseSubtasks(detail)).toHaveLength(3);
  });

  it('strips bold/italic markdown', () => {
    const detail = `1. **Conecta** _Google_ Search Console con \`kikogamez.com\``;
    const subs = parseSubtasks(detail);
    expect(subs[0].text).toBe('Conecta Google Search Console con kikogamez.com');
  });

  it('parses section headings like "## Paso 1"', () => {
    const detail = `
## Paso 1: Analiza las queries
Prose describing what to analyze...

## Paso 2: Actualiza los titles
More prose...
    `.trim();
    const subs = parseSubtasks(detail);
    expect(subs).toHaveLength(2);
    expect(subs[0].text).toBe('Analiza las queries');
    expect(subs[1].text).toBe('Actualiza los titles');
  });

  it('ignores plain prose paragraphs with no list', () => {
    const detail = `
Este paso requiere que revises tu sitio completo y identifiques oportunidades. No es trivial.
Hay que tomarse tiempo.
    `.trim();
    expect(parseSubtasks(detail)).toHaveLength(0);
  });

  it('caps at 10 subtasks', () => {
    const detail = Array.from({ length: 15 }, (_, i) => `${i + 1}. Step ${i + 1}`).join('\n');
    expect(parseSubtasks(detail)).toHaveLength(10);
  });

  it('returns empty array for falsy or malformed input', () => {
    expect(parseSubtasks('')).toHaveLength(0);
    expect(parseSubtasks(null)).toHaveLength(0);
    expect(parseSubtasks(undefined)).toHaveLength(0);
  });

  it('merges indented continuation into the previous item', () => {
    const detail = `
1. Primer paso
   con detalles que continuan en otra linea
2. Segundo paso
    `.trim();
    const subs = parseSubtasks(detail);
    expect(subs).toHaveLength(2);
    expect(subs[0].text).toBe('Primer paso con detalles que continuan en otra linea');
  });

  it('generates stable ids that match position', () => {
    const subs = parseSubtasks(`1. Paso uno\n2. Paso dos\n3. Paso tres`);
    expect(subs.map(s => s.id)).toEqual(['st-1', 'st-2', 'st-3']);
  });
});
