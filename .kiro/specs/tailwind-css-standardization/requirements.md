# Requirements Document

## Introduction

This feature standardizes Tailwind CSS usage across the application: a vanilla HTML/JavaScript renderer running on Electron 35 (no React/Vue/JSX). All Tailwind utility classes live directly in `.html` files at the workspace root, and styling is driven by a Tailwind CSS v4 **CSS-first** configuration in `css/tailwind-input.css` (there is no `tailwind.config.js`).

The goal is to audit, refactor, and normalize Tailwind class usage so the codebase follows a single, documented standard while producing **identical visual and functional output** with **no breaking changes**. "Normalization" covers: consolidating duplicate class combinations into reusable component classes, replacing arbitrary values with design-system tokens, applying a consistent utility ordering convention, removing conflicting or overridden classes, eliminating inline styles that should be utilities, enforcing consistent responsive and state variants, replacing magic numbers with configured spacing/sizing scales, enforcing RTL-safe logical-property utilities, and centralizing repeated custom values.

The work must keep the existing build pipeline (`npm run css:build` via PostCSS), the existing token system (`@theme`), the existing component layer (`@layer components`), the dark-mode variant (`@variant dark` targeting `[data-theme="dark"]`), and the smoke test suite (`npm run test:smoke`) intact. Deliverables include refactored files grouped by directory, an updated central CSS-first configuration of new tokens and component classes, and a changelog describing the normalization work.

## Glossary

