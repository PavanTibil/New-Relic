resource "aws_instance" "ec2_instances" {
  count         = var.instance_count
  ami           = var.ami_id
  instance_type = var.instance_type
  key_name      = var.key_name
  vpc_security_group_ids = [var.security_group_id]

  tags = {
    Name = "TerraformEC2-${count.index + 1}"
  }
}
