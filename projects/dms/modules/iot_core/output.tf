output "iot_thing_group_name" {
  value = aws_iot_thing_group.iot_group.name
}

output "iot_thing_group_arn" {
  value = aws_iot_thing_group.iot_group.arn
}

output "iot_policy_name" {
  value = aws_iot_policy.iot_policy.name
}

output "iot_policy_arn" {
  value = aws_iot_policy.iot_policy.arn
}
