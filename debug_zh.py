#!/usr/bin/env python3
"""Debug zh.ts replacements."""
with open(r"d:\桌面\buckyball.ai\buckyball.ai\src\i18n\zh.ts", 'rb') as f:
    content = f.read()

# Check for CodePilot bytes
idx = content.find(b'CodePilot')
print(f"First CodePilot at: {idx}")
print(f"Bytes: {content[idx:idx+20]}")
print(f"Hex: {content[idx:idx+20].hex()}")

# Try regex
import re
m = re.search(rb"'CodePilot([^a-zA-Z])", content)
if m:
    print(f"Regex matched: {m.group()}")
else:
    print("Regex did NOT match!")

# Check if maybe there's a different encoding
# Search for the 'C' byte
c_idx = content.find(b'C')
print(f"\nFirst 'C' at: {c_idx}")
print(f"Around: {content[c_idx-5:c_idx+25]}")
