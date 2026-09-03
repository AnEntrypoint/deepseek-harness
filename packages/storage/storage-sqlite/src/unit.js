/**
 * One opened sqlite unit. Every write primitive is a single durable
 * statement against the shared connection's `storage_units` table — unlike
 * the JSON backend, there is no in-memory authoritative copy: libsql's own
 * debounced whole-database snapshot (fired ~1.5s after the last write) is
 * the persistence boundary, so a read always issues a fresh query.
 * @module @freddie/freddie-storage-sqlite/src/unit
 */

import { StorageError } from '@freddie/freddie-storage'

/**
 * Open (or lazily create) one unit against the shared connection.
 * @param descriptor - static identity and shape of the unit.
 * @param client - shared libsql-plugkit-client connection.
 * @param onClose - backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
// eslint-disable-next-line require-await -- keeps open() async-shaped like the JSON backend's unit.open
export async function openSqliteUnit(descriptor, client, onClose) {
  return new SqliteKvUnit(descriptor, client, onClose)
}

class SqliteKvUnit {
  closed = false

  constructor(descriptor, client, onClose) {
    this.descriptor = descriptor
    this.client = client
    this.onClose = onClose
  }

  async loadAll() {
    this.assertOpen()
    const tables = {}
    for (const table of this.descriptor.tables) {
      const { rows } = await this.client.execute({
        sql: 'SELECT key, value FROM storage_units WHERE unit_name = ? AND table_name = ?',
        args: [this.descriptor.name, table],
      })
      tables[table] = Object.fromEntries(rows.map(([key, value]) => [key, JSON.parse(value)]))
    }
    let global = null
    if (this.descriptor.hasGlobal) {
      const { rows } = await this.client.execute({
        sql: 'SELECT value FROM storage_unit_globals WHERE unit_name = ?',
        args: [this.descriptor.name],
      })
      if (rows.length > 0) global = JSON.parse(rows[0][0])
    }
    return { tables, global }
  }

  async putRecord(table, key, value) {
    this.assertOpen()
    this.assertTable(table)
    await this.client.execute({
      sql: 'INSERT INTO storage_units (unit_name, table_name, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (unit_name, table_name, key) DO UPDATE SET value = excluded.value',
      args: [this.descriptor.name, table, key, JSON.stringify(value)],
    })
  }

  async deleteRecord(table, key) {
    this.assertOpen()
    this.assertTable(table)
    await this.client.execute({
      sql: 'DELETE FROM storage_units WHERE unit_name = ? AND table_name = ? AND key = ?',
      args: [this.descriptor.name, table, key],
    })
  }

  async setGlobal(value) {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.client.execute({
      sql: 'INSERT INTO storage_unit_globals (unit_name, value) VALUES (?, ?) ON CONFLICT (unit_name) DO UPDATE SET value = excluded.value',
      args: [this.descriptor.name, JSON.stringify(value)],
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }

  assertOpen() {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }

  assertTable(table) {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
  }
}