- **Standardization_Tool**: The overall capability (process plus its outputs) responsible for auditing, refactoring, and normalizing Tailwind CSS usage across the codebase. Used as the system name in requirements that describe normalization behavior.
- **Auditor**: The component of the Standardization_Tool that scans source files to detect non-conforming Tailwind usage and records findings.
- **Refactorer**: The component of the Standardization_Tool that applies normalization changes to source files.
- **Config_Source**: The CSS-first Tailwind configuration file `css/tailwind-input.css`, including its `@theme`, `@layer components`, `@variant`, and carry-forward legacy CSS sections.
- **Theme_Block**: The `@theme { ... }` block inside the Config_Source where design tokens (colors, spacing, radii, shadows, fonts, motion) are defined.
- **Component_Layer**: The `@layer components { ... }` block inside the Config_Source where reusable component classes are defined.
- **Compiled_Stylesheet**: The generated `css/tailwind-output.css` file produced by `npm run css:build`.
- **Design_Token**: A named custom property defined in the Theme_Block (for example `--color-primary`, `--spacing-md`, `--radius-sm`).
- **Arbitrary_Value**: A Tailwind class using bracket notation with a hardcoded literal (for example `mt-[13px]`, `bg-[#3b6ac5]`, `w-[327px]`).
- **Logical_Property_Utility**: A direction-agnostic Tailwind utility that respects RTL/LTR context (for example `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`).
- **Physical_Direction_Utility**: A direction-specific Tailwind utility tied to left/right (for example `pl-*`, `pr-*`, `ml-*`, `mr-*`, `left-*`, `right-*`).
- **Utility_Ordering_Convention**: The defined ordering of Tailwind utilities within a `class` attribute: layout → spacing → sizing → colors → effects → transforms, followed by responsive and state variants.
- **Responsive_Variant**: A Tailwind breakpoint prefix (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`).
- **State_Variant**: A Tailwind state prefix (for example `hover:`, `focus:`, `focus-visible:`, `active:`, `disabled:`).
- **Inline_Style**: A `style="..."` attribute on an HTML element, or a `<style>` block embedded in an HTML file.
- **Carry_Forward_CSS**: Legacy hand-written CSS retained inside the Config_Source that has not yet been re-expressed as tokens or component classes.
- **Root_HTML_Set**: The set of `.html` files located at the workspace root that the Config_Source scans via its `@source "../*.html"` directive.
- **Mirror_Subtree**: The `Cheka-project/` directory, which contains HTML and CSS files that mirror many Root_HTML_Set files.
- **Changelog**: A document recording the normalization changes applied, organized by file or directory.
- **Smoke_Suite**: The checks executed by `npm run test:smoke`, including IPC parity, module integrity, no-CDN policy, Tailwind output presence, and legacy CSS cleanup.

## Requirements

### Requirement 1: Audit of Non-Conforming Tailwind Usage

**User Story:** As a developer, I want a complete audit of non-conforming Tailwind usage, so that I understand the full scope of normalization work before any changes are applied.

#### Acceptance Criteria

1. WHEN an audit is initiated, THE Auditor SHALL scan each file in the Root_HTML_Set exactly once for Tailwind class usage.
2. IF a file in the Root_HTML_Set cannot be read or parsed, THEN THE Auditor SHALL record that file path as a skipped file with a reason indicating the read or parse failure, and SHALL continue scanning the remaining files without aborting the audit.
3. THE Auditor SHALL record each detected occurrence of an Arbitrary_Value together with the file path and an element locator (the line number and the element's tag name) that uniquely identifies where the occurrence appears.
4. THE Auditor SHALL record each detected occurrence of a Physical_Direction_Utility together with the file path and an element locator (the line number and the element's tag name) that uniquely identifies where the occurrence appears.
5. THE Auditor SHALL record each detected occurrence of an Inline_Style together with the file path and an element locator (the line number and the element's tag name) that uniquely identifies where the occurrence appears.
6. THE Auditor SHALL record each detected duplicate class combination that appears in two or more distinct element locations, together with every file path and element locator (the line number and the element's tag name) where it appears.
7. THE Auditor SHALL record each detected conflicting or overridden utility combination together with the file path, the element locator (the line number and the element's tag name), and the specific utility classes that conflict or override one another.
8. WHEN the audit completes, THE Auditor SHALL produce an audit record that groups all findings by directory and includes the total count of findings per category for each directory.
9. IF the audit completes with zero detected findings across all scanned files, THEN THE Auditor SHALL produce an audit record that explicitly states that no non-conforming usage was detected.

### Requirement 2: Identical Visual and Functional Output

**User Story:** As a user of the application, I want the interface to look and behave exactly as before after standardization, so that normalization introduces no regressions.

#### Acceptance Criteria

1. WHEN a refactored file is rendered at a given viewport size and theme state, THE Standardization_Tool SHALL produce visual output that shows no observable differences in layout position, element dimensions, color, typography, and spacing compared to the output produced by the same file before refactoring at the same viewport size and theme state.
2. WHEN a user interaction (click, hover, focus, keyboard input, or form submission) is performed on a refactored file, THE Standardization_Tool SHALL produce the same observable response that the same interaction produced on the file before refactoring.
3. WHILE dark mode is active via `[data-theme="dark"]`, WHEN a refactored file is rendered, THE Standardization_Tool SHALL produce visual output that shows no observable differences in layout position, element dimensions, color, typography, and spacing for every refactored element compared to that element's dark-mode output before refactoring.
4. WHEN visual output is compared before and after refactoring, THE Standardization_Tool SHALL perform the comparison at each defined Responsive_Variant breakpoint (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) and in both the light theme state and the dark theme state (`[data-theme="dark"]`).
5. IF a normalization change would produce any observable difference in rendered visual output or interactive behavior compared to the pre-refactoring output, THEN THE Refactorer SHALL retain the original markup unchanged, SHALL not apply the change, and SHALL record the affected element together with its file path as a manual-review item.

### Requirement 3: Replace Arbitrary Values with Design Tokens

**User Story:** As a developer, I want arbitrary values replaced with design-system tokens, so that styling stays consistent and centrally controlled.

#### Acceptance Criteria

1. WHERE an existing Design_Token represents the exact same computed value as an Arbitrary_Value, THE Refactorer SHALL replace the Arbitrary_Value with the utility that references that Design_Token while leaving the surrounding selector and declaration context unchanged.
2. WHERE an Arbitrary_Value recurs in two or more files and no existing Design_Token represents its exact computed value, THE Refactorer SHALL add a new Design_Token to the Theme_Block of the Config_Source.
3. WHEN a new Design_Token has been added for a recurring Arbitrary_Value, THE Refactorer SHALL replace every occurrence of that Arbitrary_Value with the utility that references the new Design_Token.
4. WHEN a magic-number spacing or sizing value has the exact same computed value as an entry in the configured spacing or sizing scale, THE Refactorer SHALL replace it with the corresponding scale utility.
5. IF an Arbitrary_Value has no Design_Token with the exact same computed value and recurs in fewer than two files, THEN THE Refactorer SHALL retain the Arbitrary_Value and record it as a manual-review item identifying the file, the element selector context, and the retained value.
6. WHERE a new Design_Token is added, THE Refactorer SHALL name the token following the existing token naming convention used in the Theme_Block.
7. IF a new Design_Token to be added would share a name with an existing Design_Token but represent a different computed value, THEN THE Refactorer SHALL NOT redefine the existing token and SHALL record the collision as a manual-review item.

### Requirement 4: Consolidate Repeated Class Combinations into Component Classes

**User Story:** As a developer, I want repeated class combinations turned into reusable component classes, so that markup is readable and maintainable.

#### Acceptance Criteria

1. WHERE an identical Tailwind class combination, defined as the same set of two or more utility classes regardless of declaration order, appears in two or more locations, THE Refactorer SHALL define one reusable component class in the Component_Layer of the Config_Source and replace each occurrence of that combination with that component class.
2. WHEN a component class is added to the Component_Layer, THE Refactorer SHALL express the class using Tailwind `@apply` or Design_Token references consistent with the syntax of existing entries in the Component_Layer.
3. WHEN a component class is added, THE Refactorer SHALL give the class a descriptive name that conforms to the casing, prefix, and delimiter conventions of existing Component_Layer entries.
4. WHEN a component class replaces a repeated combination, THE Standardization_Tool SHALL preserve the rendered output of every affected element such that the computed CSS styles of each affected element are identical to the computed CSS styles before the replacement.
5. IF replacing a repeated combination with a component class would change the computed CSS styles of any affected element, THEN THE Standardization_Tool SHALL leave the original class combination unchanged and SHALL report the affected location with an indication that the replacement was skipped.

### Requirement 5: Standardize Utility Ordering

**User Story:** As a developer, I want a consistent utility ordering inside class attributes, so that classes are predictable and easy to scan.

#### Acceptance Criteria

1. THE Refactorer SHALL order utilities within each `class` attribute according to the Utility_Ordering_Convention in the sequence: layout, then spacing, then sizing, then colors, then effects, then transforms.
2. WHEN a `class` attribute contains a Responsive_Variant or State_Variant, THE Refactorer SHALL place variant-prefixed utilities immediately after their non-prefixed counterpart, ordering multiple variants of the same utility with the Responsive_Variant first and the State_Variant second.
3. WHEN utilities are reordered, THE Standardization_Tool SHALL produce a `class` attribute whose set of utility tokens is identical to the original set, with no token added, removed, or duplicated, so that the rendered output of the affected element is unchanged.
4. WHEN two or more utilities within a `class` attribute belong to the same Utility_Ordering_Convention category, THE Refactorer SHALL preserve their original left-to-right relative order.
5. IF a utility within a `class` attribute does not match any category defined in the Utility_Ordering_Convention, THEN THE Refactorer SHALL place that utility after all categorized utilities while preserving its original relative order among other unmatched utilities.

### Requirement 6: Remove Conflicting and Overridden Classes

**User Story:** As a developer, I want conflicting and overridden classes removed, so that the effective styling of each element is unambiguous.

#### Acceptance Criteria

1. WHEN two utilities in the same `class` attribute, sharing the same variant and breakpoint context, set the same CSS property such that one overrides the other, THE Refactorer SHALL remove the overridden utility and retain only the single utility that determines the element's rendered output.
2. IF two utilities in the same `class` attribute set the same CSS property but apply under different variant or breakpoint contexts (so that neither overrides the other), THEN THE Refactorer SHALL retain both utilities unchanged.
3. WHEN a duplicate identical utility appears two or more times in the same `class` attribute, THE Refactorer SHALL retain exactly one instance of that utility and remove all other identical instances.
4. IF the Refactorer cannot deterministically identify which of two property-setting utilities determines the rendered output, THEN THE Refactorer SHALL leave both utilities unchanged and record the element as requiring manual review.
5. WHEN conflicting or duplicate utilities are removed, THE Standardization_Tool SHALL preserve the rendered output of the affected element such that the computed styles of the element are identical to the computed styles before removal.

### Requirement 7: Eliminate Inline Styles

**User Story:** As a developer, I want inline styles converted to Tailwind utilities or component classes, so that styling is centralized and the no-inline-style policy holds.

#### Acceptance Criteria

1. WHERE an Inline_Style can be expressed using existing Tailwind utilities or Design_Token references that produce the identical computed visual rendering of the affected element, THE Refactorer SHALL replace the Inline_Style with the equivalent utilities or component class.
2. IF an Inline_Style is set dynamically by JavaScript at runtime, THEN THE Refactorer SHALL retain that Inline_Style and record it as an excluded item that identifies the affected element and the reason for exclusion.
3. IF an Inline_Style is static and cannot be expressed using existing Tailwind utilities or Design_Token references that produce the identical computed visual rendering, THEN THE Refactorer SHALL retain that Inline_Style and record it as an excluded item that identifies the affected element and the reason for exclusion.
4. WHEN inline-style conversion completes for the Root_HTML_Set, THE Standardization_Tool SHALL keep the count of `<style>` blocks in the Root_HTML_Set at zero so that the Smoke_Suite legacy CSS check continues to pass.
5. WHEN inline-style conversion completes for the Root_HTML_Set, THE Standardization_Tool SHALL ensure the count of remaining `style` attributes equals the count of recorded excluded items, with all non-excluded Inline_Style instances removed.
6. WHEN an Inline_Style is converted, THE Standardization_Tool SHALL preserve the computed visual rendering of the affected element such that its rendered output before and after conversion is identical.

### Requirement 8: Enforce RTL-Safe Logical Property Utilities

**User Story:** As a developer maintaining a right-to-left Arabic interface, I want logical-property utilities used instead of physical left/right utilities, so that layout direction stays correct across RTL and LTR contexts.

#### Acceptance Criteria

1. WHERE a Physical_Direction_Utility has an equivalent Logical_Property_Utility, THE Refactorer SHALL replace the Physical_Direction_Utility with the corresponding Logical_Property_Utility for 100% of such occurrences, excluding only items recorded under criterion 5.
2. WHEN logical-property replacements are applied, THE Standardization_Tool SHALL preserve the rendered layout direction of each affected element in the RTL context such that the element's pre-replacement and post-replacement positions of inline-start, inline-end, top, and bottom edges are identical within a tolerance of 0 pixels.
3. WHEN logical-property replacements are applied, THE Standardization_Tool SHALL preserve the rendered layout direction of each affected element in the LTR context such that the element's pre-replacement and post-replacement positions of inline-start, inline-end, top, and bottom edges are identical within a tolerance of 0 pixels.
4. IF a Physical_Direction_Utility is intentionally required for a visual effect that is independent of text direction, THEN THE Refactorer SHALL retain that utility and record it as an excluded item containing the file path, the utility name, and the reason for exclusion.
5. IF a Physical_Direction_Utility has no equivalent Logical_Property_Utility, THEN THE Refactorer SHALL retain that utility unchanged and record it as an excluded item containing the file path, the utility name, and the reason for exclusion.

### Requirement 9: Consistent Responsive and State Variants

**User Story:** As a developer, I want responsive and state variants applied consistently, so that breakpoint and interaction behavior is uniform across pages.

#### Acceptance Criteria

1. WHEN the Refactorer applies responsive styling, THE Refactorer SHALL use only the configured Responsive_Variant prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`).
2. IF a responsive style would require a breakpoint expressed as an Arbitrary_Value (bracket-notation breakpoint such as `min-[673px]:`), THEN THE Refactorer SHALL retain the original markup unchanged and record the affected element as a manual-review item instead of introducing the Arbitrary_Value breakpoint.
3. WHERE two or more interactive elements share the same element type and the same set of non-variant utility classes, and at least one of those elements declares a hover State_Variant utility (a class prefixed with `hover:`), THE Refactorer SHALL apply that identical hover State_Variant utility to every other element in that group.
4. WHEN responsive or state variants are normalized, THE Standardization_Tool SHALL preserve the rendered output of the affected element at each configured Responsive_Variant breakpoint (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) and in each State_Variant interaction state present before normalization (for example `hover:`, `focus:`, `focus-visible:`, `active:`, `disabled:`).
5. IF normalizing a responsive or state variant would alter the rendered output at any configured breakpoint or interaction state, THEN THE Refactorer SHALL preserve the original output and record the affected element as a manual-review item instead of applying the change.

