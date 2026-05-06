variable "name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "project_name" {
  type    = string
  default = "DMS"
}

variable "environment" {
  type    = string
  default = "PROD"
}
