#!/usr/bin/env python3
"""Trim bytes after the last ar member of a .deb (apt rejects them: "Invalid archive member header")."""
import sys
for path in sys.argv[1:]:
    d = open(path, 'rb').read()
    if d[:8] != b'!<arch>\n': sys.exit(f'{path}: not an ar archive')
    i = 8; end = 8
    while i + 60 <= len(d) and d[i+58:i+60] == b'`\n':
        n = int(d[i+48:i+58]); end = i + 60 + n; i = end + (n % 2)
    if end < len(d):
        open(path, 'r+b').truncate(end); print(f'{path}: trimmed {len(d)-end} trailing bytes')
    else: print(f'{path}: ok')
