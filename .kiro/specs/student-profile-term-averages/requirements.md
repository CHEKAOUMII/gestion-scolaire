# Requirements Document

## Introduction

This feature clarifies and expands the academic average information shown on the student profile page (`student-profile.html` / prototype `student-profile-prototype.html`) of the Moroccan school management application (Arabic RTL, Electron).

Today the "إحصائيات سريعة" quick-stats card (element `sp-stat-avg`) and the grades tab KPIs row show a single "المعدل العام" value (for example `5.23`). That value is computed in `js/pages/student-profile.js` by pooling every grade record across both school terms — الدورة الأولى (Term 1) and الدورة الثانية (Term 2) — into one set of per-subject averages and then applying the branch coefficients. As a result the displayed number does not correspond to a single term, and the user cannot tell whether it represents Term 1, Term 2, or a combined value.

The goal of this feature is to:

1. Make the meaning of every displayed average explicit and unambiguous about its source term.
2. Display the Term 1 average (معدل الدورة 1) and the Term 2 average (معدل الدورة 2) separately, alongside the overall general average (المعدل العام).

This feature changes only how averages are computed and presented on the student profile page. It does not change how grades are stored, entered, or synchronized, and it reuses the existing computation helpers (`computeSubjectAverage`, `computeWeightedGeneralAverage`, `detectBranch`) from `js/cc-rules.js`.

## Glossary

- **Student_Profile_Page**: The renderer page implemented by `student-profile.html` and driven by `js/pages/student-profile.js`, which displays a single student's information.
- **Grade_Record**: A single stored mark for a student, including a `subject` name, a numeric `grade` value (0–20), and a `semester` field.
- **Semester_Field**: The `semester` property on a Grade_Record. A value of `1` denotes Term 1 (الدورة الأولى), a value of `2` denotes Term 2 (الدورة الثانية), and a value of `0`, missing, null, or unrecognized denotes an unspecified term.
- **Term_1**: The first school term (الدورة الأولى), identified by Semester_Field equal to `1`.
- **Term_2**: The second school term (الدورة الثانية), identified by Semester_Field equal to `2`.
- **Term_1_Average**: The weighted general average (0–20) computed from only the Term_1 Grade_Records of the student, labelled "معدل الدورة 1".
- **Term_2_Average**: The weighted general average (0–20) computed from only the Term_2 Grade_Records of the student, labelled "معدل الدورة 2".
- **General_Average**: The overall annual average (0–20) labelled "المعدل العام", defined as the mean of the available term averages (see Requirement 3).
- **Term_Average**: A collective term referring to either Term_1_Average or Term_2_Average.
- **Subject_Average**: The per-subject weighted continuous-monitoring average produced by `computeSubjectAverage` for one base subject within a single term.
- **Weighted_General_Average_Function**: The existing `computeWeightedGeneralAverage(subjectAverages, branch)` helper in `js/cc-rules.js` that combines Subject_Averages using branch coefficients.
- **Quick_Stats_Card**: The "إحصائيات سريعة" card in the profile sidebar containing the `sp-stat-avg`, `sp-stat-subjects`, and `sp-stat-absence` elements.
- **Grades_Tab**: The grades content section (`sp-grades-content`) of the Student_Profile_Page that renders the KPIs row and per-subject detail.
- **Branch**: The academic stream code returned by `detectBranch` for the student's section or class, used to look up subject coefficients.

## Requirements

### Requirement 1: Compute term-specific averages

**User Story:** As a school administrator viewing a student profile, I want each term's average computed independently, so that I can see the student's performance in الدورة 1 and الدورة 2 separately.

#### Acceptance Criteria

