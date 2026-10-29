#!/usr/bin/env python3
"""Aggregate genuine Rat XML and check source coverage; not a license scanner."""
import argparse
import collections
import csv
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output_dir', type=Path)
parser.add_argument('source_dir', nargs='?', type=Path)
args = parser.parse_args()
report = ET.parse(args.output_dir / 'rat-report.xml').getroot()
resources = report.findall('resource')
def name(resource, field):
    node = resource.find(field)
    return node.get('name') if node is not None else None
summary = {
    'timestamp': report.get('timestamp'),
    'resources': len(resources),
    'types': dict(collections.Counter(name(r, 'type') for r in resources)),
    'license_families': dict(collections.Counter(name(r, 'license-family') for r in resources if name(r, 'license-family'))),
    'unapproved_paths': [r.get('name') for r in resources if name(r, 'license-approval') == 'false'],
}
if args.source_dir:
    paths = sorted(p for p in args.source_dir.rglob('*') if p.is_file())
    reported = {r.get('name').removeprefix('source/') for r in resources}
    actual = {p.relative_to(args.source_dir).as_posix() for p in paths}
    summary['source_coverage'] = {
        'physical_files': len(actual), 'unscanned_files': sorted(actual-reported),
        'unexpected_resources': sorted(reported-actual), 'matches': reported == actual,
    }
    with (args.output_dir / 'source-file-manifest.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['path','bytes','sha256'])
        for p in paths:
            w.writerow([p.relative_to(args.source_dir).as_posix(),p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest()])
    if reported != actual:
        raise SystemExit('Source coverage mismatch: investigate before using this report.')
output = {'rat-report.xml': summary}
own = ET.parse(args.output_dir / 'own-site-rat.xml').getroot()
own_resources = own.findall('resource')
output['own-site-rat.xml'] = {'timestamp': own.get('timestamp'), 'resources': len(own_resources), 'types': dict(collections.Counter(name(r,'type') for r in own_resources)), 'license_families': dict(collections.Counter(name(r,'license-family') for r in own_resources if name(r,'license-family'))), 'unapproved_paths': [r.get('name') for r in own_resources if name(r,'license-approval') == 'false']}
(args.output_dir / 'scan-summary.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(output, ensure_ascii=False, indent=2))
