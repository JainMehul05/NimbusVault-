"""Define synthetic relevance labels before tuning; no access to user documents."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / "benchmarks"
folder.mkdir(exist_ok=True)
docs = {
    "processing": (
        "local-processing.txt",
        "Original documents are stored privately in Amazon S3. MiniLM embeddings and Qwen answer generation run on the local laptop. Local semantic retrieval does not need an AWS vector query.",
    ),
    "borealis": (
        "borealis-access.txt",
        "Project Borealis uses violet balloons. Its synthetic access number is 914. The Borealis review is scheduled for 18 March 2027.",
    ),
    "north": (
        "north-retention.txt",
        "Policy North retains audit logs for 30 days. North requires two reviewers before publishing a release. The North retention policy was approved on 5 January 2026.",
    ),
    "south": (
        "south-retention.txt",
        "Policy South retains audit logs for 90 days. South requires three reviewers before publishing a release. The South retention policy was approved on 9 February 2026.",
    ),
    "water": (
        "water-conservation.txt",
        "Rainwater harvesting collects rain from rooftops in storage tanks. Drip irrigation delivers water directly to plant roots and reduces evaporation. Repairing leaking taps prevents household water waste.",
    ),
    "solar": (
        "aurora-energy.txt",
        "Project Aurora uses photovoltaic panels to turn sunlight into electricity. Its annual renewable energy target is 73 megawatt hours. Battery storage supplies power after sunset.",
    ),
    "expense": (
        "travel-expenses.txt",
        "Employees must submit travel expense claims within 14 days of returning. Each claim must include itemized receipts. The reimbursement limit is 450 credits per journey.",
    ),
    "backup": (
        "backup-procedure.txt",
        "A full database backup runs every Sunday at 02:00 UTC. Incremental backups run nightly. Recovery snapshots are retained for 21 days. The recovery time objective is four hours.",
    ),
    "security": (
        "session-security.txt",
        "Refresh tokens rotate after use. Reusing an old refresh token revokes its token family. Logout immediately revokes the active session. Passwords are stored as salted hashes.",
    ),
    "queue": (
        "queue-recovery.txt",
        "The ingestion queue visibility timeout is 180 seconds. Failed messages move to the dead-letter queue after three receives. Operators inspect failed messages before any approved replay. Never purge unknown messages.",
    ),
    "api": (
        "api-reference.txt",
        "The status endpoint is GET /status and requires AWS_IAM authentication with SigV4 signing. Unsigned status requests return HTTP 403. The client error code NV-409 indicates a revision conflict.",
    ),
    "release": (
        "release-checklist.txt",
        "Release Cedar version 2.4.1 has a deadline of 12 April 2027. The release owner is Mira Patel. The final checklist requires passing tests, a verified backup and approval by two reviewers.",
    ),
    "library": (
        "library-rules.txt",
        "Library books may be borrowed for 28 days. Students may renew each book once if nobody has reserved it. Lost books must be reported to the circulation desk.",
    ),
    "network": (
        "network-guide.txt",
        "DNS translates domain names into IP addresses. TLS encrypts data in transit. An HTTP 429 response means the client exceeded the request rate limit.",
    ),
    "food": (
        "cafe-menu.txt",
        "The campus cafe serves lentil soup on Tuesdays and vegetable pasta on Fridays. Breakfast is available from 08:00 until 10:30. A reusable cup earns a 10 percent discount.",
    ),
    "long": (
        "observatory-handbook.txt",
        (
            "Routine observatory equipment inspections record instrument alignment and maintenance notes. "
            * 175
        )
        + "\nFinal emergency procedure: evacuate to the western assembly point and contact coordinator Laila Chen on extension 682.",
    ),
    "hidden": (
        "private-cedar-budget.txt",
        "The confidential Cedar budget is 81270 credits. This document belongs to an unrelated account and must not enter authorized retrieval.",
    ),
}
# Expected documents and supporting phrases are fixed here before measurements.
cases = [
    ("recovered", "MiniLM Qwen local laptop", ["processing"], "technical_abbreviation", "tuning"),
    (
        "s02",
        "Where are document embeddings and language model answers computed?",
        ["processing"],
        "paraphrase",
        "tuning",
    ),
    ("s03", "How can a garden use less water?", ["water"], "synonym", "tuning"),
    ("s04", "What converts sunlight into usable power?", ["solar"], "synonym", "tuning"),
    (
        "s05",
        "What happens when an old refresh credential is reused?",
        ["security"],
        "paraphrase",
        "tuning",
    ),
    (
        "s06",
        "How long do expense claims remain eligible after a trip?",
        ["expense"],
        "paraphrase",
        "tuning",
    ),
    (
        "s07",
        "What is the maximum time to recover the database?",
        ["backup"],
        "paraphrase",
        "tuning",
    ),
    ("s08", "How are failed ingestion events isolated?", ["queue"], "paraphrase", "tuning"),
    ("s09", "MiniLM embeddings", ["processing"], "exact", "held_out"),
    ("s10", "What is the Borealis synthetic access number?", ["borealis"], "numeric", "held_out"),
    ("s11", "When is the Borealis review?", ["borealis"], "date", "held_out"),
    (
        "s12",
        "What is the log retention period for Policy North?",
        ["north"],
        "similar_document",
        "held_out",
    ),
    (
        "s13",
        "What is the log retention period for Policy South?",
        ["south"],
        "similar_document",
        "held_out",
    ),
    (
        "s14",
        "Compare North and South audit log retention.",
        ["north", "south"],
        "conflicting",
        "held_out",
    ),
    ("s15", "How many reviewers does South require?", ["south"], "numeric", "held_out"),
    ("s16", "Which review policy was approved in January?", ["north"], "date", "held_out"),
    ("s17", "How does rooftop precipitation get collected?", ["water"], "paraphrase", "held_out"),
    ("s18", "What watering method avoids evaporation?", ["water"], "synonym", "held_out"),
    ("s19", "How do households avoid losing water from taps?", ["water"], "paraphrase", "held_out"),
    (
        "s20",
        "How much renewable electricity should Aurora produce each year?",
        ["solar"],
        "numeric",
        "held_out",
    ),
    ("s21", "How can Aurora provide electricity at night?", ["solar"], "paraphrase", "held_out"),
    (
        "s22",
        "What paperwork is needed for travel reimbursement?",
        ["expense"],
        "synonym",
        "held_out",
    ),
    ("s23", "What is the journey reimbursement cap?", ["expense"], "numeric", "held_out"),
    (
        "s24",
        "When does the weekly complete database snapshot run?",
        ["backup"],
        "paraphrase",
        "held_out",
    ),
    (
        "s25",
        "How long are recovery snapshots retained?",
        ["backup"],
        "similar_document",
        "held_out",
    ),
    ("s26", "What does signing out do to a session?", ["security"], "synonym", "held_out"),
    ("s27", "How are stored passwords protected?", ["security"], "paraphrase", "held_out"),
    (
        "s28",
        "How many receives before a failed queue message is isolated?",
        ["queue"],
        "numeric",
        "held_out",
    ),
    (
        "s29",
        "What is the ingestion message visibility timeout?",
        ["queue"],
        "technical",
        "held_out",
    ),
    ("s30", "How is the cloud status endpoint authenticated?", ["api"], "technical", "held_out"),
    ("s31", "NV-409", ["api"], "identifier", "held_out"),
    ("s32", "What does HTTP 429 mean?", ["network"], "identifier", "held_out"),
    ("s33", "Who owns the Cedar release?", ["release"], "name", "held_out"),
    ("s34", "When is version 2.4.1 due?", ["release"], "identifier", "held_out"),
    (
        "s35",
        "What must happen before Cedar can be released?",
        ["release"],
        "paraphrase",
        "held_out",
    ),
    ("s36", "Can a student renew a borrowed book?", ["library"], "paraphrase", "held_out"),
    ("s37", "What should I do if I lose a library book?", ["library"], "paraphrase", "held_out"),
    (
        "s38",
        "What translates website names into network addresses?",
        ["network"],
        "synonym",
        "held_out",
    ),
    (
        "s39",
        "How is information encrypted while travelling over the network?",
        ["network"],
        "synonym",
        "held_out",
    ),
    ("s40", "What vegetarian lunch is served on Friday?", ["food"], "paraphrase", "held_out"),
    ("s41", "When does breakfast finish?", ["food"], "time", "held_out"),
    (
        "s42",
        "Who should observatory staff call during evacuation?",
        ["long"],
        "long_document_end",
        "held_out",
    ),
    (
        "s43",
        "Where should observatory staff assemble in an emergency?",
        ["long"],
        "long_document_end",
        "held_out",
    ),
    (
        "s44",
        "Explain local AI processing and the Borealis access number.",
        ["processing", "borealis"],
        "multi_document",
        "held_out",
    ),
    ("s45", "What is the Antarctic rocket launch date?", [], "unrelated", "held_out"),
    ("s46", "What is the cure for dragon fever?", [], "unrelated", "held_out"),
    ("s47", "What is the confidential Cedar budget?", [], "unauthorized", "held_out"),
    ("s48", "What is the Borealis access number?", ["borealis"], "selected_document", "held_out"),
    (
        "s49",
        "Compare North and South reviewer requirements.",
        ["north", "south"],
        "folder_scope",
        "held_out",
    ),
    (
        "s50",
        "How many moons does the fictional planet Zorblax have?",
        [],
        "no_evidence",
        "held_out",
    ),
]
scope = {"s48": ["borealis"], "s49": ["north", "south"]}
payload = {
    "description": "Synthetic local-only fixtures; labels defined before tuning. Folder scope represented by server-resolved authorized file ID subset.",
    "documents": {
        k: {"filename": name, "text": text, "authorized": k != "hidden"}
        for k, (name, text) in docs.items()
    },
    "search": [
        {
            "id": i,
            "query": q,
            "expected": e,
            "category": c,
            "split": s,
            **({"scope": scope[i]} if i in scope else {}),
        }
        for i, q, e, c, s in cases
    ],
}
(folder / "corpus.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
print("Defined 17 synthetic documents and 50 relevance judgments before tuning.")
