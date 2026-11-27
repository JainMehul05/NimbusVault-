# Private configuration schemas

These examples contain placeholders only. They grant no approval and are not operational manifests. Never flip `approved` or invent resource IDs just to bypass a guard.

The Windows setup creates `.env`, `backend/.env` and `intelligence/.env` privately. Configure your own AWS account/profile/bucket there; the intelligence service also uses the root settings. Optional cloud metadata configuration belongs in ignored `.runtime/cloud-config.json`, `.runtime/cloud-resources.json` and `.runtime/vector-demo.json`. Their examples preserve the expected field structure and keep optional features disabled.

The EC2 bundle builder expects the reviewed cloud JSON files in ignored `.runtime/aws-deployment/local/configuration/`; the host configuration generator copies them to `/opt/nimbusvault-private/configuration`. Models/images are obtained and packaged separately through the documented setup/bundle workflow. Do not copy personal databases or credentials into a deployment bundle.

`approved-instance.example.json` illustrates the existing-instance operation schema. An actual approved deployment must establish resource ownership, scoped IAM, host safeguards and private authorization through the deployment procedure before its real manifest is used. The account/instance values and active authorization are deliberately not distributed. Existing-instance start never creates a missing instance.

See [the public deployment guide](../../docs/PUBLIC_DEPLOYMENT_GUIDE.md), [deployment architecture](../../docs/AWS_DEPLOYMENT_ARCHITECTURE.md), and [the deployment guide](../../docs/AWS_DEPLOYMENT_GUIDE.md). Earlier manual Session A steps are historical; Session B operation uses the bounded-session controller. Provisioning/public routing/native workflow activation are separate explicitly authorized actions.
