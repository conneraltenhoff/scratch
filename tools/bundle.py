"""Read and write the app template inside a Scratch bundle (index.html / admin.html).

The app lives as one JSON string on the line after <script type="__bundler/template">.
encode() reproduces the bundler's exact encoding: ASCII-only, uppercase \\uXXXX escapes,
and "</" written as "<\\u002F" so the template cannot close the surrounding <script>.

    from tools.bundle import load, save
    src, doc = load('index.html')
    src = src.replace(old, new)   # check old occurs exactly once first
    save('index.html', src, doc)
"""
import json
import re
import sys

TAG = '<script type="__bundler/template">'


def encode(s):
    out = json.dumps(s, ensure_ascii=True)
    # Uppercase the hex of every \uXXXX escape (an escaped backslash is \\, so only
    # match a backslash preceded by an even run of backslashes).
    out = re.sub(r'(?<!\\)((?:\\\\)*)\\u([0-9a-fA-F]{4})',
                 lambda m: m.group(1) + '\\u' + m.group(2).upper(), out)
    return out.replace('</', '<\\u002F')


def load(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    i = next(n for n, l in enumerate(lines) if l.strip() == TAG) + 1
    return json.loads(lines[i]), (lines, i)


def save(path, src, doc):
    lines, i = doc
    lines[i] = encode(src)
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))


if __name__ == '__main__':
    # Self-check: decoding and re-encoding must reproduce each file byte for byte.
    ok = True
    for p in sys.argv[1:] or ['index.html', 'admin.html']:
        src, (lines, i) = load(p)
        same = encode(src) == lines[i]
        ok &= same
        print(p, 'round-trips' if same else 'DOES NOT round-trip')
    sys.exit(0 if ok else 1)
