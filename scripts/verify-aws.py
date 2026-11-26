"""Bounded read-only audit. Never provisions, uploads, enables consumers or deletes.

Run with the final project's Python interpreter. Interactive sign-in belongs to the owner.
"""

from pathlib import Path
import sys
import json
from datetime import datetime, timezone, timedelta
import boto3
from botocore.config import Config

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
from app.config import settings  # noqa: E402

report = {
    "checked_at": datetime.now(timezone.utc).isoformat(),
    "profile": settings.aws_profile,
    "region": settings.aws_region,
    "mutations": [],
    "services": {},
}
runtime = root / ".runtime"
runtime.mkdir(exist_ok=True)
session = boto3.Session(
    profile_name=settings.aws_profile, region_name=settings.aws_region
)
sdk = Config(connect_timeout=3, read_timeout=6, retries={"max_attempts": 0})


def client(name):
    return session.client(name, config=sdk)


def check(name, fn):
    try:
        report["services"][name] = {
            "status": "verified_read_only",
            "observed_at": datetime.now(timezone.utc).isoformat(),
            **fn(),
        }
    except Exception as error:
        report["services"][name] = {"status": "blocked", "error": type(error).__name__}


try:
    identity = client("sts").get_caller_identity()
    report["identity"] = {
        "account_suffix": identity["Account"][-4:],
        "type": identity["Arn"].split(":")[5].split("/")[0],
    }
    plan = client("freetier").get_account_plan_state()
    eligible = (
        plan["accountPlanType"] == "FREE"
        and plan["accountPlanStatus"] == "ACTIVE"
        and plan.get("accountPlanRemainingCredits", {}).get("amount", 0) > 1
    )
    report["guard"] = {
        "allowed": eligible,
        "plan": plan.get("accountPlanType"),
        "status": plan.get("accountPlanStatus"),
        "credits_usd": plan.get("accountPlanRemainingCredits", {}).get("amount"),
        "expires_at": str(plan.get("accountPlanExpirationDate", "")),
    }
    if not eligible:
        raise RuntimeError("FreePlanGuardRejected")
    resources = json.loads(
        (runtime / "cloud-resources.json").read_text(encoding="utf-8-sig")
    )
    outputs = resources["serverless_outputs"]
    assert identity["Account"] == outputs["WorkflowArn"].split(":")[4], (
        "Unexpected AWS account"
    )

    def s3():
        flags = client("s3").get_public_access_block(Bucket=settings.s3_bucket)[
            "PublicAccessBlockConfiguration"
        ]
        encryption = client("s3").get_bucket_encryption(Bucket=settings.s3_bucket)
        return {
            "public_access_blocked": all(flags.values()),
            "encryption_configured": bool(
                encryption.get("ServerSideEncryptionConfiguration")
            ),
        }

    check("S3", s3)
    check(
        "DynamoDB",
        lambda: {
            "table_status": client("dynamodb").describe_table(
                TableName=resources["table"]
            )["Table"]["TableStatus"]
        },
    )

    def function():
        cfg = client("lambda").get_function_configuration(
            FunctionName=outputs["FunctionName"]
        )
        mapping = client("lambda").get_event_source_mapping(UUID=outputs["MappingId"])
        return {
            "state": cfg.get("State"),
            "memory_mb": cfg["MemorySize"],
            "timeout_seconds": cfg["Timeout"],
            "consumer_state": mapping["State"],
            "batch_size": mapping["BatchSize"],
            "maximum_concurrency": mapping.get("ScalingConfig", {}).get(
                "MaximumConcurrency"
            ),
        }

    check("Lambda", function)
    check(
        "EventBridge",
        lambda: {
            "state": client("events").describe_rule(Name="cloudvault-v3-dev-uploads")[
                "State"
            ]
        },
    )
    for label, key in [("SQS", "QueueUrl"), ("SQS DLQ", "DlqUrl")]:
        check(
            label,
            lambda key=key: {
                "attributes": client("sqs").get_queue_attributes(
                    QueueUrl=outputs[key],
                    AttributeNames=[
                        "ApproximateNumberOfMessages",
                        "ApproximateNumberOfMessagesNotVisible",
                        "VisibilityTimeout",
                    ],
                )["Attributes"]
            },
        )
    check(
        "Step Functions",
        lambda: {
            "status": client("stepfunctions").describe_state_machine(
                stateMachineArn=outputs["WorkflowArn"]
            )["status"]
        },
    )
    check(
        "CloudFormation",
        lambda: {
            "status": client("cloudformation").describe_stacks(
                StackName="cloudvault-v3-dev"
            )["Stacks"][0]["StackStatus"]
        },
    )
    check(
        "S3 Vectors",
        lambda: {
            "dimension": client("s3vectors").get_index(
                vectorBucketName=resources["vector_bucket"],
                indexName=resources["vector_index"],
            )["index"]["dimension"]
        },
    )

    def monitoring():
        end = datetime.now(timezone.utc)
        points = client("cloudwatch").get_metric_statistics(
            Namespace="AWS/Lambda",
            MetricName="Invocations",
            Dimensions=[{"Name": "FunctionName", "Value": outputs["FunctionName"]}],
            StartTime=end - timedelta(hours=1),
            EndTime=end,
            Period=3600,
            Statistics=["Sum"],
        )["Datapoints"]
        logs = client("logs").describe_log_groups(
            logGroupNamePrefix="/aws/lambda/" + outputs["FunctionName"], limit=1
        )["logGroups"]
        return {
            "invocation_datapoints": points,
            "log_retention_days": logs[0].get("retentionInDays") if logs else None,
        }

    check("CloudWatch", monitoring)
    check(
        "API Gateway",
        lambda: {
            "routes_use_iam": all(
                r.get("AuthorizationType") == "AWS_IAM"
                for r in client("apigatewayv2").get_routes(ApiId=outputs["ApiId"])[
                    "Items"
                ]
            )
        },
    )

    # Discover only the existing stack's parameter resources, never unrelated private parameters.
    def parameters():
        rows = client("cloudformation").list_stack_resources(
            StackName="cloudvault-v3-dev"
        )["StackResourceSummaries"]
        names = [
            r["PhysicalResourceId"]
            for r in rows
            if r["ResourceType"] == "AWS::SSM::Parameter"
        ]
        result = (
            client("ssm").get_parameters(Names=names, WithDecryption=False)
            if names
            else {"Parameters": []}
        )
        return {"standard_parameters_read": len(result["Parameters"])}

    check("Parameter Store", parameters)
except Exception as error:
    report["blocked"] = {
        "type": type(error).__name__,
        "next_action": "aws login --profile default, completed by the owner; then rerun scripts/verify-aws.ps1",
    }
(runtime / "aws-audit.json").write_text(
    json.dumps(report, indent=2, default=str), encoding="utf-8"
)
(root / "docs/AWS_CURRENT_STATUS.json").write_text(
    json.dumps(report, indent=2, default=str), encoding="utf-8"
)
print(
    json.dumps(
        {
            "services_checked": len(report["services"]),
            "blocked": report.get("blocked"),
            "guard": report.get("guard"),
            "mutations": [],
        },
        default=str,
    )
)