1. WHEN the Student_Profile_Page loads grade data for a student, THE Student_Profile_Page SHALL partition the student's Grade_Records into Term_1 records (Semester_Field equal to `1`) and Term_2 records (Semester_Field equal to `2`).
2. WHEN the Student_Profile_Page has partitioned the Grade_Records, THE Student_Profile_Page SHALL compute Term_1_Average from only the Term_1 Grade_Records, by grouping them into per-subject Subject_Averages and applying the Weighted_General_Average_Function with the student's Branch.
3. WHEN the Student_Profile_Page has partitioned the Grade_Records, THE Student_Profile_Page SHALL compute Term_2_Average from only the Term_2 Grade_Records, by grouping them into per-subject Subject_Averages and applying the Weighted_General_Average_Function with the student's Branch.
4. WHEN computing a Term_Average, THE Student_Profile_Page SHALL exclude from both Term_1_Average and Term_2_Average every Grade_Record whose Semester_Field is null, empty, or holds any value other than `1` or `2`.
5. THE Student_Profile_Page SHALL compute each Term_Average using the same coefficient and subject-weighting rules currently applied by `computeSubjectAverage` and `computeWeightedGeneralAverage`.
6. IF a Term has zero Grade_Records after partitioning, THEN THE Student_Profile_Page SHALL set that Term_Average to an empty (no-value) result rather than `0`, and SHALL display an indicator that no grades exist for that term.

### Requirement 2: Handle terms with missing grade data

**User Story:** As a school administrator, I want the profile to behave predictably when a term has no recorded grades, so that the display is never misleading.

#### Acceptance Criteria

1. IF a student has zero Term_1 Grade_Records, THEN THE Student_Profile_Page SHALL mark Term_1_Average as unavailable, compute no numeric Term_1_Average value, and display the single placeholder character "-" in place of the Term_1_Average value.
2. IF a student has zero Term_2 Grade_Records, THEN THE Student_Profile_Page SHALL mark Term_2_Average as unavailable, compute no numeric Term_2_Average value, and display the single placeholder character "-" in place of the Term_2_Average value.
3. IF a student has zero Grade_Records across all terms, THEN THE Student_Profile_Page SHALL mark Term_1_Average, Term_2_Average, and General_Average as unavailable and display the single placeholder character "-" for each of Term_1_Average, Term_2_Average, and General_Average.
4. WHERE the only Grade_Records that exist for a student have an unspecified Semester_Field, THE Student_Profile_Page SHALL mark both Term_1_Average and Term_2_Average as unavailable and display the single placeholder character "-" for each, excluding those records from any average computation.
5. IF either Term_1_Average or Term_2_Average is marked as unavailable, THEN THE Student_Profile_Page SHALL mark General_Average as unavailable and display the single placeholder character "-" in place of the General_Average value.

### Requirement 3: Define and compute the overall general average

**User Story:** As a school administrator, I want a clearly defined overall general average, so that the "المعدل العام" value is unambiguous about how it is derived.

#### Acceptance Criteria

1. WHEN both Term_1_Average and Term_2_Average are available, THE Student_Profile_Page SHALL compute General_Average as the arithmetic mean of Term_1_Average and Term_2_Average, applying equal weight (50%) to each term and rounding the result to 2 decimal places.
2. WHEN exactly one Term_Average is available, THE Student_Profile_Page SHALL set General_Average equal to that available Term_Average, rounded to 2 decimal places.
3. IF neither Term_1_Average nor Term_2_Average is available, THEN THE Student_Profile_Page SHALL mark General_Average as unavailable and SHALL display a visible non-numeric placeholder indicating that no average can be computed, while retaining the underlying Grade_Records unchanged.
4. WHEN General_Average is available, THE Student_Profile_Page SHALL produce a General_Average value within the inclusive range 0 to 20.
5. WHERE Grade_Records with an unspecified Semester_Field exist, THE Student_Profile_Page SHALL exclude those records from the General_Average computation.
6. IF a computed General_Average falls outside the inclusive range 0 to 20, THEN THE Student_Profile_Page SHALL mark General_Average as unavailable and SHALL display a visible non-numeric placeholder indicating an invalid computation, without persisting the out-of-range value.

