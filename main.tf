provider "aws" {
  region = "ap-south-1"
}

resource "aws_instance" "my_ec2" {
  ami           = "ami-05d2d839d4f73aafb"
  instance_type = "t2.micro"

  tags = {
    Name = "New-Relic-Auto-Provisioned"
  }
}
