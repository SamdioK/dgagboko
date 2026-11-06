# Supabase Persistence Migration — Data Mapping and Safety Audit

Repository: `SamdioK/dgagboko`  
Working branch: `feature/supabase-persistence-migration`  
Audit date: 2026-11-06

## Status

- `supabase-persistence.js` provides authenticated Supabase CRUD helpers.
- `index.html` loads that helper after the Supabase JS client and initialises it after creating `supabaseClient`.
- The legacy `CloudStorage` implementation is intentionally still active.
- No database schema, RLS policy, production branch, or existing browser data has been changed.
- This document is an implementation map, not an instruction to bulk-copy legacy JSON into relational tables.

## Storage mechanisms found

The application currently uses:
- `window.storage` when available;
- IndexedDB database `EResultDB`, object store `data`;
- `localStorage` fallback;
- `sessionStorage` for a temporary password-reset operation lock.

The current `CloudStorage.save()` and `globalSave()` return success when any browser-side backend succeeds. They do not write to Supabase. The current `load()` methods read browser-side stores in priority order. Therefore a successful legacy save is not evidence of cloud persistence.

## Legacy key inventory and proposed destinations

| Legacy key / data | Existing Supabase destination or proposal | Migration decision |
|---|---|---|
| `school:main`, `schoolInfo` | `schools` | Map only confirmed school columns. Logo/signature data needs Storage or dedicated metadata; do not write base64 blobs into URL columns. |
| `classArms` | `classes` | Normalise each class/arm to `school_id`, `level`, `arm`, `class_name`. Legacy arrays such as student name/sex slots are not class rows and must not be copied into this table. |
| `formMasters` | `profiles`, `profile_roles`, `form_master_assignments` | Use existing authenticated account/provisioning workflows. Never write passwords or create duplicate Auth users from the browser. |
| `subjectAssignments` | `teacher_assignments` | Resolve teacher, class, subject and academic-session UUIDs; preserve active assignment state and existing access checks. |
| `students_batch_* / students_meta` | `students`, `student_enrolments` and import tables | Use existing student import/approval RPC workflow. Do not bulk upsert around import approval or SID generation. |
| `managementStaff`, `schoolStaff`, `staffDatabase` | `school_staff_directory` | Reconcile duplicate legacy arrays and profile links first. Confirm write RLS policies before enabling writes. |
| `portalStaffSelections` | `school_staff_directory.show_on_portal` and possibly a future field-selection table | Preserve selected public fields; the current directory boolean alone may not represent all per-field choices. |
| `subAdministrators` | `profiles`, `profile_roles`, `role_permissions` | Must use authenticated administrator provisioning and role/permission workflows, not arbitrary client-side role writes. |
| `activityLog` | No confirmed audit-log table in the supplied 30-table inventory | Requires a dedicated append-only audit table and RLS design, or a verified existing audit destination. |
| `portalNews` | No confirmed news/announcements table in supplied inventory | Requires a new table and public-read/admin-write policy design. |
| `prefects` | No confirmed prefect table in supplied inventory | Requires a new table and publication/access policy design. |
| `dutyRoster` | No confirmed duty-roster table in supplied inventory | Requires a new table and school-scoped policies. |
| `portalSettings` | No confirmed portal-settings table in supplied inventory | Requires a school-scoped settings table; developer licensing fields need separate authority and must not be trusted from a public client. |
| `sig_*`, `signature_subjects` | Supabase Storage plus metadata | Define a private bucket/path, owner permissions, content type/size checks and metadata schema before migration. |
| `schoolIdCardSettings` | No confirmed table in supplied inventory | Requires a school-scoped configuration table and admin-only policies. |
| `portal:developer` | Authenticated developer profile / secure developer settings | Do not store developer identity, subscription controls or access grants as browser-global data. Require server-side authorisation. |
| `keyboardStyle:*`, `scoreEntryDirection:*` | Proposed `user_preferences` table | Low-risk per-user settings; table and RLS policy must be created before moving these preferences. |
| `activationResetV3` | Migration/version marker | Keep as a one-time migration marker until its old behaviour is fully retired; do not copy it as application business data. |
| `sessionStorage` password-reset operation lock | Browser session only | Keep ephemeral; it is not durable application data and should not be migrated. |

## Confirmed database tables relevant to the mapping

The supplied schema inventory includes:
- `schools`, `classes`, `academic_sessions`, `terms`, `subjects`;
- `profiles`, `profile_roles`, `permissions`, `role_permissions`;
- `form_master_assignments`, `teacher_assignments`;
- `students`, `student_enrolments`, `student_import_batches`, `student_import_rows`;
- `school_staff_directory`, `student_passports`;
- `results`, `assessment_configurations`, `form_master_student_assessments`;
- student/class change-request tables and related workflow tables.

All 30 supplied public tables were reported to have RLS enabled. RLS being enabled does not prove that a particular insert/update/delete is permitted. The exact write policies for several destination tables remain unverified.

## Critical rules before any write migration

1. Use only the existing Supabase anon/publishable key in browser code. Never expose a service-role key.
2. Keep RLS enabled. Do not weaken or bypass existing policies.
3. Resolve the authenticated user's active profile and school UUID; never trust a school ID supplied only by the browser.
4. Do not directly write privileged profile roles, student enrolments, import approvals, SID values, result statuses, or published results.
5. Use existing Edge Functions and database RPCs for account provisioning, student import approval, enrolment, and result workflow.
6. Keep browser-local data intact until the corresponding Supabase records have been read back and reconciled.
7. Do not use a generic JSON key/value table as a shortcut for relational school, student, result, or permission data.
8. Test with a non-production/test school or controlled test records before enabling any production write path. The preview and live repositories share the same Supabase project, so database writes affect both.

## Next implementation sequence

1. Verify authenticated profile context and school scoping in the persistence layer.
2. Complete a read-only comparison for `schools` and `classes`, including exact RLS policy checks.
3. Build a dry-run export/validation report for the legacy school and class data.
4. Implement a narrow, administrator-authorised write path only after the destination policies are confirmed.
5. Migrate students only through the existing import/approval workflow.
6. Add and secure any genuinely missing tables before moving news, prefects, rosters, portal settings, audit records or user preferences.
7. Remove browser fallback only after every category has passed reconciliation and multi-role testing.
