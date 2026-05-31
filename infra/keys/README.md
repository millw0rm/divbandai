# Encrypted keyring

Public keys in `infra/keys/public/` are safe to commit.

Private keys in `infra/keys/encrypted/` are encrypted with OpenSSL AES-256-CBC and PBKDF2. The password is not stored in git.

Required secret for CI:

```text
DIVBAND_KEYRING_PASSWORD
```

Local encrypt/decrypt:

```sh
export DIVBAND_KEYRING_PASSWORD='...'
scripts/encrypt-keyring-file.sh .secrets/github-actions-divband-vps infra/keys/encrypted/github-actions-divband-vps.key.enc
scripts/decrypt-keyring-file.sh infra/keys/encrypted/github-actions-divband-vps.key.enc .secrets/decrypted-github-actions-divband-vps
```
