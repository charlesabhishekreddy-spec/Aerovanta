const firstValue = (row, keys) => {
  for (const key of keys) {
    if (row && row[key] != null) return row[key];
  }
  return null;
};

export const getDatabaseHealth = async (env) => {
  if (!env?.DB) {
    return {
      configured: false,
      schemaReady: false,
      tableCount: 0,
      error: "D1 binding is missing.",
    };
  }

  try {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name IN ('app_meta', 'users', 'entity_records')"
    ).first();
    const tableCount = Number(firstValue(result, ["table_count", "COUNT(*)"]) || 0);
    return {
      configured: true,
      schemaReady: tableCount >= 3,
      tableCount,
      error: "",
    };
  } catch (error) {
    return {
      configured: true,
      schemaReady: false,
      tableCount: 0,
      error: String(error?.message || error || "Unknown D1 error"),
    };
  }
};
