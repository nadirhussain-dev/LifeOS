import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Downloads everything the server holds about this account, block or no block.
 *
 * This is the client half of migration 0022. The ordinary export in
 * `lib/data-export.ts` reads the *local* database, which is the right source
 * almost always — it is faster, it works offline, and it is complete. It is
 * exactly wrong in one case: a blocked account, whose device has been wiped
 * (0019) and whose reads are refused by RLS. That account has no local copy and
 * no way to fetch one, while still being entitled to its data.
 *
 * So this goes to the server through `export_own_data`, which is SECURITY
 * DEFINER and therefore sees past the block. It takes no user id — see the
 * migration's header for why that is the whole of its safety argument.
 */

/** A table that fails is reported rather than aborting the export. Somebody
 *  entitled to their data should get the 39 tables that worked, plus an honest
 *  list of what did not, rather than nothing at all. */
export type SelfExportResult = {
  ok: boolean;
  /** Tables that returned rows or an empty set. */
  exported: string[];
  /** Tables that errored, with the reason. */
  failed: { table: string; error: string }[];
  totalRows: number;
};

/** Rows per table. The RPC caps at 10,000 itself; asking for the cap keeps this
 *  to one request per table for any realistic account. */
const PAGE = 10000;

export async function exportOwnServerData(): Promise<SelfExportResult> {
  const result: SelfExportResult = { ok: false, exported: [], failed: [], totalRows: 0 };

  const { data: tables, error: tableError } = await supabase.rpc('self_exportable_tables');
  if (tableError || !Array.isArray(tables)) {
    result.failed.push({ table: '*', error: tableError?.message ?? 'Could not list your data.' });
    return result;
  }

  const payload: Record<string, unknown[]> = {};

  for (const table of tables as string[]) {
    const { data, error } = await supabase.rpc('export_own_data', {
      p_table: table,
      p_limit: PAGE,
    });
    if (error) {
      result.failed.push({ table, error: error.message });
      continue;
    }
    // The RPC returns one `row_data` jsonb per row; unwrap so the file reads as
    // an ordinary array of records rather than a list of single-key wrappers.
    const rows = (data as { row_data: unknown }[] | null) ?? [];
    payload[table] = rows.map((r) => r.row_data);
    result.exported.push(table);
    result.totalRows += rows.length;
  }

  if (result.exported.length === 0) return result;

  try {
    const file = new File(Paths.cache, `lifeos-account-data-${Date.now()}.json`);
    file.create({ overwrite: true });
    file.write(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          note: 'Everything LifeOS holds on its servers for this account, including items marked deleted.',
          // Named in the file, because a person reading this months later has no
          // other way to know it is not the whole picture.
          notIncluded:
            'Private space entries are stored encrypted with a key the server never had, so they cannot be included here.',
          tables: payload,
        },
        null,
        2,
      ),
    );

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Your LifeOS data',
      });
    }
    result.ok = true;
  } catch (error) {
    reportError(error, { scope: 'self-data-export' });
    result.failed.push({ table: '*', error: 'Could not save the file.' });
  }

  return result;
}
