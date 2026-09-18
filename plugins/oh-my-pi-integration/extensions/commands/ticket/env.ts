/**
 * `/ticket` environment detection: pure fs/config checks for the session cwd,
 * shared by the handler, usage text, and tab completions.
 */

import { resolveGiwtConfig } from "../../util/giwt-config";
import { discoverPlanningIds } from "../bookkeep";

export interface TicketEnv {
  /** Session cwd (repo root guess). */
  root: string;
  /** giwt available (giwt.toml or .tmp/giwt present). */
  giwtAvailable: boolean;
  /** Absolute path to the tickets directory. */
  ticketsDir: string;
  /** Existing planning-item IDs discovered under `.plan/`. */
  existingIds: string[];
}

/** Pure detection of the ticket environment for a session cwd. */
export function detectTicketEnv(cwd: string | undefined): TicketEnv {
  const root = cwd ?? process.cwd();
  const giwt = resolveGiwtConfig(root);
  return {
    root,
    giwtAvailable: giwt.available,
    ticketsDir: giwt.ticketsDir,
    existingIds: discoverPlanningIds(root),
  };
}
