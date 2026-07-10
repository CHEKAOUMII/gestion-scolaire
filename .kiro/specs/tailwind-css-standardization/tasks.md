# Implementation Plan: Tailwind CSS Standardization

## Overview

This plan implements the Standardization_Tool as a Node.js CLI pipeline under `tools/tailwind-standardize/`, split into a deterministic **pure core** (tokenizer, transforms, output-preservation gate) and an **I/O shell** (scope resolution, config writer, verifier, changelog). Each step builds on the previous one: data models first, then the pure transforms (each gated for output preservation and covered by a `fast-check` property test mapped to a design property), then the I/O shell that reads/writes files and runs the build/test gates, and finally the Auditor/Refactorer orchestration and CLI wiring that integrate everything into a runnable per-directory pipeline.

Implementation language: **JavaScript** (Node.js on Electron 35), matching the existing project and its `fast-check@^4.8.0` dev dependency, ESLint config, and npm scripts.

## Tasks

- [x] 1. Set up tool structure and core data models
  - Create `tools/tailwind-standardize/` with `core/`, `io/`, and `tests/` subdirectories
  - Define the data model factories/validators in `core/models.js`: `ElementLocator`, `FindingCategory`, `AuditFinding`, `SkippedFile`, `AuditRecord`, `NormalizationCategory`, `ChangeRecord`, `TokenDefinition`, `ComponentClassDefinition`, `ReviewClassification`, `ReviewReasonCategory`, `ReviewItem`, `Changelog`
  - Export the predefined `NormalizationCategory` and `ReviewReasonCategory` enums as the single source of truth used by the changelog
  - _Requirements: 13.3_

  - [x]* 1.2 Write unit tests for data model factories and enum constraints
    - Test locator construction and that change/review categories are restricted to the predefined sets
    - _Requirements: 13.3_

- [x] 2. Implement Scope Resolver
  - [x] 2.1 Implement `resolveScope` and `isInScope` in `io/scope-resolver.js`
    - Resolve `rootHtmlSet` (`*.html` at workspace root), `configSource` (`css/tailwind-input.css`), `mirrorSubtree` (`Cheka-project/`), and `excludedFiles` (every path under the mirror subtree)
    - `isInScope(path)` returns true only for `rootHtmlSet ∪ {configSource}` and false for any path under the mirror subtree
    - Halt before any normalization and surface the unresolved-scope condition when the mirror subtree is expected but resolves to `null`
    - _Requirements: 12.1, 12.2, 12.5_

  - [x]* 2.2 Write property test for scope exclusivity
    - **Property 18: Refactoring scope is exclusive to root files and the config source**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

  - [x]* 2.3 Write unit test for unresolvable mirror subtree halt
    - Assert the pipeline halts and records the unresolved-scope condition
    - _Requirements: 12.5_

- [x] 3. Implement Class Tokenizer and HTML Scanner
  - [x] 3.1 Implement `tokenize`/`serialize` in `core/tokenizer.js`
    - Parse each class token into `{ raw, variants, responsiveVariant, stateVariant, base, property, category, isArbitrary, arbitraryValue }`
    - `serialize` must be the exact inverse so reorders never alter token strings
    - _Requirements: 5.3_

  - [x]* 3.2 Write unit test for tokenize/serialize round trip
    - Test empty/whitespace attributes, multi-variant tokens, and arbitrary-value tokens
    - _Requirements: 5.3_

  - [x] 3.3 Implement `scan` in `core/scanner.js`
    - Return `classOccurrences`, `inlineStyles`, `styleBlocks`, and `dynamicRegions`, each carrying an element locator `{ filePath, line, tag }`
    - Mark occurrences originating inside `<script>` blocks or JS template literals as dynamic
    - _Requirements: 1.3, 1.4, 1.5, 7.2_

  - [x]* 3.4 Write property test for scanner locator accuracy and dynamic-region marking
    - Assert every emitted occurrence resolves back to its originating element and JS-region styles are flagged dynamic
    - _Requirements: 1.3, 1.4, 1.5, 7.2_

