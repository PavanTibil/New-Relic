module "vpcmodule" {
 source = "../../modules/vpc_network"
}

module "rdsmodule" {
 source = "../../modules/rds_db"
 vpc_id = module.vpcmodule.vpc_id
 private_subnet_1_id = module.vpcmodule.private_subnet_1_id
 private_subnet_2_id = module.vpcmodule.private_subnet_2_id
}

#module "ecr" {
  #source          = "../../modules/ecr"
  #repository_name = "prod-dms-ecr"
  #project_name    = "DMS"
  #environment     = "PROD"
#}
module "iotcoremodule" {
 source = "../../modules/iot_core"
}
module "s3module" {
 source = "../../modules/s3_bucket"
}
module "wafmodule" {
 source = "../../modules/waf"
}

module "vpc_connector" {
  source = "../../modules/vpc_connector"

  name                = "DMS-PROD-VPC-CONNECTOR"
  subnet_ids          = [module.vpcmodule.private_subnet_1_id, module.vpcmodule.private_subnet_2_id]
  security_group_ids  = [module.vpcmodule.prod_bastionhost_sg]
  project_name        = "DMS"
  environment         = "PROD"
}

module "keycloak_app_runner" {
  source            = "../../modules/keycloak_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "user_ms_app_runner" {
  source = "../../modules/user_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "intel_ms_app_runner" {
  source = "../../modules/intel_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "registry_ms_app_runner" {
  source = "../../modules/registry_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "drouter_ms_app_runner" {
  source = "../../modules/drouter_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "dlistener_ms_app_runner" {
  source = "../../modules/dlistener_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "dtransformer_ms_app_runner" {
  source = "../../modules/dtransformer_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "workflowagent_ms_app_runner" {
  source = "../../modules/workflowagent_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "workflowevents_ms_app_runner" {
  source = "../../modules/workflowevents_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "workflowhandler_ms_app_runner" {
  source = "../../modules/workflowhandler_ms_app_runner"
  vpc_connector_arn = module.vpc_connector.vpc_connector_arn
}
module "cloudfront" {
  source         = "../../modules/cloudfront"
  default_origin = "keycloak"

   origins = {
    "intel-ms"            = replace(module.intel_ms_app_runner.intel_ms_service_url, "https://", "")
    "keycloak"            = replace(module.keycloak_app_runner.keycloak_service_url, "https://", "")
    "user-ms"             = replace(module.user_ms_app_runner.user_ms_service_url, "https://", "")
    "registry-ms"         = replace(module.registry_ms_app_runner.registry_ms_service_url, "https://", "")
    "workflow-agent-ms"   = replace(module.workflowagent_ms_app_runner.workflowagent_ms_service_url, "https://", "")
    "dlistener-ms"        = replace(module.dlistener_ms_app_runner.dlistener_ms_service_url, "https://", "")
    "workflow-events-ms"  = replace(module.workflowevents_ms_app_runner.workflowevents_ms_service_url, "https://", "")
    "drouter-ms"          = replace(module.drouter_ms_app_runner.drouter_ms_service_url, "https://", "")
    "workflow-handler-ms" = replace(module.workflowhandler_ms_app_runner.workflowhandler_ms_service_url, "https://", "")
    "dtransformer-ms"     = replace(module.dtransformer_ms_app_runner.dtransformer_ms_service_url, "https://", "")
  }
}
module "rds_monitoring" {
  source         = "../../modules/rds_monitoring"
  rds_identifier = module.rdsmodule.rds_identifier_name
  alert_email    = "mallikarjuna.hs@tibilsolutions.com"
}
module "user_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.user_ms_app_runner.user_ms_service_name
  apprunner_service_name = module.user_ms_app_runner.user_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "drouter_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.drouter_ms_app_runner.drouter_ms_service_name
  apprunner_service_name = module.drouter_ms_app_runner.drouter_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "dtransformer_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.dtransformer_ms_app_runner.dtransformer_ms_service_name
  apprunner_service_name = module.dtransformer_ms_app_runner.dtransformer_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "dlistener_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.dlistener_ms_app_runner.dlistener_ms_service_name
  apprunner_service_name = module.dlistener_ms_app_runner.dlistener_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "registry_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.registry_ms_app_runner.registry_ms_service_name
  apprunner_service_name = module.registry_ms_app_runner.registry_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "intel_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.intel_ms_app_runner.intel_ms_service_name
  apprunner_service_name = module.intel_ms_app_runner.intel_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "workflowevents_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.workflowevents_ms_app_runner.workflowevents_ms_service_name
  apprunner_service_name = module.workflowevents_ms_app_runner.workflowevents_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "workflowagent_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.workflowagent_ms_app_runner.workflowagent_ms_service_name
  apprunner_service_name = module.workflowagent_ms_app_runner.workflowagent_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}
module "workflowhandler_ms_monitoring" {
  source = "../../modules/apprunner_monitoring"

  app_name               = module.workflowhandler_ms_app_runner.workflowhandler_ms_service_name
  apprunner_service_name = module.workflowhandler_ms_app_runner.workflowhandler_ms_service_name
  alert_email            = "mallikarjuna.hs@tibilsolutions.com"
}

module "cloudwatch_dashboard" {
  source = "../../modules/cloudwatch_dashboard"

  dashboard_name = "DMS-PROD-CloudWatch"
  region         = "ap-south-1"

  app_runner_service_names = [
    module.keycloak_app_runner.keycloak_service_name,
    module.intel_ms_app_runner.intel_ms_service_name,
    module.drouter_ms_app_runner.drouter_ms_service_name,
    module.dlistener_ms_app_runner.dlistener_ms_service_name,
    module.registry_ms_app_runner.registry_ms_service_name,
    module.workflowagent_ms_app_runner.workflowagent_ms_service_name,
    module.workflowevents_ms_app_runner.workflowevents_ms_service_name,
    module.dtransformer_ms_app_runner.dtransformer_ms_service_name
  ]

  rds_identifier = module.rdsmodule.cloudwatch_rds_identifier
}

#module "apprunner_secrets" {
  #source      = "../../modules/secrets_manager"
  #environment = "PROD"

  #secrets = {
    #"prod-apprunner-common-secret"  = "/prod/apprunner/common-secret"
    #"prod-apprunner-dlistner-config" = "/prod/apprunner/dlistner-config"
    #"prod-apprunner-drouterms"      = "/prod/apprunner/drouterms"
    #"prod-apprunner-dsconfigms"     = "/prod/apprunner/dsconfigms"
    #"prod-apprunner-intelms"        = "/prod/apprunner/intelms"
    #"prod-apprunner-registryms"     = "/prod/apprunner/registryms"
    #"prod-apprunner-userms"         = "/prod/apprunner/userms"
    #"prod-apprunner-workflowms"     = "/prod/apprunner/workflowms"
  #}
#}
