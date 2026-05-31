#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <plain-file> <encrypted-file>" >&2
  exit 2
fi

if [ -z "${DIVBAND_KEYRING_PASSWORD:-}" ]; then
  echo "DIVBAND_KEYRING_PASSWORD is required" >&2
  exit 2
fi

plain_file="$1"
encrypted_file="$2"
password_file="$(mktemp)"
trap 'rm -f "$password_file"' EXIT

install -d -m 755 "$(dirname "$encrypted_file")"
printf '%s' "$DIVBAND_KEYRING_PASSWORD" > "$password_file"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$plain_file" \
  -out "$encrypted_file" \
  -pass "file:$password_file"