- [x] 4. Implement Combination Detector and Auditor
  - [x] 4.1 Implement `detectCombinations` in `core/combination-detector.js`
    - Compare utility combinations as order-independent sets of two or more utilities; a set at two or more distinct locations is a candidate
    - _Requirements: 1.6, 4.1_

  - [x]* 4.2 Write property test for duplicate-combination detection
    - **Property 3: Duplicate-combination detection is order-independent and exhaustive**
    - **Validates: Requirements 1.6**

  - [x] 4.3 Implement Auditor orchestration in `io/auditor.js`
    - Scan each root HTML file exactly once; record arbitrary-value, physical-direction, inline-style, duplicate-combination, and conflict/override findings with locators and conflicting-utility detail
    - Group findings by directory with per-category counts; record unreadable/unparsable files as skipped with a reason and continue; set `noFindings` when zero findings are detected
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9_

  - [x]* 4.4 Write property test for audit detection completeness
    - **Property 1: Occurrence detection is complete, coverage-exact, and locator-accurate**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5**

  - [x]* 4.5 Write property test for audit aggregation soundness
    - **Property 5: Audit aggregation is sound**
    - **Validates: Requirements 1.8**

  - [x]* 4.6 Write property test for conflict finding detail
    - **Property 4: Conflict findings identify the conflicting utilities**
    - **Validates: Requirements 1.7**

  - [x]* 4.7 Write property test for audit resilience under unreadable files
    - **Property 2: Audit resilience under unreadable files**
    - **Validates: Requirements 1.2**

  - [x]* 4.8 Write unit test for explicit no-findings audit record
    - Assert the record explicitly states no non-conforming usage was detected
    - _Requirements: 1.9_

- [x] 5. Checkpoint - audit pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Utility Orderer and Conflict Resolver
  - [x] 6.1 Implement `order` in `core/orderer.js`
    - Stable sort by category sequence layout → spacing → sizing → colors → effects → transforms, then uncategorized; place each variant-prefixed utility immediately after its non-prefixed counterpart (responsive before state); preserve original relative order within a category and among uncategorized; output is a permutation of the input multiset
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 6.2 Write property test for utility ordering
    - **Property 7: Utility ordering is a stable, category-sequenced permutation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 6.3 Implement `resolveConflicts` in `core/conflict-resolver.js`
    - Within one variant+breakpoint context, keep the winning utility and remove the overridden one; retain same-property utilities under different contexts; de-duplicate exact duplicates to one instance; record undecidable winners for manual review; idempotent
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x]* 6.4 Write property test for conflict and duplicate resolution
    - **Property 8: Conflict and duplicate resolution is correct, idempotent, and preserving**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 7. Implement Output-Preservation Gate
  - [x] 7.1 Implement the gate in `core/preservation-gate.js`
    - Compute each affected element's effective declaration set before/after an edit, resolving `var(--token)` references, in both the light context and the `[data-theme="dark"]` context across configured breakpoints; approve only provably-identical edits, otherwise reject and mark for manual review/exclusion with the original markup retained verbatim
    - _Requirements: 2.1, 2.3, 2.5, 4.4, 4.5, 6.5, 7.6, 9.4, 9.5_

  - [x]* 7.2 Write property test for the output-preservation gate
    - **Property 6: Output-preservation safety gate**
    - **Validates: Requirements 2.1, 2.3, 2.5, 4.4, 4.5, 6.5, 7.6, 9.4, 9.5**

