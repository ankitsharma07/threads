"""Prepares a self-hosted release: builds the XPI, records it in updates.json, and writes release notes.

Thunderbird checks the manifest's update_url (updates.json on the main branch) and installs newer
versions from their GitHub release download links, verifying each file against its SHA-256 hash.
Upload the exact XPI this script builds; rebuilding produces a different hash.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = 'ankitsharma07/threads'
root = Path(__file__).parent


def fail(message):
    sys.exit(f'release: {message}')


manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
gecko = manifest['browser_specific_settings']['gecko']
# Thunderbird accepts only email-like IDs or GUIDs, and the ID can never change after release.
if not re.fullmatch(r'[\w.+-]+@[\w.-]+|\{[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\}', gecko['id']):
    fail(f'add-on ID {gecko["id"]!r} must look like name@domain or a {{GUID}}')
# ATN requires Experiment add-ons to cap the Thunderbird version they were tested against.
if 'strict_max_version' not in gecko:
    fail('manifest.json needs strict_max_version (required for Experiment add-ons)')
if json.loads((root / 'package.json').read_text())['version'] != version:
    fail('package.json and manifest.json versions differ')

changelog = (root / 'CHANGELOG.md').read_text()
section = re.search(rf'^## {re.escape(version)}\b.*?\n(.*?)(?=^## |\Z)', changelog, re.S | re.M)
if not section:
    fail(f'CHANGELOG.md has no "## {version}" section')

if subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True, text=True).stdout.strip():
    print('release: warning: the working tree has uncommitted changes', file=sys.stderr)

subprocess.run([sys.executable, str(root / 'build.py')], check=True)
subprocess.run([sys.executable, str(root / 'build.py'), '--atn'], check=True)
xpi = root / 'dist' / f'threads-{version}.xpi'
digest = hashlib.sha256(xpi.read_bytes()).hexdigest()

updates_path = root / 'updates.json'
data = json.loads(updates_path.read_text()) if updates_path.exists() else {'addons': {}}
updates = data['addons'].setdefault(gecko['id'], {'updates': []})['updates']
updates[:] = [entry for entry in updates if entry['version'] != version]
updates.append({
    'version': version,
    'update_link': f'https://github.com/{REPO}/releases/download/v{version}/{xpi.name}',
    'update_hash': f'sha256:{digest}',
    'update_info_url': f'https://github.com/{REPO}/releases/tag/v{version}',
    'applications': {'gecko': {key: gecko[key] for key in ('strict_min_version', 'strict_max_version') if key in gecko}},
})
updates_path.write_text(json.dumps(data, indent=2) + '\n')

notes = root / 'dist' / f'release-notes-{version}.md'
notes.write_text(section.group(1).strip() + f'\n\n**Install:** download `{xpi.name}`, then in Thunderbird open Add-ons and Themes → gear menu → Install Add-on From File.\n\nSHA-256: `{digest}`\n')

print(f'''
Built {xpi.relative_to(root)}  sha256:{digest}  (GitHub release)
Built dist/threads-{version}-atn.xpi  (upload to addons.thunderbird.net)
Updated updates.json; wrote {notes.relative_to(root)}

Next (the download must exist before updates.json on main points to it):
  1. git add -A && git commit -m "Release {version}" && git tag v{version}
  2. git push origin v{version}
  3. Create the GitHub release v{version}, attaching {xpi.relative_to(root)} with {notes.relative_to(root)} as the notes.
     With gh signed in to the personal account:
       gh release create v{version} {xpi.relative_to(root)} --repo {REPO} --title "Threads {version}" --notes-file {notes.relative_to(root)}
  4. git push origin main   (publishes updates.json; installed copies update from here)
''')
