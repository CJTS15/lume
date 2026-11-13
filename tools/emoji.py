#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build src/data/emoji.json from Unicode data: emoji and names from
# emoji-test.txt, keywords from CLDR's English annotations. Fully-qualified
# emoji only, no skin-tone variants, and nothing newer than MAX_VERSION so
# common emoji fonts can draw every entry. Run: python3 tools/emoji.py

import json
import re
import urllib.request
from pathlib import Path

EMOJI_TEST = 'https://unicode.org/Public/emoji/latest/emoji-test.txt'
ANNOTATIONS = ('https://raw.githubusercontent.com/unicode-org/cldr-json/main/'
               'cldr-json/cldr-annotations-full/annotations/en/annotations.json')
LICENSE = 'https://www.unicode.org/license.txt'
MAX_VERSION = 17.0
SKIN_TONES = range(0x1F3FB, 0x1F400)

DATA = Path(__file__).resolve().parent.parent / 'src' / 'data'


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode('utf-8')


def main():
    annotations = json.loads(fetch(ANNOTATIONS))['annotations']['annotations']
    entries = []
    line_re = re.compile(r'^([0-9A-F ]+?)\s*; fully-qualified\s*# (\S+) E(\d+\.\d+) (.+)$')
    group = ''
    for line in fetch(EMOJI_TEST).splitlines():
        if line.startswith('# group:'):
            group = line.split(':', 1)[1].strip()
            continue
        match = line_re.match(line)
        if not match or group == 'Component' or float(match.group(3)) > MAX_VERSION:
            continue
        codepoints = [int(c, 16) for c in match.group(1).split()]
        if any(c in SKIN_TONES for c in codepoints):
            continue
        emoji, name = match.group(2), match.group(4).strip()
        keywords = annotations.get(emoji, annotations.get(emoji.replace('️', ''), {})).get('default', [])
        words = set(name.lower().split())
        extra = [k for k in keywords if k.lower() not in words and k.lower() != name.lower()]
        entries.append([emoji, name, ' '.join(extra)])

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'emoji.json').write_text(json.dumps(entries, ensure_ascii=False, separators=(',', ':')) + '\n',
                                     encoding='utf-8')
    (DATA / 'UNICODE-LICENSE.txt').write_text(
        'src/data/emoji.json is derived from Unicode emoji-test.txt and CLDR\n'
        'annotations, under the following licence.\n\n' + fetch(LICENSE), encoding='utf-8')
    print(f'{len(entries)} emoji written to {DATA / "emoji.json"}')


if __name__ == '__main__':
    main()
