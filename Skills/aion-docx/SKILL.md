---
name: aion-docx
description: >
  Use this skill to create professional Word documents (.docx) for AION Growth Studio.
  Triggers: any request to create a report, proposal, memo, technical brief, project plan,
  or any professional document for AION in Word format.
  Input is always a briefing or free-text notes from the user.
---

# AION Growth Studio — DOCX Skill

Creates polished, brand-consistent Word documents for AION Growth Studio from a text briefing.

---

## Brand Identity (Light / Print Mode)

| Element | Value |
|---------|-------|
| Page background | `#FFFFFF` (white) |
| Primary blue (headings) | `#1A4B8C` |
| Accent blue (highlights, borders) | `#4A7FD4` |
| Body text | `#1A1A2E` (near-black) |
| Secondary text / captions | `#5A6478` |
| Table header background | `#1A4B8C` (white text) |
| Table row alt background | `#EEF3FB` |
| Divider / rule color | `#4A7FD4` |

**Logo:** `/mnt/user-data/uploads/LOGO_A1.jpg` (white background version)
- Header: right-aligned, width ~1.5", maintain aspect ratio
- First page only or every page depending on document type (see below)

**Typography:**
- Document font: **Calibri** throughout
- H1: Calibri Bold, 20pt, `#1A4B8C`
- H2: Calibri Bold, 14pt, `#1A4B8C`
- H3: Calibri Bold, 12pt, `#4A7FD4`
- Body: Calibri, 11pt, `#1A1A2E`
- Captions / footnotes: Calibri Light, 9pt, `#5A6478`

---

## Workflow

### Step 1 — Parse the briefing

Read the user's briefing and extract:
- **Document type** (report, proposal, technical brief, project plan, memo, etc.)
- **Title and subtitle**
- **Audience** (internal team, client, executive)
- **Key sections / topics** to cover
- **Any data, tables, or lists** embedded in the briefing

If something is ambiguous, infer the most sensible structure and proceed.

### Step 2 — Plan the document structure

**Always include:**
- Header with logo (right) + document title (left)
- Footer with page number (right) + "AION Growth Studio — Confidential" (left)
- Title block on page 1: title, subtitle, date, prepared by
- Table of contents (for documents over 4 sections)
- Closing section or next steps

**Structure by document type:**

**Report / Analysis:**
Executive Summary → Context / Background → Findings (one H2 per topic) → Conclusions → Recommendations → Next Steps

**Proposal / Offer:**
Executive Summary → Problem / Opportunity → Proposed Solution → Methodology → Timeline → Investment → Next Steps

**Technical Brief:**
Overview → Architecture / Approach → Components / Modules → Integration Points → Requirements → Risks & Mitigations

**Project Plan:**
Objectives → Scope → Phases & Milestones → Deliverables → Responsibilities → Timeline → Budget Summary

**Memo:**
To / From / Date / Subject block → Summary → Detail → Action Required

### Step 3 — Generate the document

**Read [docx SKILL.md reference](../docx/SKILL.md) for complete docx-js patterns before writing code.**

Install dependency if needed:
```bash
npm install -g docx
```

#### Page setup (always use A4 for European professional documents)

```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
        WidthType, ShadingType, VerticalAlign, PageNumber, TabStopType,
        TabStopPosition, LevelFormat } = require('docx');
const fs = require('fs');

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } }, // 11pt
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 40, bold: true, font: "Calibri", color: "1A4B8C" },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Calibri", color: "1A4B8C" },
        paragraph: { spacing: { before: 280, after: 80 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Calibri", color: "4A7FD4" },
        paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1134, bottom: 1440, left: 1134 } // 1" top/bottom, 0.79" sides
      }
    },
    headers: { default: buildHeader() },
    footers: { default: buildFooter() },
    children: [ /* content here */ ]
  }]
});
```

#### Header (logo right + title left)

```javascript
function buildHeader() {
  const logoBuffer = fs.readFileSync('/mnt/user-data/uploads/LOGO_A1.jpg');
  return new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "4A7FD4", space: 4 } },
        children: [
          new TextRun({ text: "AION Growth Studio", bold: true, color: "1A4B8C", size: 18, font: "Calibri" }),
          new TextRun({ text: "\t" }),
          new ImageRun({
            data: logoBuffer, type: "jpg",
            transformation: { width: 108, height: 36 } // ~1.5" wide
          })
        ]
      })
    ]
  });
}
```