- [x] 8. Implement Arbitrary-Value Resolver
  - [x] 8.1 Implement `resolveArbitrary` and the theme/scale index in `core/arbitrary-resolver.js`
    - Normalize arbitrary literals to a canonical computed value and match against existing tokens and the spacing/sizing scale by exact computed value; use a recurrence index (value → files) to decide replace-existing vs add-token (two or more files) vs retain + manual-review (fewer than two files); name new tokens per the Theme_Block convention
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 8.2 Write property test for arbitrary-value substitution
    - **Property 9: Arbitrary-value substitution is value-equivalent and threshold-correct**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x]* 8.3 Write property test for generated identifier conventions and collisions
    - **Property 10: Generated identifiers conform to conventions and never overwrite differing definitions**
    - **Validates: Requirements 3.6, 3.7, 4.3, 10.8**

- [x] 9. Implement Direction Mapper
  - [x] 9.1 Implement `mapPhysical` and `PHYSICAL_TO_LOGICAL` in `core/direction-mapper.js`
    - Total function over physical-direction utilities: map known utilities to their logical equivalents (value-preserving, axis keyword only) and retain+record any utility lacking a logical equivalent
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x]* 9.2 Write property test for physical→logical mapping
    - **Property 12: Physical→logical mapping is total and position-preserving**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**

- [x] 10. Implement Component-Class Synthesizer
  - [x] 10.1 Implement `synthesizeComponentClass` in `core/component-synthesizer.js`
    - Generate a `@layer components` entry using `@apply` or `var(--token)` references consistent with existing entries; name per existing casing/prefix/delimiter conventions; report (never redefine) a name collision with a differing definition
    - _Requirements: 4.2, 4.3_

  - [x]* 10.2 Write property test for component-class consolidation
    - **Property 11: Component-class consolidation is equivalent and convention-conforming**
    - **Validates: Requirements 4.1, 4.2**

- [x] 11. Implement Inline-Style Converter
  - [x] 11.1 Implement `convertInlineStyle` in `core/inline-style-converter.js`
    - Convert static inline styles expressible by existing utilities/tokens with identical computed rendering; exclude and record dynamic (JS-set) or inexpressible styles with element and reason category
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [x]* 11.2 Write property test for inline-style elimination invariants
    - **Property 13: Inline-style elimination invariants hold**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

- [x] 12. Implement Variant Normalizer
  - [x] 12.1 Implement `normalizeVariants` in `core/variant-normalizer.js`
    - Use only configured breakpoint prefixes (`sm: md: lg: xl: 2xl:`); trigger manual-review (never introduce an arbitrary breakpoint) when a bracket-notation breakpoint would be required; propagate a `hover:` utility across a group of same-type elements sharing the same non-variant utility set
    - _Requirements: 9.1, 9.2, 9.3_

  - [x]* 12.2 Write property test for variant normalization
    - **Property 14: Variant normalization stays within the configured system**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 13. Checkpoint - pure core transforms
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement Config Writer
  - [x] 14.1 Implement Config Writer in `io/config-writer.js`
    - Write new tokens only into the `@theme` block and new component classes only into `@layer components`; express dark-mode styling only via the existing `@variant dark` / `[data-theme="dark"]` mechanism; re-express carry-forward rules duplicated by a token/component and remove the duplicated legacy rule, recording the original rule and its replacement; halt with an error on identifier collision; halt with an error and leave Config_Source unmodified if a JS-based Tailwind config is detected
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x]* 14.2 Write property test for CSS-first containment of config changes
    - **Property 15: Configuration changes are contained in the CSS-first source**
    - **Validates: Requirements 10.1, 10.2, 10.5**

  - [x]* 14.3 Write property test for carry-forward re-expression
    - **Property 17: Carry-forward rules are re-expressed and recorded**
    - **Validates: Requirements 10.6, 10.7**

  - [x]* 14.4 Write unit test for JS-based Tailwind config rejection
    - **Property 16: JavaScript-based Tailwind configuration is rejected**
    - **Validates: Requirements 10.4**

  - [x]* 14.5 Write unit test for identifier-collision halt
    - Assert the existing entry is left unmodified and an identifier-conflict error is produced
    - _Requirements: 10.8_

