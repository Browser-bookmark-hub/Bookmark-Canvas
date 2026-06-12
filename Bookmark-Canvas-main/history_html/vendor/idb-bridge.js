import { deleteDB, openDB } from './idb.js';

globalThis.BookmarkCanvasIdb = {
    deleteDB,
    openDB
};

globalThis.dispatchEvent(new CustomEvent('bookmark-canvas-idb-ready'));
