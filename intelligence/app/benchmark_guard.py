"""Fail closed on any AWS SDK operation during isolated local benchmarks."""
from botocore.client import BaseClient


def install():
    evidence = {"attempted_sdk_calls": 0, "live_sdk_calls": 0, "operations": []}

    def blocked(self, operation_name, api_params):
        evidence["attempted_sdk_calls"] += 1
        evidence["operations"].append(self.meta.service_model.service_name + "." + operation_name)
        raise RuntimeError("AWS SDK calls are forbidden in isolated local benchmarks")

    BaseClient._make_api_call = blocked
    return evidence
