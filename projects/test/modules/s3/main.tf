resource "aws_s3_bucket" "my_bucket" {
  bucket        = Test
  force_destroy = true

  tags = {
    Name = "MyAppBucket"
  }
}