### Requirement 10: Maintain the CSS-First Configuration

**User Story:** As a developer, I want all configuration changes made in the CSS-first Config_Source, so that the project's Tailwind v4 setup remains the single source of truth.

#### Acceptance Criteria

1. THE Refactorer SHALL define every new Design_Token exclusively within the Theme_Block of the Config_Source, and SHALL NOT define Design_Tokens in any other file or location.
2. THE Refactorer SHALL define every new reusable component class exclusively within the Component_Layer of the Config_Source, and SHALL NOT define reusable component classes in any other file or location.
3. THE Refactorer SHALL NOT create, modify, or reference a `tailwind.config.js` file or any JavaScript-based Tailwind configuration file.
4. IF a `tailwind.config.js` file or any JavaScript-based Tailwind configuration is detected in the project, THEN THE Refactorer SHALL halt the configuration change and produce an error indication that JavaScript-based Tailwind configuration is not permitted, leaving the Config_Source unmodified.
5. WHEN dark-mode styling is required for a new or modified Design_Token or component class, THE Refactorer SHALL express that styling using the existing `@variant dark` mechanism targeting `[data-theme="dark"]`, and SHALL NOT introduce any alternative dark-mode mechanism.
6. WHEN one or more Carry_Forward_CSS rules duplicate styling that a Design_Token or Component_Layer entry now provides, THE Refactorer SHALL re-express each such rule as a Design_Token or component class in the Config_Source and SHALL remove the duplicated Carry_Forward_CSS rule.
7. WHEN the Refactorer re-expresses a Carry_Forward_CSS rule as a Design_Token or component class, THE Refactorer SHALL record the change as an entry that identifies the original rule and its replacement token or component class.
8. IF a new Design_Token or component class to be defined shares an identifier with an existing entry in the Config_Source, THEN THE Refactorer SHALL halt that definition and produce an error indication of the identifier conflict, leaving the existing entry unmodified.

