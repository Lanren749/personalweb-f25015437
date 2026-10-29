#!/usr/bin/env bash
set -euo pipefail
# Requires Java, curl, tar and Python 3. No system-wide installation.
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/f2505437-rat.XXXXXX")
OUT=${1:-"$BASE/reproduced"}
mkdir -p "$OUT" "$RUN_DIR/tools" "$RUN_DIR/source" "$RUN_DIR/own-site"
OUT=$(CDPATH= cd -- "$OUT" && pwd)
cd "$RUN_DIR"
{
  date -u '+UTC %Y-%m-%dT%H:%M:%SZ'
  curl -fL --retry 2 --connect-timeout 20 --max-time 180 'https://repo.maven.apache.org/maven2/org/apache/rat/apache-rat/0.16.1/apache-rat-0.16.1.jar' -o tools/apache-rat-0.16.1.jar
  curl -fL --retry 2 --connect-timeout 20 --max-time 180 'https://codeload.github.com/apache/commons-cli/tar.gz/698b238276c0e22e97e4aec703a0b00201d29666' -o commons-cli.tar.gz
} > "$OUT/installation.log" 2>&1
python3 - <<'PY' > "$OUT/checksums.txt"
from pathlib import Path
import hashlib
expected = {
 'tools/apache-rat-0.16.1.jar': '7021c0da25bf92539428427eefbfa1194673b7e4eea7688a17813cb075731431',
 'commons-cli.tar.gz': '986d613436628bb6ee49c5b6ebafab75cd1b06849860551fe2340c871d35e533',
}
for path, wanted in expected.items():
    actual = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if actual != wanted:
        raise SystemExit(f'Checksum mismatch for {path}: {actual}; stop and investigate.')
    print(path, actual)
PY
tar -xzf commons-cli.tar.gz -C source --strip-components=1
cp "$BASE/evidence/own-site-inputs/"* own-site/
{ date -u '+UTC %Y-%m-%dT%H:%M:%SZ'; uname -sm; java -version; } > "$OUT/environment.txt" 2>&1
java -jar tools/apache-rat-0.16.1.jar --help > "$OUT/rat-help.txt" 2>&1
java -jar tools/apache-rat-0.16.1.jar --xml --scan-hidden-directories --out "$OUT/rat-report.xml" source > "$OUT/scan-xml.log" 2>&1
java -jar tools/apache-rat-0.16.1.jar --scan-hidden-directories --out "$OUT/rat-report.txt" source > "$OUT/scan-text.log" 2>&1
java -jar tools/apache-rat-0.16.1.jar --xml --scan-hidden-directories --out "$OUT/own-site-rat.xml" own-site > "$OUT/own-site-scan.log" 2>&1
java -jar tools/apache-rat-0.16.1.jar --scan-hidden-directories --out "$OUT/own-site-rat.txt" own-site >> "$OUT/own-site-scan.log" 2>&1
python3 "$BASE/scripts/summarize_full_rat.py" "$OUT" source
printf 'Reports written to %s\nInput cache retained at %s\n' "$OUT" "$RUN_DIR"
