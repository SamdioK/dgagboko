/* DE-GLOBAL ACADEMY GBOKO — Supabase persistence foundation
 * This module deliberately does not read from or write to browser storage.
 * It relies on the existing Supabase client and authenticated user's RLS policies.
 * Never place a service-role key in browser code.
 */
(function (global) {
  'use strict';

  function create(client) {
    if (!client || typeof client.from !== 'function' || !client.auth) throw new Error('A valid Supabase client is required.');

    async function requireAuthenticatedUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data || !data.user) throw new Error('Your session has expired. Please sign in again.');
      return data.user;
    }
    function validateTable(table) {
      if (typeof table !== 'string' || !/^[a-z][a-z0-9_]*$/.test(table)) throw new Error('Invalid Supabase table name.');
    }
    function validateFilters(filters) {
      if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).length === 0) {
        throw new Error('A non-empty filter is required for this operation.');
      }
    }
    async function select(table, options) {
      validateTable(table); await requireAuthenticatedUser();
      const opts = options || {};
      let query = client.from(table).select(opts.columns || '*');
      if (opts.filters) Object.entries(opts.filters).forEach(([key, value]) => { query = value === null ? query.is(key, null) : query.eq(key, value); });
      if (opts.orderBy) query = query.order(opts.orderBy, { ascending: opts.ascending !== false });
      if (Number.isInteger(opts.limit) && opts.limit > 0) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
    async function insert(table, rows, returning) {
      validateTable(table); await requireAuthenticatedUser();
      if (!rows || (Array.isArray(rows) && rows.length === 0)) throw new Error('Insert data is required.');
      const { data, error } = await client.from(table).insert(rows).select(returning || '*');
      if (error) throw error;
      return data || [];
    }
    async function update(table, values, filters, returning) {
      validateTable(table); validateFilters(filters); await requireAuthenticatedUser();
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) throw new Error('Update values are required.');
      let query = client.from(table).update(values);
      Object.entries(filters).forEach(([key, value]) => { query = value === null ? query.is(key, null) : query.eq(key, value); });
      const { data, error } = await query.select(returning || '*');
      if (error) throw error;
      return data || [];
    }
    async function upsert(table, rows, conflictColumns, returning) {
      validateTable(table); await requireAuthenticatedUser();
      if (!conflictColumns || typeof conflictColumns !== 'string') throw new Error('Explicit conflict columns are required for upsert.');
      const { data, error } = await client.from(table).upsert(rows, { onConflict: conflictColumns }).select(returning || '*');
      if (error) throw error;
      return data || [];
    }
    async function remove(table, filters) {
      validateTable(table); validateFilters(filters); await requireAuthenticatedUser();
      let query = client.from(table).delete();
      Object.entries(filters).forEach(([key, value]) => { query = value === null ? query.is(key, null) : query.eq(key, value); });
      const { data, error } = await query.select('id');
      if (error) throw error;
      return data || [];
    }

    async function getActiveSchoolProfile(user) {
      const result = await client.from('profiles').select('id,school_id,is_active').eq('id', user.id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || result.data.is_active !== true || !result.data.school_id) {
        throw new Error('An active school-linked profile is required for this audit.');
      }
      return result.data;
    }

    async function auditSchoolAndClasses() {
      const user = await requireAuthenticatedUser();
      const profile = await getActiveSchoolProfile(user);
      const schoolResult = await client.from('schools').select('id,name,address,phone,email,logo_url,motto').eq('id', profile.school_id).maybeSingle();
      if (schoolResult.error) throw schoolResult.error;
      if (!schoolResult.data) throw new Error('The authenticated profile school is not visible in schools. Check its record and SELECT RLS policy.');
      const classesResult = await client.from('classes').select('id,school_id,level,arm,class_name,created_at').eq('school_id', profile.school_id).order('class_name', { ascending: true });
      if (classesResult.error) throw classesResult.error;
      const rows = classesResult.data || [], seen = new Set(), duplicates = [];
      rows.forEach(row => { const key = String(row.class_name || '').trim().toLowerCase(); if (seen.has(key)) duplicates.push(row.class_name); seen.add(key); });
      return { readOnly: true, userId: user.id, profileId: profile.id, schoolId: profile.school_id, school: schoolResult.data, classCount: rows.length, classes: rows, duplicateClassNames: duplicates };
    }

    async function auditSchoolDataCounts() {
      const user = await requireAuthenticatedUser();
      const profile = await getActiveSchoolProfile(user);
      const tables = [
        ['students', 'Students'], ['student_enrolments', 'Student enrolments'],
        ['form_master_assignments', 'Form Master assignments'], ['teacher_assignments', 'Teacher/subject assignments'],
        ['school_staff_directory', 'School staff records'], ['academic_sessions', 'Academic sessions'],
        ['terms', 'Terms'], ['assessment_configurations', 'Assessment configurations']
      ];
      const checks = await Promise.all(tables.map(async ([table, label]) => {
        try {
          const result = await client.from(table).select('id', { count: 'exact', head: true }).eq('school_id', profile.school_id);
          if (result.error) return { table, label, status: 'error', count: null, message: result.error.message };
          return { table, label, status: 'ok', count: result.count == null ? 0 : result.count };
        } catch (error) { return { table, label, status: 'error', count: null, message: error.message || 'Read failed' }; }
      }));
      return { readOnly: true, profileId: profile.id, schoolId: profile.school_id, checks,
        successfulChecks: checks.filter(item => item.status === 'ok').length,
        failedChecks: checks.filter(item => item.status === 'error').length };
    }

    async function auditStudentEnrolmentIntegrity() {
      const user = await requireAuthenticatedUser();
      const profile = await getActiveSchoolProfile(user);
      // IDs only: no names, admission numbers, contact details or other personal data are fetched.
      const [studentsResult, enrolmentsResult, classesResult, sessionsResult] = await Promise.all([
        client.from('students').select('id').eq('school_id', profile.school_id),
        client.from('student_enrolments').select('id,student_id,class_id,academic_session_id').eq('school_id', profile.school_id),
        client.from('classes').select('id').eq('school_id', profile.school_id),
        client.from('academic_sessions').select('id').eq('school_id', profile.school_id)
      ]);
      for (const result of [studentsResult, enrolmentsResult, classesResult, sessionsResult]) {
        if (result.error) throw result.error;
      }
      const students = studentsResult.data || [], enrolments = enrolmentsResult.data || [];
      const studentIds = new Set(students.map(row => row.id));
      const classIds = new Set((classesResult.data || []).map(row => row.id));
      const sessionIds = new Set((sessionsResult.data || []).map(row => row.id));
      const enrolledStudentIds = new Set();
      const enrolmentKeys = new Set();
      const duplicateStudentSessionPairs = [];
      let orphanStudentReferences = 0, missingClassReferences = 0, missingSessionReferences = 0;
      enrolments.forEach(row => {
        if (!studentIds.has(row.student_id)) orphanStudentReferences++;
        if (!classIds.has(row.class_id)) missingClassReferences++;
        if (!sessionIds.has(row.academic_session_id)) missingSessionReferences++;
        enrolledStudentIds.add(row.student_id);
        const key = String(row.student_id) + '|' + String(row.academic_session_id);
        if (enrolmentKeys.has(key)) duplicateStudentSessionPairs.push(key);
        enrolmentKeys.add(key);
      });
      const studentsWithoutAnyEnrolment = students.filter(row => !enrolledStudentIds.has(row.id)).length;
      return {
        readOnly: true, schoolId: profile.school_id,
        studentCount: students.length, enrolmentCount: enrolments.length,
        studentsWithoutAnyEnrolment, orphanStudentReferences,
        missingClassReferences, missingSessionReferences,
        duplicateStudentSessionPairs: duplicateStudentSessionPairs.length,
        classCount: classIds.size, academicSessionCount: sessionIds.size
      };
    }


    async function auditAssignmentIntegrity() {
      const user = await requireAuthenticatedUser();
      const profile = await getActiveSchoolProfile(user);
      // Fetch identifiers and assignment links only. No names or contact details are read.
      const [formMastersResult, teacherAssignmentsResult, classesResult, sessionsResult, subjectsResult] = await Promise.all([
        client.from('form_master_assignments').select('id,school_id,teacher_id,class_id,academic_session_id').eq('school_id', profile.school_id),
        client.from('teacher_assignments').select('id,school_id,teacher_id,class_id,subject_id,academic_session_id,is_active').eq('school_id', profile.school_id),
        client.from('classes').select('id').eq('school_id', profile.school_id),
        client.from('academic_sessions').select('id').eq('school_id', profile.school_id),
        client.from('subjects').select('id').eq('school_id', profile.school_id)
      ]);
      for (const result of [formMastersResult, teacherAssignmentsResult, classesResult, sessionsResult, subjectsResult]) {
        if (result.error) throw result.error;
      }

      const formMasters = formMastersResult.data || [];
      const teacherAssignments = teacherAssignmentsResult.data || [];
      const classIds = new Set((classesResult.data || []).map(row => row.id));
      const sessionIds = new Set((sessionsResult.data || []).map(row => row.id));
      const subjectIds = new Set((subjectsResult.data || []).map(row => row.id));

      function inspect(rows, type) {
        const seen = new Set();
        let missingTeacherIds = 0, missingClassReferences = 0, missingSessionReferences = 0;
        let missingSubjectReferences = 0, duplicateAssignments = 0, crossSchoolRows = 0;
        rows.forEach(row => {
          if (!row.teacher_id) missingTeacherIds++;
          if (!classIds.has(row.class_id)) missingClassReferences++;
          if (!sessionIds.has(row.academic_session_id)) missingSessionReferences++;
          if (type === 'teacher' && !subjectIds.has(row.subject_id)) missingSubjectReferences++;
          if (row.school_id !== profile.school_id) crossSchoolRows++;
          const key = type === 'form'
            ? [row.teacher_id, row.class_id, row.academic_session_id].join('|')
            : [row.teacher_id, row.class_id, row.subject_id, row.academic_session_id].join('|');
          if (seen.has(key)) duplicateAssignments++;
          seen.add(key);
        });
        return { total: rows.length, missingTeacherIds, missingClassReferences,
          missingSessionReferences, missingSubjectReferences, duplicateAssignments, crossSchoolRows };
      }

      return {
        readOnly: true, schoolId: profile.school_id,
        formMasterAssignments: inspect(formMasters, 'form'),
        teacherSubjectAssignments: inspect(teacherAssignments, 'teacher'),
        referenceCounts: { classes: classIds.size, academicSessions: sessionIds.size, subjects: subjectIds.size },
        note: 'Teacher profile existence is not independently counted because profile SELECT access is restricted by RLS. Non-null teacher IDs and database foreign keys remain the available checks.'
      };
    }

    return Object.freeze({ select, insert, update, upsert, remove, auditSchoolAndClasses, auditSchoolDataCounts, auditStudentEnrolmentIntegrity, auditAssignmentIntegrity });
  }
  global.SupabasePersistence = Object.freeze({ create });
})(window);
