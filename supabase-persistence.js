/* DE-GLOBAL ACADEMY GBOKO — Supabase persistence foundation
 * This module deliberately does not read from or write to browser storage.
 * It relies on the existing Supabase client and authenticated user's RLS policies.
 * Never place a service-role key in browser code.
 */
(function (global) {
  'use strict';

  function create(client) {
    if (!client || typeof client.from !== 'function' || !client.auth) {
      throw new Error('A valid Supabase client is required.');
    }

    async function requireAuthenticatedUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data || !data.user) throw new Error('Your session has expired. Please sign in again.');
      return data.user;
    }

    function validateTable(table) {
      if (typeof table !== 'string' || !/^[a-z][a-z0-9_]*$/.test(table)) {
        throw new Error('Invalid Supabase table name.');
      }
    }

    function validateFilters(filters) {
      if (!filters || typeof filters !== 'object' || Array.isArray(filters) ||
          Object.keys(filters).length === 0) {
        throw new Error('A non-empty filter is required for this operation.');
      }
    }

    async function select(table, options) {
      validateTable(table);
      await requireAuthenticatedUser();
      const opts = options || {};
      let query = client.from(table).select(opts.columns || '*');
      if (opts.filters) Object.entries(opts.filters).forEach(([key, value]) => {
        query = value === null ? query.is(key, null) : query.eq(key, value);
      });
      if (opts.orderBy) query = query.order(opts.orderBy, { ascending: opts.ascending !== false });
      if (Number.isInteger(opts.limit) && opts.limit > 0) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async function insert(table, rows, returning) {
      validateTable(table);
      await requireAuthenticatedUser();
      if (!rows || (Array.isArray(rows) && rows.length === 0)) throw new Error('Insert data is required.');
      const { data, error } = await client.from(table).insert(rows).select(returning || '*');
      if (error) throw error;
      return data || [];
    }

    async function update(table, values, filters, returning) {
      validateTable(table);
      validateFilters(filters);
      await requireAuthenticatedUser();
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
          Object.keys(values).length === 0) throw new Error('Update values are required.');
      let query = client.from(table).update(values);
      Object.entries(filters).forEach(([key, value]) => {
        query = value === null ? query.is(key, null) : query.eq(key, value);
      });
      const { data, error } = await query.select(returning || '*');
      if (error) throw error;
      return data || [];
    }

    async function upsert(table, rows, conflictColumns, returning) {
      validateTable(table);
      await requireAuthenticatedUser();
      if (!conflictColumns || typeof conflictColumns !== 'string') {
        throw new Error('Explicit conflict columns are required for upsert.');
      }
      const { data, error } = await client.from(table)
        .upsert(rows, { onConflict: conflictColumns }).select(returning || '*');
      if (error) throw error;
      return data || [];
    }

    async function remove(table, filters) {
      validateTable(table);
      validateFilters(filters);
      await requireAuthenticatedUser();
      let query = client.from(table).delete();
      Object.entries(filters).forEach(([key, value]) => {
        query = value === null ? query.is(key, null) : query.eq(key, value);
      });
      const { data, error } = await query.select('id');
      if (error) throw error;
      return data || [];
    }

    async function auditSchoolAndClasses() {
      const user = await requireAuthenticatedUser();
      const profileResult = await client.from('profiles')
        .select('id,school_id,role,is_active').eq('id', user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const profile = profileResult.data;
      if (!profile || profile.is_active !== true || !profile.school_id) {
        throw new Error('An active school-linked profile is required for this audit.');
      }

      const schoolResult = await client.from('schools')
        .select('id,name,address,phone,email,logo_url,motto')
        .eq('id', profile.school_id).maybeSingle();
      if (schoolResult.error) throw schoolResult.error;
      if (!schoolResult.data) {
        throw new Error('The authenticated profile school is not visible in schools. Check its record and SELECT RLS policy.');
      }

      const classesResult = await client.from('classes')
        .select('id,school_id,level,arm,class_name,created_at')
        .eq('school_id', profile.school_id).order('class_name', { ascending: true });
      if (classesResult.error) throw classesResult.error;

      const rows = classesResult.data || [];
      const seen = new Set();
      const duplicates = [];
      rows.forEach(row => {
        const key = String(row.class_name || '').trim().toLowerCase();
        if (seen.has(key)) duplicates.push(row.class_name);
        seen.add(key);
      });

      return {
        readOnly: true, userId: user.id, profileId: profile.id,
        schoolId: profile.school_id, role: profile.role, school: schoolResult.data,
        classCount: rows.length, classes: rows, duplicateClassNames: duplicates
      };
    }

    async function auditSchoolDataCounts() {
      const user = await requireAuthenticatedUser();
      const profileResult = await client.from('profiles')
        .select('id,school_id,is_active').eq('id', user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const profile = profileResult.data;
      if (!profile || profile.is_active !== true || !profile.school_id) {
        throw new Error('An active school-linked profile is required for this audit.');
      }

      // Exact head counts only: no student/staff personal records are downloaded.
      // Each table is isolated so a missing SELECT policy is reported, not hidden as zero.
      const tables = [
        ['students', 'Students'],
        ['student_enrolments', 'Student enrolments'],
        ['form_master_assignments', 'Form Master assignments'],
        ['teacher_assignments', 'Teacher/subject assignments'],
        ['school_staff_directory', 'School staff records'],
        ['academic_sessions', 'Academic sessions'],
        ['terms', 'Terms'],
        ['assessment_configurations', 'Assessment configurations']
      ];

      const checks = await Promise.all(tables.map(async ([table, label]) => {
        try {
          const result = await client.from(table).select('id', { count: 'exact', head: true })
            .eq('school_id', profile.school_id);
          if (result.error) return { table, label, status: 'error', count: null, message: result.error.message };
          return { table, label, status: 'ok', count: result.count == null ? 0 : result.count };
        } catch (error) {
          return { table, label, status: 'error', count: null, message: error.message || 'Read failed' };
        }
      }));

      return {
        readOnly: true,
        profileId: profile.id,
        schoolId: profile.school_id,
        checks,
        successfulChecks: checks.filter(item => item.status === 'ok').length,
        failedChecks: checks.filter(item => item.status === 'error').length
      };
    }

    return Object.freeze({
      select, insert, update, upsert, remove,
      auditSchoolAndClasses, auditSchoolDataCounts
    });
  }

  global.SupabasePersistence = Object.freeze({ create });
})(window);