#### Footer (confidential left + page number right)

```javascript
function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "4A7FD4", space: 4 } },
        children: [
          new TextRun({ text: "AION Growth Studio — Confidential", size: 16, color: "5A6478", font: "Calibri" }),
          new TextRun({ text: "\t" }),
          new TextRun({ children: [new PageNumber()], size: 16, color: "5A6478", font: "Calibri" })
        ]
      })
    ]
  });
}
```

#### Title block (page 1)

```javascript
// Document title
new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { before: 480, after: 120 },
  children: [new TextRun({ text: TITLE, bold: true, size: 56, font: "Calibri", color: "1A4B8C" })]
}),
// Subtitle
new Paragraph({
  children: [new TextRun({ text: SUBTITLE, size: 28, color: "4A7FD4", font: "Calibri" })]
}),
// Metadata line: Date | Author | Version
new Paragraph({
  spacing: { before: 160, after: 480 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "4A7FD4", space: 6 } },
  children: [new TextRun({ text: `${DATE}   |   Prepared by: ${AUTHOR}   |   v1.0`, size: 18, color: "5A6478", font: "Calibri" })]
}),
```

#### Tables (AION style)

```javascript
// Header row: dark blue bg + white text
// Alternate rows: white / light blue (#EEF3FB)
const headerCell = (text, width) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  shading: { fill: "1A4B8C", type: ShadingType.CLEAR },
  children: [new Paragraph({
    children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20, font: "Calibri" })]
  })]
});

const dataCell = (text, width, isAlt = false) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  shading: { fill: isAlt ? "EEF3FB" : "FFFFFF", type: ShadingType.CLEAR },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1, color: "D0DDF0" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "D0DDF0" },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE }
  },
  children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: "Calibri" })] })]
});
```

#### Callout / info box

```javascript
// Blue left-border callout for key insights
new Paragraph({
  indent: { left: 480 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: "4A7FD4", space: 12 } },
  shading: { fill: "EEF3FB", type: ShadingType.CLEAR },
  spacing: { before: 160, after: 160 },
  children: [new TextRun({ text: CALLOUT_TEXT, italics: true, size: 22, color: "1A4B8C", font: "Calibri" })]
}),
```

### Step 4 — Validate and QA

```bash
# Validate the file
python scripts/office/validate.py output.docx

# Extract text to check content
pandoc output.docx -o check.md && cat check.md

# Convert to images for visual QA
python scripts/office/soffice.py --headless --convert-to pdf output.docx
pdftoppm -jpeg -r 150 output.pdf page
```

Inspect every page image and check:
- Logo visible in header, correctly sized, not distorted
- Blue accent line under header and above footer on every page
- H1 headings in dark blue, H2 lighter blue, body text near-black
- Tables: dark blue header row, alternating white/light blue rows
- No text overflow, no orphaned headings at bottom of page
- Footer shows page numbers correctly
- No leftover placeholder text

Fix all issues found, then re-verify.

### Step 5 — Deliver

```bash
cp output.docx /mnt/user-data/outputs/aion-[tipo-doc]-[YYYY-MM-DD].docx
```

---

## Content Guidelines

- **Write in clear, direct professional Spanish** unless the audience is explicitly English-speaking
- **No filler paragraphs** — every sentence should add information or context
- **Tables over bullet lists** when comparing options or listing attributes with values
- **Use callout boxes** for key insights, recommendations, or warnings
- **Section introductions** — each H1 section should open with 1–2 sentences of context before diving into subsections
- **Executive summary always first** for documents over 5 pages

---

## Common Mistakes to Avoid

- ❌ Never use unicode bullets — always use `LevelFormat.BULLET` with numbering config
- ❌ Never use `\n` inside TextRun — use separate Paragraph elements
- ❌ Never use `WidthType.PERCENTAGE` on tables — always DXA
- ❌ Never use `ShadingType.SOLID` for table cells — always `CLEAR`
- ❌ Never use tables as dividers — use Paragraph border instead
- ❌ Never use the dark-background LOGO-A.png in Word docs — always use LOGO_A1.jpg (white bg)
- ❌ Never mix fonts — Calibri throughout

---

## Output

Final file: `aion-[tipo-documento]-[YYYY-MM-DD].docx`  
Destination: `/mnt/user-data/outputs/`
