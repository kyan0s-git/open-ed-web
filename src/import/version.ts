/**
 * Bump when an importer change should reach courses already imported: they are re-read
 * from their stored archive in the background (see library/upgrade.ts), keeping their
 * ids, so progress stays attached.
 *
 *  1: page repairs (import/tidy.ts), readable material titles (import/titles.ts).
 */
export const PARSER_VERSION = 1;
