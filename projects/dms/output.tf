########################################
# VPC Output
########################################
output "vpc_id" {
  value = module.vpcmodule.vpc_id
}
output "public_subnet_1_id" {
  value = module.vpcmodule.public_subnet_1_id
}

output "public_subnet_2_id" {
  value = module.vpcmodule.public_subnet_2_id
}

output "private_subnet_1_id" {
  value = module.vpcmodule.private_subnet_1_id
}

output "private_subnet_2_id" {
  value = module.vpcmodule.private_subnet_2_id
}
output "internet_gateway_id" {
  value = module.vpcmodule.internet_gateway_id
}

output "nat_gateway_id" {
  value = module.vpcmodule.nat_gateway_id
}

output "public_route_table_id" {
  value = module.vpcmodule.public_route_table_id
}

output "private_route_table_1_id" {
  value = module.vpcmodule.private_route_table_1_id
}

output "private_route_table_2_id" {
  value = module.vpcmodule.private_route_table_2_id
}

########################################
# RDS Output
########################################
output "rds_endpoint" {
  value = module.rdsmodule.rds_endpoint
}

output "rds_port" {
  value = module.rdsmodule.rds_port
}
output "rds_identifier_name" {
  value = module.rdsmodule.rds_identifier_name
}


########################################
# App Runner Service (SMOKE TEST MAIN APP)
########################################
output "app_runner_services" {
  description = "All AppRunner services — name, URL, arn"
  value = {
    drouter = {
      name = module.drouter_ms_app_runner.drouter_ms_service_name
      url  = module.drouter_ms_app_runner.drouter_ms_service_url
      arn  = module.drouter_ms_app_runner.drouter_ms_service_arn
    }
    user_ms = {
      name = module.user_ms_app_runner.user_ms_service_name
      url  = module.user_ms_app_runner.user_ms_service_url
      arn  = module.user_ms_app_runner.user_ms_service_arn
    }
    registry_ms = {
      name = module.registry_ms_app_runner.registry_ms_service_name
      url  = module.registry_ms_app_runner.registry_ms_service_url
      arn  = module.registry_ms_app_runner.registry_ms_service_arn
    }
    workflowagent_ms = {
      name = module.workflowagent_ms_app_runner.workflowagent_ms_service_name
      url  = module.workflowagent_ms_app_runner.workflowagent_ms_service_url
      arn  = module.workflowagent_ms_app_runner.workflowagent_ms_service_arn
    }
    dlistener_ms = {
      name = module.dlistener_ms_app_runner.dlistener_ms_service_name
      url  = module.dlistener_ms_app_runner.dlistener_ms_service_url
      arn  = module.dlistener_ms_app_runner.dlistener_ms_service_arn
    }
    workflowevents_ms = {
      name = module.workflowevents_ms_app_runner.workflowevents_ms_service_name
      url  = module.workflowevents_ms_app_runner.workflowevents_ms_service_url
      arn  = module.workflowevents_ms_app_runner.workflowevents_ms_service_arn
    }
    dtransformer_ms = {
      name = module.dtransformer_ms_app_runner.dtransformer_ms_service_name
      url  = module.dtransformer_ms_app_runner.dtransformer_ms_service_url
      arn  = module.dtransformer_ms_app_runner.dtransformer_ms_service_arn
    }
    workflowhandler_ms = {
      name = module.workflowhandler_ms_app_runner.workflowhandler_ms_service_name
      url  = module.workflowhandler_ms_app_runner.workflowhandler_ms_service_url
      arn  = module.workflowhandler_ms_app_runner.workflowhandler_ms_service_arn
    }
    intel_ms = {
      name = module.intel_ms_app_runner.intel_ms_service_name
      url  = module.intel_ms_app_runner.intel_ms_service_url
      arn  = module.intel_ms_app_runner.intel_ms_service_arn
    }
    keycloak = {
      name = module.keycloak_app_runner.keycloak_service_name
      url  = module.keycloak_app_runner.keycloak_service_url
      arn  = module.keycloak_app_runner.keycloak_service_arn
    }
  }
}

