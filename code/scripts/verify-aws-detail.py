"""Bounded read-only configuration/idle audit, reusing the existing approved account."""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(root / ".env")
from app import cloud, cost_guard  # noqa: E402

if not cost_guard.permitted():
    raise SystemExit(
        "Current approved account / active Free plan / reserve not verified; no AWS audit"
    )
resources = json.loads((root / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
outputs = resources["serverless_outputs"]
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "mutations": [],
    "guard": cost_guard.status(),
    "checks": {},
}
checks = report["checks"]
function = cloud.client("lambda").get_function_configuration(FunctionName=outputs["FunctionName"])
checks["lambda"] = {
    "runtime": function["Runtime"],
    "handler": function["Handler"],
    "memory_mb": function["MemorySize"],
    "timeout_seconds": function["Timeout"],
    "state": function["State"],
    "last_modified": function["LastModified"],
    "code_sha256": function["CodeSha256"],
}
rule = cloud.client("events").describe_rule(Name="cloudvault-v3-dev-uploads")
targets = cloud.client("events").list_targets_by_rule(Rule="cloudvault-v3-dev-uploads")["Targets"]
checks["eventbridge"] = {
    "state": rule["State"],
    "event_pattern": json.loads(rule["EventPattern"]),
    "targets": len(targets),
    "target_is_existing_queue": any(t["Arn"] == outputs["QueueArn"] for t in targets),
}
checks["eventbridge"]["event_pattern"]["detail"]["bucket"] = {"name": ["<existing-private-bucket>"]}
mapping = cloud.client("lambda").get_event_source_mapping(UUID=outputs["MappingId"])
checks["sqs_consumer"] = {
    "state": mapping["State"],
    "batch_size": mapping["BatchSize"],
    "partial_batch_failures": "ReportBatchItemFailures" in mapping.get("FunctionResponseTypes", []),
    "maximum_concurrency": mapping.get("ScalingConfig", {}).get("MaximumConcurrency"),
}
for name, key in [("sqs", "QueueUrl"), ("dlq", "DlqUrl")]:
    attrs = cloud.client("sqs").get_queue_attributes(QueueUrl=outputs[key], AttributeNames=["All"])[
        "Attributes"
    ]
    detail = {
        k: attrs.get(k)
        for k in [
            "VisibilityTimeout",
            "MessageRetentionPeriod",
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
        ]
    }
    if attrs.get("RedrivePolicy"):
        detail["maximum_receive_count"] = json.loads(attrs["RedrivePolicy"])["maxReceiveCount"]
    if attrs.get("Policy"):
        detail["policy_statement_count"] = len(json.loads(attrs["Policy"])["Statement"])
    checks[name] = detail
machine = cloud.client("stepfunctions").describe_state_machine(
    stateMachineArn=outputs["WorkflowArn"]
)
definition = json.loads(machine["definition"])
checks["stepfunctions"] = {
    "status": machine["status"],
    "type": machine["type"],
    "states": list(definition["States"]),
    "retry_task_count": sum(bool(s.get("Retry")) for s in definition["States"].values()),
    "catch_task_count": sum(bool(s.get("Catch")) for s in definition["States"].values()),
}
for status in ["RUNNING", "SUCCEEDED", "FAILED"]:
    executions = cloud.client("stepfunctions").list_executions(
        stateMachineArn=outputs["WorkflowArn"], statusFilter=status, maxResults=5
    )
    checks["stepfunctions"][status.lower() + "_first_page"] = len(executions["executions"])
    checks["stepfunctions"][status.lower() + "_truncated"] = bool(executions.get("nextToken"))
routes = cloud.client("apigatewayv2").get_routes(ApiId=outputs["ApiId"])["Items"]
checks["api_gateway"] = {
    "routes": [
        {"route": r["RouteKey"], "authorization": r.get("AuthorizationType")} for r in routes
    ]
}
stages = cloud.client("apigatewayv2").get_stages(ApiId=outputs["ApiId"])["Items"]
checks["api_gateway"]["throttles"] = [s.get("DefaultRouteSettings", {}) for s in stages]
stack = cloud.client("cloudformation").list_stack_resources(StackName="cloudvault-v3-dev")[
    "StackResourceSummaries"
]
names = [r["PhysicalResourceId"] for r in stack if r["ResourceType"] == "AWS::SSM::Parameter"]
parameters = cloud.client("ssm").get_parameters(Names=names, WithDecryption=False)
cfg = cloud.configuration()
expected = {
    "table": cfg["table"],
    "vector-index": cfg["vector_index"],
    "workflow": outputs["WorkflowArn"].split(":")[-1],
}
checks["parameter_store"] = {
    "standard_parameters_read": len(parameters["Parameters"]),
    "missing": len(parameters.get("InvalidParameters", [])),
    "values_match_active_configuration": all(
        p["Value"] == expected[p["Name"].split("/")[-1]] for p in parameters["Parameters"]
    ),
}
checks["cloudformation"] = {
    "resource_count": len(stack),
    "resource_types": sorted(set(r["ResourceType"] for r in stack)),
}
checks["iam"] = {"roles": []}
for row in stack:
    if row["ResourceType"] == "AWS::IAM::Role":
        role = row["PhysicalResourceId"]
        trust = cloud.client("iam").get_role(RoleName=role)["Role"]["AssumeRolePolicyDocument"]
        policies = cloud.client("iam").list_role_policies(RoleName=role)["PolicyNames"]
        statements = []
        for policy in policies[:4]:
            doc = cloud.client("iam").get_role_policy(RoleName=role, PolicyName=policy)[
                "PolicyDocument"
            ]
            statements.extend(doc["Statement"])
        checks["iam"]["roles"].append(
            {
                "trusted_services": [
                    s.get("Principal", {}).get("Service") for s in trust["Statement"]
                ],
                "inline_policy_count": len(policies),
                "allow_all_actions": any(
                    s.get("Action") == "*"
                    or "*" in (s.get("Action", []) if isinstance(s.get("Action"), list) else [])
                    for s in statements
                ),
                "resource_scoped_statement_count": sum(
                    s.get("Resource") != "*" for s in statements
                ),
            }
        )
end = datetime.now(timezone.utc)
checks["cloudwatch_metrics"] = {}
for metric, statistic in [("Errors", "Sum"), ("Duration", "Average")]:
    points = cloud.client("cloudwatch").get_metric_statistics(
        Namespace="AWS/Lambda",
        MetricName=metric,
        Dimensions=[{"Name": "FunctionName", "Value": outputs["FunctionName"]}],
        StartTime=end - timedelta(hours=3),
        EndTime=end,
        Period=10800,
        Statistics=[statistic],
    )["Datapoints"]
    checks["cloudwatch_metrics"][metric] = {
        "datapoints": points,
        "window_hours": 3,
        "missing_is_not_zero": True,
    }
report["idle_restored"] = (
    checks["eventbridge"]["state"] == "DISABLED"
    and checks["sqs_consumer"]["state"] == "Disabled"
    and checks["stepfunctions"]["running_first_page"] == 0
)
(root.parent / "docs/AWS_DETAILED_READ_AUDIT.json").write_text(json.dumps(report, indent=2, default=str))
print(
    json.dumps(
        {
            "idle_restored": report["idle_restored"],
            "checks": list(checks),
            "guard": report["guard"],
        },
        default=str,
    )
)
