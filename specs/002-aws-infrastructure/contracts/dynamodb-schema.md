# Contract: DynamoDB Table Schema

**Feature**: 002-aws-infrastructure
**Type**: AWS DynamoDB single-table design

## Table: `pencil2-sync`

### Keys

| Key | Attribute | Type | Pattern |
|-----|-----------|------|---------|
| Partition key | `PK` | String | `SCHOOL#<customerRef>` |
| Sort key | `SK` | String | `<ENTITY_TYPE>#<compositeId>` |

### Global Secondary Index: `SyncGSI`

| Key | Attribute | Type | Pattern |
|-----|-----------|------|---------|
| Partition key | `GSI1PK` | String | `SCHOOL#<customerRef>` (same as PK) |
| Sort key | `GSI1SK` | String | `<updatedAt>#<entityType>#<entityId>` |

**Projection**: ALL

### Write Contract (Push)

Every item written to the table MUST include:

```json
{
  "PK": "SCHOOL#<customerRef>",
  "SK": "<ENTITY_TYPE>#<compositeId>",
  "GSI1PK": "SCHOOL#<customerRef>",
  "GSI1SK": "<updatedAt>#<entityType>#<entityId>",
  "entityType": "<lowercase-entity-name>",
  "schoolYear": "<year/year>",
  "updatedAt": 1710000000,
  "version": 1,
  "operation": "PUT|DEL",
  "rowSyncId": "<deviceHash>:<table_name>:<local_id>",
  "deviceHash": "<first-16-chars-of-device-hash>",
  "data": { ... },
  "expiresAt": 1712592000
}
```

### Read Contract (Pull via GSI)

Pull query pattern:

```
Query SyncGSI
  KeyConditionExpression: GSI1PK = :schoolPk AND GSI1SK > :lastSyncTimestamp
  Limit: 500
  ScanIndexForward: true
```

Returns items ordered chronologically. Client stores the highest `GSI1SK` value as the sync cursor for the next pull.

### Conditional Write (Conflict Prevention)

All writes MUST use a condition expression for optimistic locking:

```
ConditionExpression: attribute_not_exists(version) OR version < :newVersion
```

If the condition fails (`ConditionalCheckFailedException`), the write is rejected — the item was modified by another device with a higher version.

### Entity Type Sort Key Registry

| `entityType` | `SK` Pattern | Source Table |
|--------------|-------------|--------------|
| `student` | `STUDENT#<studentCode>` | `students` |
| `grade` | `GRADE#<studentCode>#<subject>#<semester>#<schoolYear>` | `grades` |
| `absence` | `ABSENCE#<studentCode>#<month>#<schoolYear>#<absenceType>` | `absences` |
| `teacher` | `TEACHER#<teacherId>` | `teachers` |
| `teacher_alias` | `TEACHER_ALIAS#<aliasId>` | `teacher_aliases` |
| `staff_attendance` | `STAFF_ATTENDANCE#<teacherId>#<date>` | `staff_attendance` |
| `teacher_absence` | `TEACHER_ABSENCE#<teacherId>#<date>` | `teacher_absences` |
| `exam` | `EXAM#<examId>` | `exams` |
| `exam_proctor` | `EXAM_PROCTOR#<examId>#<teacherId>` | `exam_proctors` |
| `exam_room` | `EXAM_ROOM#<examId>#<roomId>` | `exam_rooms` |
| `test` | `TEST#<testId>` | `tests` |
| `correspondence` | `CORRESPONDENCE#<correspondenceId>` | `correspondence` |
| `student_file` | `STUDENT_FILE#<studentCode>#<fileId>` | `student_files` |
| `student_movement` | `STUDENT_MOVEMENT#<movementId>` | `student_movements` |
| `compensation` | `COMPENSATION#<trackingId>` | `compensation_tracking` |
| `settings` | `SETTINGS#<settingKey>` | `settings` |
| `page_visibility` | `PAGE_VISIBILITY#<pageKey>` | `page_visibility` |
