/**
 * Pure-type outlet of the session-projection Service Definition: the one projection type
 * table, importable from client aggregates without dragging the host-side
 * cordis Context merges of the package root (dsh-agent → dsh-session). Domain
 * packages may declare-merge through either the package root or this outlet —
 * re-export preserves symbol identity, so both land on the same table.
 *
 * This module has zero runtime content: `SessionProjectionMap` and
 * `SessionProjectionStateMap` were compile-time-only merge-extensible
 * interfaces with no runtime representation. The type-only value is
 * intentionally dropped in the buildless conversion.
 *
 * @module @deepseek-ai/dsh-session-projection/types
 */

export {}
