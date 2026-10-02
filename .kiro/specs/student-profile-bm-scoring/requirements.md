# Requirements Document

## Introduction

صفحة `student-profile-prototype.html` تحتوي على بطاقة متابعة التلميذ (Bataqa Mutabaat — BM) المكوّنة من أربعة تبويبات للإدخال: الجانب الاقتصادي، الجانب الاجتماعي، الجانب الصحي والنفسي، والمتابعة والتدخل. يعتمد النظام حالياً على `js/student-risk.js` لحساب مؤشر خطر مركّب (0–100) يُعرض في تبويب "مؤشر الخطر".

الهدف هو إضافة **سكور مستقل لكل محور** (tab score)، مقسّم إلى **نقاط فرعية لكل سؤال/حقل**، مع عرض مرئي داخل كل تبويب، مع الحفاظ على التوافق الكامل مع المحرك القائم في `student-risk.js`.

## Glossary

- **BM**: بطاقة المتابعة (Bataqa Mutabaat) — المنظومة الكاملة لتتبع وضع التلميذ.
- **Tab_Scorer**: وحدة JavaScript النقية المسؤولة عن حساب سكور كل تبويب من بياناته الخام.
- **Score_Widget**: العنصر المرئي (HTML) الذي يُعرض في رأس كل تبويب ليوضح السكور والتقدير.
- **Sub_Score**: النقاط الجزئية المخصصة لسؤال أو حقل واحد داخل تبويب.
- **Tab_Score**: مجموع Sub_Scores المُعيار (0–100) لمحور واحد.
- **Composite_Risk**: مؤشر الخطر المركّب الحالي (0–100) المحسوب بواسطة `student-risk.js`.
- **Risk_Engine**: الوحدة النقية القائمة في `js/student-risk.js`.
- **Score_Level**: تصنيف نصي لقيمة السكور: `منخفض` (0–39)، `متوسط` (40–69)، `مرتفع` (70–100).
- **Economic_Tab**: تبويب الجانب الاقتصادي (`#tab-economic`).
- **Social_Tab**: تبويب الجانب الاجتماعي (`#tab-social`).
- **Health_Tab**: تبويب الجانب الصحي والنفسي (`#tab-health`).
- **Followup_Tab**: تبويب المتابعة والتدخل (`#tab-followup`).
- **Risk_Tab**: تبويب مؤشر الخطر (`#tab-risk`).
- **Renderer**: `js/pages/student-profile.js` — ملف المنطق الأمامي للصفحة.

## Requirements

### Requirement 1: حساب سكور التبويب الاقتصادي

**User Story:** As a مرشد تربوي, I want to see computed scores for the student's economic situation, so that I can gauge its impact on dropout risk accurately.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL compute Sub_Score for each field in Economic_Tab according to the following table:
   - `bm-eco`: `good`=0، `avg`=15، `poor`=30، `vpoor`=40 نقطة
   - `bm-income`: `stable`=0، `unstable`=10، `none`=20 نقطة
   - `bm-unmet-needs`: each unmet need = 5 points (max 20)
   - `bm-support-programs`: each active support program reduces the score by 5 points (minimum 0); a program is "active" when its field value is non-empty
   - `bm-distance-km`: greater than 10 km (strict, >10) = 5 extra points, otherwise 0

2. THE Tab_Scorer SHALL normalize the raw point total to a 0–100 scale using: `score = min(rawTotal / 85 × 100, 100)`, where 85 is the theoretical maximum (40+20+20+5).

3. WHEN any field in Economic_Tab changes, THE Tab_Scorer SHALL recompute the economic Tab_Score within 500 milliseconds.

4. IF all Economic_Tab fields are empty or unanswered (null, undefined, empty string, or zero for numeric fields), THEN THE Tab_Scorer SHALL return `null` (not computed) instead of 0.

5. IF some Economic_Tab fields are answered and others are not, THEN THE Tab_Scorer SHALL compute the score using only the answered fields, treating unanswered fields as contributing 0 to the raw total.

---

### Requirement 2: حساب سكور التبويب الاجتماعي

**User Story:** As a مرشد تربوي, I want to see computed social situation scores per question, so that they reflect family complexity and environmental risks.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL compute Sub_Score for each field in Social_Tab according to the following table:
   - `bm-family`: `complete`=0، `divorced`=15، `widow`=10، `absent`=15 نقطة
   - `bm-parents-edu`: `high`=0، `mid`=5، `low`=10، `none`=15 نقطة
   - `bm-housing`: `good`=0، `crowded`=10، `bad`=20 نقطة
   - `bm-study-place`: `yes`=0، `partial`=5، `no`=10 نقطة
   - `bm-teachers-rel`: `good`=0، `neutral`=5، `bad`=10 نقطة
   - `bm-peers-rel`: `good`=0، `neutral`=5، `bad`=10 نقطة
   - `bm-social-risks`: each active social risk = 5 points (max 25)