########################################
# CloudFront - for API Gateway / UI Smoke Test
########################################
output "cloudfront_distribution_id" {
  value = module.cloudfront.cloudfront_distribution_id
}

output "cloudfront_domain" {
  value = module.cloudfront.cloudfront_domain
}
output "vpc_connector_details" {
  value = {
    name = module.vpc_connector.vpc_connector_name
    arn  = module.vpc_connector.vpc_connector_arn
  }
}
########################################
output "s3_details" {
  description = "S3 bucket for certs"
  value = {
    bucket_name = module.s3module.s3_bucket_name
    bucket_arn  = module.s3module.s3_bucket_arn
  }
}
output "iot_core_details" {
  value = {
    thing_group_name = module.iotcoremodule.iot_thing_group_name
    thing_group_arn  = module.iotcoremodule.iot_thing_group_arn
    policy_name      = module.iotcoremodule.iot_policy_name
    policy_arn       = module.iotcoremodule.iot_policy_arn
  }
}

output "waf_details" {
  value = {
    acl_name    = module.wafmodule.waf_acl_name
    acl_arn     = module.wafmodule.waf_acl_arn
    ip_set_name = module.wafmodule.waf_ip_set_name
    ip_set_arn  = module.wafmodule.waf_ip_set_arn
  }
}
########################################
# App Runner Monitoring Outputs
########################################

output "apprunner_monitoring" {
  description = "App Runner monitoring details"
  value = {
    user_ms = {
      service_name  = module.user_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.user_ms_monitoring.sns_topic_arn
      alert_email   = module.user_ms_monitoring.alert_email
    }

    drouter_ms = {
      service_name  = module.drouter_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.drouter_ms_monitoring.sns_topic_arn
      alert_email   = module.drouter_ms_monitoring.alert_email
    }

    dtransformer_ms = {
      service_name  = module.dtransformer_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.dtransformer_ms_monitoring.sns_topic_arn
      alert_email   = module.dtransformer_ms_monitoring.alert_email
    }

    dlistener_ms = {
      service_name  = module.dlistener_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.dlistener_ms_monitoring.sns_topic_arn
      alert_email   = module.dlistener_ms_monitoring.alert_email
    }

    registry_ms = {
      service_name  = module.registry_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.registry_ms_monitoring.sns_topic_arn
      alert_email   = module.registry_ms_monitoring.alert_email
    }

    intel_ms = {
      service_name  = module.intel_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.intel_ms_monitoring.sns_topic_arn
      alert_email   = module.intel_ms_monitoring.alert_email
    }

    workflowevents_ms = {
      service_name  = module.workflowevents_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.workflowevents_ms_monitoring.sns_topic_arn
      alert_email   = module.workflowevents_ms_monitoring.alert_email
    }

    workflowagent_ms = {
      service_name  = module.workflowagent_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.workflowagent_ms_monitoring.sns_topic_arn
      alert_email   = module.workflowagent_ms_monitoring.alert_email
    }
    workflowhandler_ms = {
      service_name  = module.workflowhandler_ms_monitoring.apprunner_service_name
      sns_topic_arn = module.workflowhandler_ms_monitoring.sns_topic_arn
      alert_email   = module.workflowhandler_ms_monitoring.alert_email
    }
  }
}

########################################
# RDS Monitoring Outputs
########################################

output "rds_monitoring" {
  description = "RDS monitoring details"
  value = {
    rds_identifier = module.rds_monitoring.rds_identifier
    sns_topic_arn  = module.rds_monitoring.sns_topic_arn
    alert_email    = module.rds_monitoring.alert_email
  }
}
output "cloudwatch_dashboard_name" {
  value = module.cloudwatch_dashboard.dashboard_name
}
