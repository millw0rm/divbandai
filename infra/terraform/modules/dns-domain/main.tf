variable "hostname" { type = string }
variable "project_slug" { type = string }
variable "verification_token" { type = string }

# Placeholder for DNS provider records. Custom domains should not become active
# until TXT verification succeeds and routing/TLS are ready.