2. THE Tab_Scorer SHALL normalize the raw total to 0–100 using: `score = min(rawTotal / 105 × 100, 100)`, where 105 is the theoretical maximum.

3. WHEN any field in Social_Tab changes, THE Tab_Scorer SHALL recompute the social Tab_Score within 500 milliseconds.

4. IF all Social_Tab fields are empty (null, undefined, empty string, or no radio/checkbox selected), THEN THE Tab_Scorer SHALL return `null`.

5. IF some Social_Tab fields are answered and others are not, THEN THE Tab_Scorer SHALL compute the score using only the answered fields, treating unanswered fields as contributing 0.

---

### Requirement 3: حساب سكور التبويب الصحي والنفسي

**User Story:** As a مرشد تربوي, I want scores for the health and psychological situation combining physical and psychological indicators.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL compute Sub_Score for each field in Health_Tab according to:
   - `bm-health-gen`: `good`=0، `avg`=10، `bad`=20 نقطة
   - `bm-disability`: `none`=0، `yes`=15 نقطة
   - `bm-learning-disorders`: each disorder = 8 points (max 24)
   - `bm-sleep`: `good`=0، `avg`=5، `bad`=10 نقطة
   - `bm-nutrition`: `good`=0، `avg`=5، `bad`=10 نقطة
   - `bm-substances`: each harmful substance = 10 points (max 20)
   - `bm-psych-symptoms`: red-flagged symptoms (e.g., `self_harm`) = 12 points each; other symptoms = 5 points each (max 30 total)
   - Mood scale (`mood`): 1=15، 2=10، 3=5، 4=2، 5=0 نقطة
   - Motivation scale (`motiv`): 1=10، 2=7، 3=4، 4=1، 5=0 نقطة
   - `bm-psych-ref`: `yes`=10، `maybe`=5، `no`=0 نقطة

2. THE Tab_Scorer SHALL normalize the raw total to 0–100 using: `score = min(rawTotal / 139 × 100, 100)`, where 139 is the theoretical maximum.

3. WHEN any field in Health_Tab changes (including scale buttons and badge toggles), THE Tab_Scorer SHALL recompute the health/psych Tab_Score within 500 milliseconds.

4. IF all Health_Tab fields are empty or unset (no radio selected, no badges active, no scale value chosen, no checkboxes checked), THEN THE Tab_Scorer SHALL return `null`.

5. IF some Health_Tab fields are answered and others are not, THEN THE Tab_Scorer SHALL compute the score using only the answered fields, treating unanswered fields as contributing 0.

6. IF a Tab_Score value outside [0, 100] would be produced due to edge-case input, THEN THE Tab_Scorer SHALL clamp the result to [0, 100] before returning.

---

### Requirement 4: حساب سكور تبويب المتابعة والتدخل

**User Story:** As a مرشد تربوي, I want scores reflecting the level of response and intervention completed with the student, so that positive intervention is rewarded with lower scores.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL compute Sub_Score for the followup tab on an **inverse basis** (good followup reduces the score):
   - `bm-calls-count` + `bm-meetings-count` combined: 0 contacts = 25 points، 1–2 = 15 points، 3+ = 5 points
   - `bm-actions-taken`: each action taken reduces 5 points from a base of 50 (minimum 0)
   - `bm-next-date`: follow-up date set = 0 points، not set = 10 points
   - `bm-guardian-phone`: set = 0 points، empty = 10 points

2. THE Tab_Scorer SHALL normalize the score to 0–100 using: `score = min(rawTotal / 95 × 100, 100)`.

3. WHEN any field in Followup_Tab changes, THE Tab_Scorer SHALL recompute the followup Tab_Score within 500 milliseconds.

4. IF all Followup_Tab scored fields are empty (bm-calls-count = null/0/undefined, bm-meetings-count = null/0/undefined, bm-actions-taken = none active, bm-next-date = empty, bm-guardian-phone = empty), THEN THE Tab_Scorer SHALL return `null`.

---

### Requirement 5: عرض السكور داخل كل تبويب (Score_Widget)

**User Story:** As a مرشد تربوي, I want a visual indicator at the top of each tab showing the current score and percentage, so that I can monitor each axis at a glance without navigating.

#### Acceptance Criteria

1. THE Score_Widget SHALL display at the top of each of the four tabs (economic, social, health/psych, followup) and contain:
   - The numeric score value (0–100)
   - A horizontal progress bar reflecting the percentage
   - A text classification: `منخفض` (0–39)، `متوسط` (40–69)، `مرتفع` (70–100)

2. THE Score_Widget SHALL apply dynamic colors mapped as follows:
   - Score_Level `منخفض` (0–39) → `--color-success-solid` (green)
   - Score_Level `متوسط` (40–69) → `--color-warning-solid` (orange)
   - Score_Level `مرتفع` (70–100) → `--color-danger-solid` (red)

