# Encrypted keyring

Public keys in `infra/keys/public/` are safe to commit.

Private keys in `infra/keys/encrypted/` are encrypted with OpenSSL AES-256-CBC and PBKDF2. The password is not stored in git.

Required secret for CI:

```text
DIVBAND_KEYRING_PASSWORD
```

Configure the GitHub repository secret and deployment variables with the GitHub
CLI:

```sh
gh auth login -h github.com
scripts/configure-github-actions-secrets.sh
```

Or through Ansible:

```sh
ansible-playbook infra/ansible/playbooks/configure-github-actions.yml
```

The repository does not vendor a `gh` binary. Operators should install and
authenticate GitHub CLI on the machine that owns repository administration.

Local encrypt/decrypt:

```sh
export DIVBAND_KEYRING_PASSWORD='...'
scripts/encrypt-keyring-file.sh .secrets/github-actions-divband-vps infra/keys/encrypted/github-actions-divband-vps.key.enc
scripts/decrypt-keyring-file.sh infra/keys/encrypted/github-actions-divband-vps.key.enc .secrets/decrypted-github-actions-divband-vps
```