### Requirement 4: Display term and general averages in the quick-stats card

**User Story:** As a school administrator, I want the quick-stats card to show معدل الدورة 1, معدل الدورة 2, and المعدل العام, so that I can read all three averages at a glance.

#### Acceptance Criteria

1. THE Quick_Stats_Card SHALL display Term_1_Average labelled "معدل الدورة 1".
2. THE Quick_Stats_Card SHALL display Term_2_Average labelled "معدل الدورة 2".
3. THE Quick_Stats_Card SHALL display General_Average labelled "المعدل العام".
4. WHEN an average value is present (non-null and within the valid range of 0.00 to 20.00 inclusive), THE Quick_Stats_Card SHALL display that value formatted to exactly two decimal places.
5. WHEN an average value is present, THE Quick_Stats_Card SHALL apply the existing grade color coding (via `gradeHex`) corresponding to that value.
6. IF an average value is absent (null or undefined), THEN THE Quick_Stats_Card SHALL display a placeholder indicator ("—") in place of that value and SHALL NOT apply grade color coding.
7. IF an average value is non-null but outside the range 0.00 to 20.00, THEN THE Quick_Stats_Card SHALL display the placeholder indicator ("—") in place of that value and SHALL NOT apply grade color coding.
8. THE Quick_Stats_Card SHALL render the three average labels and values with right-to-left text direction and right-aligned label-value pairs.

### Requirement 5: Display term and general averages in the grades tab

**User Story:** As a school administrator, I want the grades tab KPIs to show both term averages and the general average, so that the detailed grades view matches the quick-stats card.

#### Acceptance Criteria

1. THE Grades_Tab SHALL display Term_1_Average labelled "معدل الدورة 1" in the KPIs row.
2. THE Grades_Tab SHALL display Term_2_Average labelled "معدل الدورة 2" in the KPIs row.
3. THE Grades_Tab SHALL display General_Average labelled "المعدل العام" in the KPIs row.
4. IF an average value is available (a non-null numeric value), THEN THE Grades_Tab SHALL display that value formatted to exactly two decimal places, rounded to two decimal places.
5. IF an average value is available (a non-null numeric value), THEN THE Grades_Tab SHALL apply the existing grade color coding (via `gradeHex`) corresponding to that value.
6. THE Grades_Tab SHALL continue to display the existing subject count, grade count, highest grade, and lowest grade KPIs.
7. IF an average value is unavailable (null or no qualifying grades), THEN THE Grades_Tab SHALL display the single placeholder character "-" in place of that value and SHALL NOT apply grade color coding.

### Requirement 6: Preserve consistency and downstream consumers

**User Story:** As a developer maintaining the application, I want the averages to be consistent across the page and to keep existing print behavior working, so that no other feature breaks.

#### Acceptance Criteria

1. WHEN the Student_Profile_Page renders Term_1_Average, Term_2_Average, and General_Average, THE Student_Profile_Page SHALL display values that are identical to two decimal places between the Quick_Stats_Card and the Grades_Tab for each of the three averages.
2. THE Quick_Stats_Card SHALL keep the element with identifier `sp-stat-avg` populated with the General_Average value so that the existing profile print logic continues to read a numeric general average.
3. WHEN General_Average is available, THE element with identifier `sp-stat-avg` SHALL contain a value parseable as a number formatted to exactly two decimal places within the range 0.00 to 20.00.
4. IF General_Average is unavailable because no qualifying grades exist, THEN THE element with identifier `sp-stat-avg` SHALL contain a placeholder value that the existing print logic treats as no numeric average, and the same placeholder SHALL appear identically in both the Quick_Stats_Card and the Grades_Tab.
5. THE Student_Profile_Page SHALL reuse the existing `computeSubjectAverage`, `computeWeightedGeneralAverage`, and `detectBranch` helpers rather than introducing a separate averaging implementation.
