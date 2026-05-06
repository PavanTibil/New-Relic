variable "origins" {
  type        = map(string)
  description = "Map of origin_name = domain_name"
}

variable "default_origin" {
  type        = string
  description = "Name of the default origin"
}
