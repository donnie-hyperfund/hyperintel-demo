/**
 * Local preset overrides — modify this file to add/override presets for local dev.
 *
 * - Entries with a matching `id` REPLACE the built-in preset.
 * - Entries with a new `id` are APPENDED to the list.
 *
 * To stop git from tracking your local changes:
 *   git update-index --skip-worktree lib/presets.local.ts
 *
 * To undo (e.g. before committing shared changes):
 *   git update-index --no-skip-worktree lib/presets.local.ts
 */

import type { ModelPreset } from './presets';

export const LOCAL_PRESETS: ModelPreset[] = [];
