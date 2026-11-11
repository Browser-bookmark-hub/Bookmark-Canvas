import inlineFormatNames from './inline-format-names.js';

/** Replace formats only within the operated ranges and the next-input mark set. */
export default function clearCompetingInlineFormats(tr, keepType, ranges = tr.selection.ranges.map(range => ({
  from: range.$from.pos,
  to: range.$to.pos,
}))) {
  for (const name of inlineFormatNames) {
    const type = tr.doc.type.schema.marks[name];
    if (!type || type === keepType) continue;
    for (const { from, to } of ranges) {
      if (from < to) tr.removeMark(from, to, type);
    }
    tr.removeStoredMark(type);
  }
}