### Requirement 11: Build and Verification Integrity

**User Story:** As a developer, I want every change to compile and pass existing checks, so that standardization never leaves the project in a broken state.

#### Acceptance Criteria

1. WHEN the Config_Source is modified, THE Standardization_Tool SHALL execute `npm run css:build` and produce a Compiled_Stylesheet, where the command completes with a zero exit code and reports zero build errors.
2. IF `npm run css:build` completes with a non-zero exit code or reports one or more build errors after the Config_Source is modified, THEN THE Standardization_Tool SHALL report a build failure indicating the failed command and SHALL leave the previous Compiled_Stylesheet unchanged.
3. WHEN refactoring of a directory completes, THE Standardization_Tool SHALL execute `npm run test:smoke` and the Smoke_Suite SHALL complete with a zero exit code and zero failing checks.
4. THE Compiled_Stylesheet SHALL contain the `--color-primary` Design_Token so that the Smoke_Suite Tailwind output check completes with a passing result.
5. WHEN JavaScript source files are modified during refactoring, THE Standardization_Tool SHALL execute `npm run lint` and the count of reported lint errors SHALL be less than or equal to the lint error count recorded immediately before the refactoring began.
6. WHEN refactoring of a directory completes, THE Standardization_Tool SHALL execute `npm test` and the test run SHALL complete with a zero exit code and zero failing checks.
7. IF `npm run test:smoke`, `npm run lint`, or `npm test` completes with a non-zero exit code or reports one or more failing checks after refactoring of a directory completes, THEN THE Standardization_Tool SHALL report a verification failure indicating which command failed and SHALL halt before applying further directory refactoring.

