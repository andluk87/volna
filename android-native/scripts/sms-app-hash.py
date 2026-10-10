#!/usr/bin/env python3
"""Verify the actual APK signature and compute Google's SMS Retriever app hash."""
import argparse
import base64
import hashlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--apksigner', required=True)
parser.add_argument('--package', default='dev.volna.messenger')
parser.add_argument('apk')
args = parser.parse_args()
result = subprocess.run([args.apksigner, 'verify', '--print-certs-pem', args.apk], capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Cannot verify the APK signature; SMS hash was not published.')
certs = re.findall(r'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', result.stdout, re.S)
if not certs:
    raise SystemExit('APK signing certificate was not returned by apksigner.')
certificate = base64.b64decode(''.join(certs[0].split()), validate=True)
value = f'{args.package} {certificate.hex()}'.encode('utf-8')
print(base64.b64encode(hashlib.sha256(value).digest()[:9]).decode('ascii')[:11])
