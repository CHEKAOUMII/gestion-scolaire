# -*- coding: utf-8 -*-
"""Fix all corrupted Arabic strings in timetable.html JavaScript section."""

import re

with open(r'd:\project 06\timetable.html', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    # Theme toggle messages
    ("newTheme === 'dark' ? '\u061f\u061f \u0625\u0644\u063a\u0627\u0621 \u0625\u0644\u063a\u0627\u0621 \u0625\u0644\u063a\u0627\u0621\u061f' : '\u061f\u061f \u0625\u0644\u063a\u0627\u0621 \u0625\u0644\u063a\u0627\u0621 \u0625\u0644\u063a\u0627\u0621\u061f'",
     "newTheme === 'dark' ? '\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u062f\u0627\u0643\u0646' : '\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0641\u0627\u062a\u062d'"),
]

# Instead of risky string replacements with corrupted chars,
# let's target specific line ranges and rewrite them

lines = content.split('\n')

print(f"Total lines: {len(lines)}")

# Find and fix specific patterns by searching each line
for i, line in enumerate(lines):
    original = line

    # === Period type detection: replace ? with ص/م ===
    if "periodRaw.includes('?')" in line and "'morning'" in line:
        lines[i] = line.replace("periodRaw.includes('?')", "periodRaw.includes('\u0635')")

    if "periodRaw.includes('\u061f')" in line and "'morning'" in line:
        lines[i] = line.replace("periodRaw.includes('\u061f')", "periodRaw.includes('\u0635')")

    # Fix regex for period cleaning (ص|م)
    if ".replace(/\\s*(\u061f|\u061f)\\s*$/g, '')" in line:
        lines[i] = line.replace(".replace(/\\s*(\u061f|\u061f)\\s*$/g, '')", ".replace(/\\s*[\u0635\u0645]\\s*$/g, '')")

    if ".replace(/\\s*(?|?)\\s*$/g, '')" in line:
        lines[i] = line.replace(".replace(/\\s*(?|?)\\s*$/g, '')", ".replace(/\\s*[\u0635\u0645]\\s*$/g, '')")

    if lines[i] != original:
        print(f"  Line {i+1}: Fixed period type detection")

# Now let's do a fresh read and targeted replacements by finding the exact lines
content = '\n'.join(lines)

# Build a mapping of all corrupted -> correct strings
# We'll search for unique context around each corrupted string

fixes = {
    # toggleTheme showToast - find the line with toggleTheme context
    r"showToast\(newTheme === 'dark' \? '.*?' : '.*?', 'info'\)":
        "showToast(newTheme === 'dark' ? '\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u062f\u0627\u0643\u0646' : '\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0641\u0627\u062a\u062d', 'info')",
}

# Apply regex-based fixes
for pattern, replacement in fixes.items():
    content, count = re.subn(pattern, replacement, content)
    if count:
        print(f"  Applied regex fix: {count} replacements")

# Write back
with open(r'd:\project 06\timetable.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done! File saved.")
