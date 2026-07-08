#!/usr/bin/env python3
"""Verify that a JS reorganization did not rewrite executable code.

For comment-only passes, drop blank lines and whole-line comments, then require
every remaining line to match in the same order. For chunk reorganization, pass
--allow-reorder to require the same non-comment code lines as a multiset.
Inline comments remain part of code lines and are still protected.
"""

from __future__ import annotations

import argparse
from collections import Counter
import difflib
from pathlib import Path


def normalize_code(source: str) -> list[str]:
    lines = []
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        lines.append(line.rstrip())
    return lines


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-reorder",
        action="store_true",
        help="Allow whole-line code reordering; compare non-comment code as a multiset.",
    )
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()

    before = normalize_code(args.before.read_text(encoding="utf-8"))
    after = normalize_code(args.after.read_text(encoding="utf-8"))

    if args.allow_reorder:
        before_counter = Counter(before)
        after_counter = Counter(after)
        if before_counter == after_counter:
            print("PASS: non-comment, non-blank code lines preserved as a multiset.")
            return 0

        print("FAIL: executable code line multiset changed.")
        removed = list((before_counter - after_counter).elements())
        added = list((after_counter - before_counter).elements())
        for label, lines in (("removed", removed), ("added", added)):
            print(f"--- {label} ---")
            for idx, line in enumerate(lines[:60]):
                print(line)
            if len(lines) > 60:
                print(f"... {len(lines) - 60} more ...")
        return 1

    if before == after:
        print("PASS: non-comment, non-blank code lines unchanged.")
        return 0

    print("FAIL: executable code changed or moved.")
    diff = difflib.unified_diff(
        before,
        after,
        fromfile=str(args.before),
        tofile=str(args.after),
        lineterm="",
        n=3,
    )
    for idx, line in enumerate(diff):
        if idx >= 120:
            print("... diff truncated ...")
            break
        print(line)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
