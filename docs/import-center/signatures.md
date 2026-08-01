# Import Center Signatures

**Version:** 1.0.0  
**Implementation:** `js/import-center/import-signatures.js`  
**Fixtures:** `tests/fixtures/import-center/`  
**Calibration:** high `0.85`, medium `0.60`, ambiguity gap `< 0.10`

## Policy

- **Content evidence is primary** (headers, sheet structure, XML root/elements).
- **Filename, extension, and contextual query hints are auxiliary.**
- Filename-only scoring **cannot** reach high confidence (`0.85`) and **cannot** auto-finalize a destination.
- A valid tabular file without a registered match becomes `generic_csv_xlsx` (review required).
- Unknown XML roots remain review-required (`unknown` / low confidence).

All fixtures are **synthetic / de-identified**. Provenance is safe to commit.

## Registered sources

| Type | Formats | Primary content evidence | Valid samples (≥2) | Failure cases |
|---|---|---|---|---|
| `students` | CSV/XLSX | code/massar + name + section-like headers | `students/valid-01.csv`, `students/valid-02.csv` | incomplete-header, empty, year-mismatch |
| `grades` | CSV/XLSX | code + subject/grade/term headers | `grades/valid-01.csv`, `grades/valid-02.csv` | incomplete-header, empty, year-mismatch |
| `absences` | CSV/XLSX | code + absence date/hours/type headers | `absences/valid-01.csv`, `absences/valid-02.csv` | incomplete-header, empty, year-mismatch |
| `student_status` | CSV/XLSX | code + status/وضعية headers | `student_status/valid-01.csv`, `student_status/valid-02.csv` | incomplete-header, empty |
| `fet` | XML | root `Teachers_Timetable`, elements Teacher/Day/Hour/Subject | `fet/valid-01.xml`, `fet/valid-02.xml` | unknown-root, empty, missing-structure |
| `agent_xml` | XML | root `DsAgentExport`, AGENT/ACTIVITE/ref tables | `agent_xml/valid-01.xml`, `agent_xml/valid-02.xml` | unknown-root, empty, missing-structure |

## Generic path

| Type | Formats | Evidence | Samples |
|---|---|---|---|
| `generic_csv_xlsx` | CSV/XLSX | Valid tabular headers without registered signature | `generic/data.csv`, `generic/file1.csv` |

Generic path is **not** a silent assignment to a registered source. User must choose a supported destination before readiness (future preflight packages).

## Confidence bands

| Score | Band | UI implication |
|---|---|---|
| ≥ 0.85 | high | Proposed type; still needs preflight + explicit confirmation before write |
| [0.60, 0.85) | medium | Needs review |
| < 0.60 | low | User must select type/destination |
| top-two gap < 0.10 | ambiguous | `needs_review` even if top score is high |

## Content precedence

When filename/extension/context conflict with content, **content wins**.  
Legacy `inferImportActionFromFiles` may contribute a low-weight `filename_hint` only.
