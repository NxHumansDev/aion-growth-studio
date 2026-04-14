---
name: aion-pptx
description: >
  Use this skill to create professional technical presentations (.pptx) for AION Growth Studio.
  Triggers: any request to create slides, a deck, or a presentation for AION — especially
  for project plans, roadmaps, system architectures, or solution/decision analyses.
  Input is always a briefing or free-text notes from the user.
---

# AION Growth Studio — PPTX Skill

Creates polished, brand-consistent technical presentations for AION Growth Studio from a text briefing.

---

## Brand Identity

| Element | Value |
|---------|-------|
| Primary background | `#0A0A0F` (near-black) |
| Primary blue | `#1A4B8C` |
| Light blue / gradient end | `#4A7FD4` |
| Accent light | `#FFFFFF` |
| Metallic gray (text secondary) | `#8E9BB0` |
| Card / surface | `#12151E` |
| Body text on dark | `#E8ECF4` |

**Logo:** Available at `/mnt/user-data/uploads/LOGO-A.png` — place in the top-right corner of every slide (width ~1.8", maintain aspect ratio, ~0.25" from edges).

**Typography:**
- Titles: **Calibri Bold**, 36–44pt, white (`#FFFFFF`)
- Section headers: Calibri Bold, 20–24pt, light blue (`#4A7FD4`)
- Body: Calibri Light, 14–16pt, `#E8ECF4`
- Captions / metadata: Calibri Light, 10–12pt, `#8E9BB0`

**Visual motif:** A thin horizontal line (`#4A7FD4`, 2pt) at the bottom of title slides and section dividers — **never under individual slide titles**. Use dark card shapes (`#12151E`) for content grouping.

---

## Workflow

### Step 1 — Parse the briefing

Read the user's briefing and extract:
- **Title** of the presentation
- **Audience** (internal team, client, executive)
- **Key sections / topics** to cover
- **Content type** (roadmap, architecture, decision analysis, or mixed)

If the briefing is ambiguous, infer the most likely structure and proceed — do not ask for clarification unless something critical is missing.

### Step 2 — Plan the slide structure

Always include:
1. **Cover slide** — title, subtitle, date, AION logo prominent
2. **Agenda / Index** — clean numbered list of sections
3. **Content slides** — 1 slide per key point or topic (never overload a slide)
4. **Closing slide** — summary or call to action, AION logo, contact if relevant

For roadmaps: use timeline / horizontal flow layouts
For architectures: use diagram-style two-column or component grid layouts
For decision analysis: use comparison columns or pros/cons cards

### Step 3 — Generate the presentation

**Read [pptxgenjs.md](../pptx/pptxgenjs.md) before writing any code.**

Use `pptxgenjs` to create the file. Apply the AION dark theme consistently:

```javascript
// Base slide dimensions: widescreen 13.33" x 7.5"
pptx.defineLayout({ name: 'WIDESCREEN', width: 13.33, height: 7.5 });
pptx.layout = 'WIDESCREEN';

// Background for every slide
slide.background = { color: '0A0A0F' };
```

**Logo placement on every slide:**
```javascript
slide.addImage({
  path: '/mnt/user-data/uploads/LOGO-A.png',
  x: 11.28, y: 0.2, w: 1.8, h: 0.6,
  sizing: { type: 'contain', w: 1.8, h: 0.6 }
});
```

**Cover slide layout:**
- Large title centered, white, 44pt bold
- Subtitle below, `#4A7FD4`, 22pt
- Date bottom-left, gray, 12pt
- Thin blue line (`#4A7FD4`, 2pt) spanning full width at y=6.8
- Logo top-right

**Content slide layouts (vary across the deck — never repeat same layout):**

Option A — Two-column (text + visual/diagram):
- Left column: title + bullet points or description
- Right column: icon grid, diagram placeholder, or numbered list in dark cards

Option B — Card grid (for features, components, options):
- 2×2 or 3×1 dark cards (`#12151E`), each with a bold header in `#4A7FD4` and body text
- Thin blue border-left on each card (2pt, `#1A4B8C`)

Option C — Timeline / Roadmap:
- Horizontal flow with numbered circles (`#1A4B8C` fill, white number)
- Each phase as a labeled block below

Option D — Large stat / KPI callout:
- 1–3 big numbers (60–72pt, `#4A7FD4`) with small label below (14pt, gray)
- Supporting context text on the left or below

**Section divider slides:**
- Full dark background
- Section number small top-left (`#8E9BB0`)
- Section name large centered (`#4A7FD4`, 36pt)
- Thin full-width line at y=6.8

### Step 4 — QA

```bash
# Install dependencies if needed
pip install "markitdown[pptx]" --break-system-packages
npm install -g pptxgenjs

# Content check
python -m markitdown output.pptx

# Convert to images for visual QA
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
```

Visually inspect every slide image. Check for:
- Logo present and correctly sized on every slide
- No text overflow or cutoff
- No elements overlapping
- Consistent blue accent color (`#4A7FD4`) — not generic defaults
- Sufficient contrast on dark background (all text ≥ 4.5:1)
- Varied layouts — no two consecutive identical layouts

Fix all issues found, then re-verify.

### Step 5 — Deliver

Copy the final file to `/mnt/user-data/outputs/` and present it to the user.

---

## Content Guidelines by Presentation Type

### Project Plan / Roadmap
- Use phases not tasks — keep it strategic
- One timeline slide showing phases + duration
- One slide per phase with goals, deliverables, and dependencies
- Risk or assumptions slide if warranted

### System Architecture
- Use component diagram approach: boxes = components, arrows = data flows
- Group by layer (frontend / backend / data / external)
- Add a legend slide for symbols
- Keep technical jargon appropriate for the stated audience

### Decision / Solution Analysis
- Frame the problem first (1 slide)
- Present 2–3 options with criteria comparison (card or table layout)
- Recommendation slide with clear rationale
- Next steps slide

---

## Common Mistakes to Avoid

- ❌ Never use accent lines directly under slide titles
- ❌ Never use light/white backgrounds — this deck is always dark
- ❌ Never leave the logo off any slide
- ❌ Never use generic blue (#0070C0) — use AION blues only
- ❌ Never repeat the same layout more than twice in a row
- ❌ Never create text-only slides — always add a shape, card, or visual element
- ❌ Never mix alignment — body text is always left-aligned; only slide titles are centered

---

## Output

Final file: `aion-presentation-[topic]-[YYYY-MM-DD].pptx`  
Destination: `/mnt/user-data/outputs/`
