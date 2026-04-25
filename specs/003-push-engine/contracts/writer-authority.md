# Contract: Writer Authority

**Feature**: 003-push-engine
**Type**: Static constant (`main/sync/authority.js`)

## Writer Authority Matrix

Defines which user roles are permitted to push changes for each data domain.

```js
const WRITER_AUTHORITY = {
    // Student domain — admin only
    students:              ['admin'],
    correspondence:        ['admin'],
    student_files:         ['admin'],
    student_movements:     ['admin'],

    // Academic domain — admin + staff
    grades:                ['admin', 'staff'],
    absences:              ['admin', 'staff'],

    // Staff domain — admin only
    teachers:              ['admin'],
    teacher_aliases:       ['admin'],
    staff_attendance:      ['admin'],
    compensation_tracking: ['admin'],
    teacher_absences:      ['admin'],

    // Exam domain — admin only
    exams:                 ['admin'],
    exam_proctors:         ['admin'],
    exam_rooms:            ['admin'],
    tests:                 ['admin'],

    // System domain — admin only
    settings:              ['admin'],
    page_visibility:       ['admin'],
};
```

## Interface

### `canPush(tableName, role)` → `boolean`

Returns `true` if the given role is authorized to push changes for the specified table.

**Behavior**:
- If `tableName` is not in the matrix: return `false` (deny by default)
- If `role` is `null`/`undefined`: return `false`
- Check: `WRITER_AUTHORITY[tableName]?.includes(role)`

### `getAuthorizedTables(role)` → `string[]`

Returns the list of tables the given role is allowed to push.

## Role Source

The push engine runs as a background process — there is no IPC event to extract the role from. The role is determined by:

1. Reading the active session from the in-memory session map (checking all active sessions)
2. If multiple sessions exist, use the highest-privilege role (`admin` > `staff`)
3. If no session exists (no user logged in), skip the flush cycle entirely

**Rationale**: The push engine must not push data when no user is logged in, because:
- The session determines writer authority
- A locked/logged-out PC should not be pushing changes
- This prevents unauthorized pushes from unattended machines
