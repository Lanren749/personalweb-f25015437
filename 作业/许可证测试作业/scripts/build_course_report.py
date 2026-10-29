#!/usr/bin/env python3
"""Compatibility entrypoint for the renamed license assignment report."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('build_report.py')), run_name='__main__')