- [x] 15. Implement Changelog Writer
  - [x] 15.1 Implement Changelog Writer in `io/changelog-writer.js`
    - Emit a single changelog including every processed directory (count 0 where nothing changed), every new token and component class with origin, every manual-review/excluded item with classification and reason category drawn from the predefined set, and the mirror-exclusion file count; on write failure retain refactored files unchanged and return a changelog-not-generated error
    - _Requirements: 12.3, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x]* 15.2 Write property test for changelog completeness
    - **Property 19: Changelog is complete and sound**
    - **Validates: Requirements 13.2, 13.3, 13.4, 13.5, 13.6**

  - [x]* 15.3 Write unit test for changelog write-failure path
    - Assert refactored files are retained unchanged and an error is returned
    - _Requirements: 13.7_

- [x] 16. Implement Verifier
  - [x] 16.1 Implement `verify` in `io/verifier.js`
    - Run `npm run css:build` and confirm the compiled stylesheet is produced with a zero exit code; on build failure report the failed command and leave the previous `tailwind-output.css` unchanged; run `npm run test:smoke`, `npm run lint` (≤ recorded pre-refactor baseline), and `npm test`; on any failure report which command failed and signal a halt before further directory refactoring
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x]* 16.2 Write integration test for successful build/verify gate
    - Assert `css:build` emits the stylesheet and the gate reports success
    - _Requirements: 11.1, 11.2, 11.4_

  - [x]* 16.3 Write integration test for forced verification failure halt
    - Assert the failing command is reported and the pipeline halts
    - _Requirements: 11.7_

- [x] 17. Implement Refactorer orchestration and CLI wiring
  - [x] 17.1 Implement the Refactorer in `io/refactorer.js`
    - For each directory, run the relevant pure transforms, route every candidate edit through the Output-Preservation Gate, apply only provably-safe edits via the Config Writer and file edits, then run the Verifier as a per-directory transaction boundary; halt before the next directory on verification failure; accumulate change/review records for the changelog
    - _Requirements: 2.5, 4.5, 6.5, 9.5, 11.7_

  - [x] 17.2 Implement CLI entry in `index.js` wiring audit and refactor commands
    - Wire Scope Resolver → Scanner → Auditor for the `audit` command and Scope Resolver → Auditor → Refactorer → Verifier → Changelog Writer for the `refactor` command, integrating all core and I/O modules with no orphaned code
    - _Requirements: 1.1, 12.1, 13.1_

  - [x]* 17.3 Write integration test on representative refactored pages
    - Run audit + refactor on a small set of representative root HTML pages and assert the gate preserves computed output and the changelog/verifier gates pass end-to-end
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 18. Final checkpoint - full pipeline
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use `fast-check` (already a dev dependency), a minimum of 100 iterations each, tagged with a comment referencing the design property, e.g. `// Feature: tailwind-css-standardization, Property 7: ...`.
- The Output-Preservation Gate (task 7) is the central safety mechanism; transform tasks must route candidate edits through it before any edit is applied.
- Visual/interaction equivalence (Req 2) is validated through the gate property plus the representative integration checks in task 17.3, since pixel/DOM rendering depends on the Electron runtime rather than the pure core.
- Checkpoints (tasks 5, 13, 18) ensure incremental validation against the build and test suites.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "4.1", "6.1", "6.3", "8.1", "9.1", "11.1", "12.1"] },
    { "id": 4, "tasks": ["4.2", "6.2", "6.4", "7.1", "8.2", "8.3", "9.2", "10.1", "11.2", "12.2"] },
    { "id": 5, "tasks": ["4.3", "7.2", "10.2", "14.1", "15.1", "16.1"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6", "4.7", "4.8", "14.2", "14.3", "14.4", "14.5", "15.2", "15.3", "16.2", "16.3"] },
    { "id": 7, "tasks": ["17.1"] },
    { "id": 8, "tasks": ["17.2"] },
    { "id": 9, "tasks": ["17.3"] }
  ]
}
```
