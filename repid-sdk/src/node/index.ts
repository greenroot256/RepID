// Node-only entry point: the state stores that need a filesystem.
//
// Kept apart from the main entry point so that importing `@repid/sdk` in a
// browser does not pull `node:fs` into the bundle. A user who never persists
// state should not have to pay for the capability they do not use.

export { createJsonFileStore, type JsonFileStore } from './json-file-store.js';
export { createMemoryStore } from '../state/memory-store.js';
export type { RepidStateStore, RepidStateSnapshot } from '../types.js';
