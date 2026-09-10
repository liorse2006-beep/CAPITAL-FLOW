'use strict';

// PostgreSQL adapter for the app's small, promise-based database contract.
// The application was originally written against SQLite/libSQL and calls
// db.prepare(sql).get/all/run throughout the server. Keeping this adapter at
// that boundary lets local development and the existing data source continue
// to work while Production can move to a free PostgreSQL provider without a
// risky repository-wide query rewrite.
const { Pool, types } = require('pg');

// node-postgres returns int8 values (including COUNT(*)) as strings by
// default. The schema uses INTEGER-sized counters/ids, so parse them as
// numbers to preserve the existing JavaScript contract. A future migration
// that stores values outside Number.MAX_SAFE_INTEGER must use a bigint-safe
// domain instead of silently relying on this parser.
types.setTypeParser(20, (value) => Number(value));

const IDENTITY_TABLES = new Set([
  'users',
  'otp_codes',
  'push_subscriptions',
  'feedback',
  'coupons',
  'scheduled_scans',
  'capital_flow_radars',
  'radar_events',
  'radar_schedule_runs',
  'admin_audit_log',
  'notifications',
  'chat_messages',
  'scan_reservations',
  'user_sessions',
  'status_checks',
  'status_incidents',
  'status_incident_updates',
  'status_notification_deliveries',
  'status_maintenance',
]);

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPostgresUrl(value) {
  return /^postgres(?:ql)?:/i.test(String(value || '').trim());
}

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\' && quote === "'") {
        escaped = true;
      } else if (character === quote) {
        if (quote === "'" && sql[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === ';') {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

// Replace SQLite's positional ? placeholders while ignoring question marks
// inside string/identifier literals. The codebase does not use PostgreSQL
// dollar-quoted bodies in application SQL, so the small scanner is enough for
// this boundary and avoids corrupting a literal such as 'what?'.
function replaceQuestionMarks(sql) {
  let output = '';
  let parameter = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\' && quote === "'") {
        escaped = true;
      } else if (character === quote) {
        if (quote === "'" && sql[index + 1] === "'") {
          output += sql[++index];
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      output += character;
    } else if (character === '?') {
      parameter += 1;
      output += '$' + parameter;
    } else {
      output += character;
    }
  }
  return output;
}

function replaceSqliteDateFunctions(sql) {
  let converted = sql;
  converted = converted.replace(
    /\bdatetime\(\s*'now'\s*\)/gi,
    "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"
  );
  converted = converted.replace(/\bunixepoch\(\s*\)/gi, 'EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::integer');
  converted = converted.replace(/\bdate\(\s*'now'\s*,\s*(\$\d+|'[^']*')\s*\)/gi, (_match, offset) => {
    if (String(offset).startsWith('$')) {
      return `to_char(CURRENT_DATE + (${offset})::interval, 'YYYY-MM-DD')`;
    }
    return `to_char(CURRENT_DATE + INTERVAL ${offset}, 'YYYY-MM-DD')`;
  });
  converted = converted.replace(
    /\bdate\(\s*([^,()]+?)\s*,\s*'unixepoch'\s*\)/gi,
    (_match, expression) => `to_char(to_timestamp(${String(expression).trim()}), 'YYYY-MM-DD')`
  );
  // SQLite's two-argument MAX() is a scalar clamp and is used for counters
  // and outage durations. PostgreSQL's MAX() is aggregate-only, so translate
  // the narrow zero-clamp form to its scalar equivalent while leaving normal
  // aggregate MAX(column) calls untouched.
  converted = converted.replace(/\bMAX\(\s*0\s*,\s*([^()]+)\)/gi, 'GREATEST(0, $1)');
  return converted;
}

function replaceInsertOrIgnore(sql) {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) return sql;
  let converted = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  if (/\bON\s+CONFLICT\b/i.test(converted)) return converted;
  const returningIndex = converted.search(/\bRETURNING\b/i);
  if (returningIndex === -1) return converted + ' ON CONFLICT DO NOTHING';
  return converted.slice(0, returningIndex) + 'ON CONFLICT DO NOTHING ' + converted.slice(returningIndex);
}

function tableNameFromInsert(sql) {
  const match = sql.match(/\bINSERT\s+INTO\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/i);
  return match ? match[1].toLowerCase() : null;
}

function addReturningId(sql) {
  if (/\bRETURNING\b/i.test(sql)) return sql;
  const table = tableNameFromInsert(sql);
  if (!table || !IDENTITY_TABLES.has(table)) return sql;
  return sql.trim().replace(/;$/, '') + ' RETURNING id';
}

function toPostgresSql(sql, { includeReturningId = false } = {}) {
  let converted = replaceQuestionMarks(String(sql));
  converted = replaceInsertOrIgnore(converted);
  converted = replaceSqliteDateFunctions(converted);
  // SQLite accepts this spelling; PostgreSQL uses an identity column. The
  // conversion is intentionally narrow so unrelated AUTOINCREMENT text is
  // never modified.
  converted = converted.replace(
    /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'
  );
  // The SQLite migration list is intentionally rerun on every boot and
  // catches duplicate-column errors. PostgreSQL can express that invariant
  // directly, avoiding a round trip that deliberately throws on every warm
  // restart of the hosted database.
  converted = converted.replace(
    /\bALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/i,
    'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS '
  );
  return includeReturningId ? addReturningId(converted) : converted;
}

function resultShape(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const changes = Number(result?.rowCount || 0);
  return {
    rows,
    rowsAffected: changes,
    changes,
    lastInsertRowid: rows[0]?.id == null ? undefined : Number(rows[0].id),
  };
}

function safeIdentifier(value) {
  const identifier = String(value || '');
  if (!SAFE_IDENTIFIER.test(identifier)) throw new Error('Unsafe PostgreSQL identifier');
  return '"' + identifier + '"';
}

function createPostgresDatabase(databaseUrl) {
  const allowInsecureSsl = String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'false';
  const sslDisabled = /(?:^|[?&])sslmode=disable(?:&|$)/i.test(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.max(1, Number.parseInt(process.env.DATABASE_POOL_MAX || '5', 10) || 5),
    connectionTimeoutMillis: Math.max(
      1000,
      Number.parseInt(process.env.DATABASE_CONNECT_TIMEOUT_MS || '10000', 10) || 10000
    ),
    idleTimeoutMillis: Math.max(1000, Number.parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || '30000', 10) || 30000),
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: !allowInsecureSsl } }),
  });

  async function query(target, sql, args = [], includeReturningId = false) {
    const translated = toPostgresSql(sql, { includeReturningId });
    const result = await target.query(translated, Array.isArray(args) ? args : []);
    return resultShape(result);
  }

  function prepare(sql, target = pool) {
    return {
      async get(...args) {
        const result = await query(target, sql, args, false);
        return result.rows.length ? result.rows[0] : undefined;
      },
      async all(...args) {
        const result = await query(target, sql, args, false);
        return result.rows;
      },
      async run(...args) {
        return query(target, sql, args, true);
      },
    };
  }

  async function exec(sql, target = pool) {
    const results = [];
    const statements = splitStatements(String(sql));
    for (const statement of statements) results.push(await query(target, statement));
    return results;
  }

  async function transaction(statementsOrCallback) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      let result;
      if (typeof statementsOrCallback === 'function') {
        result = await statementsOrCallback({
          prepare: (sql) => prepare(sql, connection),
          exec: (sql) => exec(sql, connection),
        });
      } else {
        if (!Array.isArray(statementsOrCallback) || statementsOrCallback.length === 0) {
          await connection.query('COMMIT');
          return [];
        }
        result = [];
        for (const statement of statementsOrCallback) {
          result.push(await query(connection, statement.sql, statement.args || [], true));
        }
      }
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await connection.query('ROLLBACK');
      } catch (_) {
        // Preserve the original database error; rollback failure is already
        // reflected in the connection being discarded below.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function tableInfo(table) {
    const quoted = safeIdentifier(table);
    const result = await pool.query(
      `SELECT column_name AS name
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1
        ORDER BY ordinal_position`,
      [String(table)]
    );
    // Touch the validated identifier so callers cannot accidentally pass a
    // value that is only safe in the parameterized lookup but unsafe when the
    // helper is later extended. The actual query above never interpolates it.
    void quoted;
    return result.rows;
  }

  async function resetSequences(tables) {
    for (const table of tables || []) {
      const name = String(table || '').toLowerCase();
      if (!IDENTITY_TABLES.has(name)) continue;
      const quoted = safeIdentifier(name);
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${quoted}`
      );
    }
  }

  return {
    dialect: 'postgres',
    prepare,
    exec,
    transaction,
    tableInfo,
    resetSequences,
    close: () => pool.end(),
    pool,
  };
}

module.exports = {
  IDENTITY_TABLES,
  createPostgresDatabase,
  isPostgresUrl,
  replaceQuestionMarks,
  replaceSqliteDateFunctions,
  replaceInsertOrIgnore,
  toPostgresSql,
};
