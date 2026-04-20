variable "ami_id" {
  description = "ami-05d2d839d4f73aafb"
  type        = string
}

variable "instance_type" {
  type        = string
  default     = "t2.micro"
}

variable "instance_name" {
  type        = string
  default     = "NR Auto Detected"
}
