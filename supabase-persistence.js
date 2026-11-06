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
      if (!data || !data.user) {
        throw new Error('Your session has expired. Please sign in again.');
      }
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
      if (opts.filters) {
        Object.entries(opts.filters).forEach(([key, value]) => {
          query = value === null ? query.is(key, null) : query.eq(key, value);
        });
      }
      if (opts.orderBy) query = query.order(opts.orderBy, { ascending: opts.ascending !== false });
      if (Number.isInteger(opts.limit) && opts.limit > 0) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async function insert(table, rows, returning) {
      validateTable(table);
      await requireAuthenticatedUser();
      if (!rows || (Array.isArray(rows) && rows.length === 0)) {
        throw new Error('Insert data is required.');
      }
      const { data, error } = await client.from(table).insert(rows).select(returning || '*');
      if (error) throw error;
      return data || [];
    }

    async function update(table, values, filters, returning) {
      validateTable(table);
      validateFilters(filters);
      await requireAuthenticatedUser();
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
          Object.keys(values).length === 0) {
        throw new Error('Update values are required.');
      }
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

    return Object.freeze({ select, insert, update, upsert, remove });
  }

  global.SupabasePersistence = Object.freeze({ create });
})(window);
