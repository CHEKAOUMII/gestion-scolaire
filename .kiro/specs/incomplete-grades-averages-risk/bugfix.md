# Bugfix Requirements Document

## Introduction

The student profile page (`student-profile-prototype.html` / `js/pages/student-profile.js`) and its PDF/print export surface two confirmed defects when the school year is still in progress and Term‑2 (الدورة الثانية) marks have not been entered yet.

**Bug 1 (PRIMARY) — not-yet-entered grades are treated as real zeros.** Marks that have not been entered yet are represented/treated as `0.00` and counted as genuine zeros by the averaging layer (`js/student-averages.js` → `js/cc-rules.js`). This deflates subject averages (e.g. التربية البدنية shows ~9.38 instead of ~18.75), produces a misleading Term‑2 average (1.61) and general average (5.01 instead of the Term‑1 value of 8.42), and makes the lowest-mark KPI report a phantom `0.0`. A "not entered yet" mark must be distinguished from a genuine, deliberately recorded `0` (a rare but meaningful value: exam absence/cheating) which must remain a distinct explicit value.

**Bug 2 (SECONDARY) — the dropout-risk gauge looks self-contradictory.** The risk tab labels the overall level "حرج" while the composite bar reads 24.39%, which sits in the "عادي/normal" zone (legend: 0–30 عادي, 31 خطر, 61 حرج). The weighted composite design is intentional and the "worst-wins" rule (`finalLevel = max(layer1Level, layer2Level)` in `js/student-risk.js`) is intended to stay. The contradiction is a DISPLAY problem: the gauge/level is colored by the composite percentage instead of the final level, and there is no indication of which axis triggered the classification.

**Dependency & priority.** Bug 1 partly causes risk Axis A to be classified حرج (phantom zeros inflate the "subjects below 10/20" share), so Bug 1 is the priority. Additionally, while the season is in progress and data is incomplete, the risk index should be presented as preliminary ("أولي / قيد الإنجاز") rather than at full confidence.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered:

1.1 WHEN a subject has marks for one term but its other-term marks have not been entered yet (represented/treated as `0`) THEN the system averages those not-entered marks in as genuine zeros, deflating the subject average (e.g. التربية البدنية: Term‑1 20.00 / 18.75 / 17.50, Term‑2 all `0.00` → subject average shows 9.38 instead of ~18.75).

1.2 WHEN a term has no real entered marks (all of its marks are not-entered placeholders) THEN the system still produces a numeric term average from those phantom zeros (e.g. Term‑2 average shows 1.61).

1.3 WHEN the general average is computed for a student whose Term‑2 has no real entered marks THEN the system averages the real Term‑1 value with the phantom Term‑2 value (e.g. general = (8.42 + 1.61)/2 = 5.01), understating the student's true standing.

1.4 WHEN the lowest-mark KPI is computed for a student with not-entered marks THEN the system reports `0.0` drawn from those phantom zeros.

1.5 WHEN the final risk level is "حرج" but the weighted composite index is in the عادي zone (e.g. 24.39%) THEN the system colors the gauge/level by the composite percentage, so the overall label and the gauge contradict each other.

1.6 WHEN a single axis (e.g. Axis A النتائج الدراسية) forces the final level to "حرج" via the worst-wins rule THEN the system gives no indication of which axis triggered the classification, making the result look like an error.

1.7 WHEN the risk index is computed during an in-progress year with incomplete data THEN the system presents it at full confidence with no "preliminary" indication.

### Expected Behavior (Correct)

What should happen instead:

2.1 WHEN a subject has marks for one term but its other-term marks have not been entered yet THEN the system SHALL exclude the not-entered marks from the subject average and present them as "قيد الإنجاز"/"—" rather than counting them as `0` (so التربية البدنية's average reflects only its real Term‑1 marks, ~18.75).

2.2 WHEN a term has no real entered marks THEN the system SHALL NOT produce a numeric term average and SHALL present that term as "قيد الإنجاز"/"—".

2.3 WHEN the general average is computed for a student whose Term‑2 has no real entered marks THEN the system SHALL base the general average only on terms/subjects that have real entered data (so the general average reflects the Term‑1 value, 8.42).

2.4 WHEN the lowest-mark KPI is computed for a student with not-entered marks THEN the system SHALL ignore the not-entered marks and report the lowest among real entered marks only.

2.5 WHEN the final risk level differs from the composite-index zone THEN the system SHALL color the gauge/level by the FINAL level and SHALL display the composite index ("المؤشر المركّب = 24.39%") and the highest axis ("أعلى محور = حرج") as clearly separated, non-contradictory pieces of information.

2.6 WHEN a single axis forces the final level via the worst-wins rule THEN the system SHALL surface a prominent badge naming the triggering axis (e.g. "صُنّف حرج بسبب محور: النتائج الدراسية").

2.7 WHEN the risk index is computed during an in-progress year with incomplete data THEN the system SHALL compute on available data only and SHALL present the result as preliminary ("أولي / قيد الإنجاز") rather than at full confidence.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved:

3.1 WHEN a mark is a genuine, deliberately recorded `0` (e.g. exam absence/cheating) THEN the system SHALL CONTINUE TO treat it as a real `0` and include it in averages and KPIs as a distinct explicit value.

3.2 WHEN a student has complete entered data for all terms and subjects THEN the system SHALL CONTINUE TO compute identical subject, term, and general averages to those produced today.

3.3 WHEN a term or general average is already correct (computed only from real entered marks) THEN the system SHALL CONTINUE TO display that same value unchanged.

3.4 WHEN a student is failing most subjects (more than 70% below 10/20 from real marks) THEN the system SHALL CONTINUE TO classify the file as "حرج" via the worst-wins rule.

3.5 WHEN the composite risk index is computed THEN the system SHALL CONTINUE TO use the intended weighted formula (A النتائج 30% + B الغياب 30% + C الاجتماعي 15% + D الاقتصادي 15% + E الصحي 10%).

3.6 WHEN the final risk level and the composite-index zone already agree THEN the system SHALL CONTINUE TO display a consistent, non-contradictory gauge with the same level and color as today.
