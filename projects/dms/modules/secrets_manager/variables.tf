variable "environment" {
  type    = string
  default = "PROD"
}

variable "secrets" {
  description = "Map of secret_name => SSM parameter path"
  type        = map(string)
}
