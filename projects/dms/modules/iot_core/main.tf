# Create IoT Thing Group
resource "aws_iot_thing_group" "iot_group" {
  name        = var.thing_group_name
}

# IoT Policy using your exact JSON
resource "aws_iot_policy" "iot_policy" {
  name   = var.policy_name
  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
EOF
}
