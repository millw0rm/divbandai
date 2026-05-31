#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <encrypted-file> <output-file>" >&2
  exit 2
fi

if [ -z "${DIVBAND_KEYRING_PASSWORD:-}" ]; then
  echo "DIVBAND_KEYRING_PASSWORD is required" >&2
  exit 2
fi

encrypted_file="$1"
output_file="$2"
password_file="$(mktemp)"
trap 'rm -f "$password_file"' EXIT

printf '%s' "$DIVBAND_KEYRING_PASSWORD" > "$password_file"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$encrypted_file" \
  -out "$output_file" \
  -pass "file:$password_file"
chmod 600 "$output_file"
