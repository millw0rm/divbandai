variable "hostname" { type = string }
variable "project_slug" { type = string }
variable "verification_token" {
  type      = string
  sensitive = true
}

# Provisioning owner: backend service plus external DNS operator.
#
# The MVP backend creates the TXT challenge and verifies it with real DNS TXT
# lookups in apps/backend/src/services/dns-verification.ts. Customers or a DNS
# provider integration publish the record. After verification, cert-manager or
# the configured DNS provider owns certificate issuance status checks.
#
# This module intentionally does not create customer-zone records, because the
# platform usually does not have write access to arbitrary customer DNS zones.
# A future DNS-provider-specific root stack can consume these variables to
# create _divband-challenge TXT records for managed zones only.

output "provisioning_owner" {
  value = "backend_and_dns_operator"
}

output "txt_record_name" {
  value = "_divband-challenge.${var.hostname}"
}

output "txt_record_value" {
  value     = "divband-verification=${var.verification_token}"
  sensitive = true
}

output "project_slug" {
  value = var.project_slug
}