### Requirement 12: Scope of the Mirror Subtree

**User Story:** As a developer, I want the scope regarding the mirrored Cheka-project subtree defined explicitly, so that refactoring targets only the intended files.

#### Acceptance Criteria

1. THE Standardization_Tool SHALL apply normalization exclusively to files contained in the Root_HTML_Set and the Config_Source.
2. THE Standardization_Tool SHALL exclude every file located within the Mirror_Subtree from all refactoring operations.
3. WHEN the Standardization_Tool completes scope resolution, THE Standardization_Tool SHALL record in the Changelog the exclusion of the Mirror_Subtree, including the count of files excluded.
4. IF a file within the Mirror_Subtree is selected for refactoring during processing, THEN THE Standardization_Tool SHALL skip that file, leave its contents unchanged, and record the skipped file in the Changelog with an indication that it was excluded as part of the Mirror_Subtree.
5. IF the Mirror_Subtree cannot be located or resolved, THEN THE Standardization_Tool SHALL halt before applying any normalization and SHALL record an entry in the Changelog indicating that the Mirror_Subtree scope could not be determined.

### Requirement 13: Deliverables and Changelog

**User Story:** As a developer reviewing the work, I want organized deliverables and a changelog, so that I can review and trace every normalization change.

#### Acceptance Criteria

1. WHEN normalization completes for a directory, THE Standardization_Tool SHALL provide the refactored files grouped under that directory's relative path, preserving the original file names.
2. WHEN normalization completes for a directory containing zero refactored files, THE Standardization_Tool SHALL record that directory in the Changelog with a count of 0 changes rather than omitting it.
3. THE Standardization_Tool SHALL produce a single Changelog that lists, per file and per directory, each category of normalization applied, where every listed category is one of the predefined normalization categories the Standardization_Tool supports.
4. THE Changelog SHALL list every new Design_Token added to the Theme_Block, identifying each token by its token name and the originating file or directory.
5. THE Changelog SHALL list every new component class added to the Component_Layer, identifying each class by its class name and the originating file or directory.
6. THE Changelog SHALL list every item recorded as manual-review or excluded during refactoring, stating for each item whether it is manual-review or excluded and the reason category for that classification.
7. IF the Changelog cannot be produced after normalization completes, THEN THE Standardization_Tool SHALL retain all refactored files unchanged and return an error indication that the Changelog was not generated.
