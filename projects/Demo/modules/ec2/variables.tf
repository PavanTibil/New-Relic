variable "instance_type" {
  default = "t2.micro"
}

variable "ami_id" {
  default = "ami-020cba7c55df1f615"
}

variable "key_name" {
  default = "Demo"
}

variable "security_group_id" {
  default = "sg-09fb399e759c7ce8a"
}

variable "instance_count" {
  default = 1
}