3. WHEN Tab_Score is `null`, THE Score_Widget SHALL display `—` instead of a number, keep the progress bar container visible but at 0% width (not hidden), and show no classification label.

4. WHEN Tab_Score changes to a non-null value, THE Score_Widget SHALL update its display within 200 milliseconds.

5. THE Score_Widget SHALL be accessible: its container element SHALL carry `aria-label` in the format `"سكور [اسم المحور]: [القيمة] من 100 — [التصنيف]"` (e.g., `aria-label="سكور الجانب الاقتصادي: 45 من 100 — متوسط"`). WHEN Tab_Score is `null`, the aria-label SHALL be `"سكور [اسم المحور]: غير محسوب"`.

6. IF Tab_Score is a number outside [0, 100], THE Score_Widget SHALL clamp it to [0, 100] before rendering.

---

### Requirement 6: تحديث مؤشر الخطر المركّب

**User Story:** As a مرشد تربوي, I want the risk indicator in the "مؤشر الخطر" tab to accurately reflect all four tabs, so that the risk picture is comprehensive.

#### Acceptance Criteria

1. WHEN Tab_Score values for all four tabs are non-null numbers, THE Renderer SHALL pass the computed `social`, `economic`, and `health` values into Risk_Engine via an updated `collectRiskInputs()` instead of reading DOM only.

2. THE Risk_Engine SHALL preserve its existing interface signature — function name `computeStudentRisk`, parameter structure, and return value format — unchanged; updates are limited to how inputs are gathered in the Renderer.

3. WHEN Tab_Score values for all four tabs are available (non-null) in Risk_Tab context, THE Renderer SHALL display a summary card containing each axis name and its Tab_Score value alongside the Composite_Risk indicator.

4. IF Tab_Score for a given axis is `null`, THEN THE Renderer SHALL fall back to reading raw DOM values for that axis, preserving current behavior for that axis.

5. IF Tab_Score values are available for some axes but not all, THEN THE Renderer SHALL use Tab_Score for available axes and DOM fallback for the remaining axes.

6. WHEN `bmUpdateRisk()` is invoked, THE Renderer SHALL recompute Composite_Risk using the latest Tab_Score values (or DOM fallback where applicable).

---

### Requirement 7: الأداء والتوافق مع البنية القائمة

**User Story:** As a مطور النظام, I want the scoring system to work smoothly within the existing architecture (Electron + Vanilla JS) without new external dependencies.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL be implemented as a pure JavaScript module in a separate file `js/bm-scoring.js` with no DOM access and no IPC calls.

2. THE Tab_Scorer SHALL export one function per axis: `computeEconomicScore(data)`، `computeSocialScore(data)`، `computeHealthScore(data)`، `computeFollowupScore(data)` — all returning an object `{ score: number|null, level: string|null, subScores: object }`.

3. THE Tab_Scorer SHALL register itself on `window.GS2.BmScoring` and as a direct alias `window.computeBmScore`, consistent with the existing `window.GS2.StudentRisk` pattern.

4. WHILE the page is running in Electron, THE Score_Widget SHALL update scores via event listeners on `change` and `input` events within each tab, following the same pattern as the existing `initDirtyTracking()`.

5. THE Renderer SHALL automatically invoke Score_Widget computation when loading tab data from the database via `loadAllProfileTabs()`.

6. IF `js/bm-scoring.js` is not loaded, THEN THE Renderer SHALL skip score computation and continue with current behavior only (graceful degradation).

---

### Requirement 8: تغطية الاختبار والتحقق من الصحة

**User Story:** As a مطور النظام, I want to automatically verify scoring algorithm accuracy to ensure no drift occurs in calculations.

#### Acceptance Criteria

1. THE Tab_Scorer SHALL be importable in a Node.js environment via `require()` for testing purposes, without requiring HTML or Electron.

2. WHEN valid inputs (values within the defined range for each field) are provided to any axis scorer, THE Tab_Scorer SHALL return `score` within [0, 100].

3. IF all fields for an axis are absent (null, undefined, or empty string for strings; null or undefined for numbers — not zero), THEN THE Tab_Scorer SHALL return `null` instead of 0.

4. WHEN all fields of an axis are set to their worst-case values (maximum risk per field as defined in Requirements 1–4), THE Tab_Scorer SHALL return `score` equal to 100.

5. WHEN all fields of an axis are set to their best-case values (minimum risk per field as defined in Requirements 1–4), THE Tab_Scorer SHALL return `score` equal to 0.

6. THE Tab_Scorer SHALL maintain monotonicity across all four axis scorer functions: for any two input objects `a` and `b` where all field values in `b` are equal to or worse (higher risk direction) than in `a`, `computeXScore(b).score >= computeXScore(a).score`.
