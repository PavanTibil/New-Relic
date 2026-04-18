resource "aws_s3_bucket" "my_bucket" {
  bucket        = test
  force_destroy = true

  tags = {
    Name = "MyAppBucket"
  }
}
