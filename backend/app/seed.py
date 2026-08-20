import json

from sqlalchemy.orm import Session

from app.models import ChecklistTemplate, User
from app.auth import hash_password
from app.config import get_settings

TEMPLATES = [
    {
        "key": "phase1-kickoff",
        "name": "Phase 1 — Initiation & Discovery Planning",
        "phase": "phase1",
        "items": [
            "Kickoff with client sponsor; confirm scope boundaries",
            "Confirm escort logistics and badging requirements",
            "List restricted (government / EMSS) equipment",
            "Confirm in-scope racks and areas for general-purpose section",
            "Define photography and data-handling rules for controlled areas",
            "Prepare RBI workbook shell (customer, project, revision control)",
            "Prepare onsite data-capture checklist",
            "Assess automated discovery accelerator: port access",
            "Assess CDP/LLDP availability",
            "Assess SaaS trial provisioning feasibility",
        ],
    },
    {
        "key": "phase2-onsite",
        "name": "Phase 2 — Onsite Physical Capture",
        "phase": "phase2",
        "items": [
            "Escorted rack-by-rack capture of device names",
            "Capture vendor, model, RU positions",
            "Capture serial numbers where accessible",
            "Map PDU bank/port to device name for each in-scope rack",
            "Document fan orientation / hot-cold aisle errors",
            "Capture cabling and rack-breakout details where safe to trace",
            "Complete fields for government/EMSS equipment with client engineers",
            "Daily hand-off of captured data to remote engineer",
        ],
    },
    {
        "key": "phase3-docs",
        "name": "Phase 3 — Documentation, Correlation & Lifecycle",
        "phase": "phase3",
        "items": [
            "Populate RBI rack elevations",
            "Populate rack breakout documentation",
            "Populate PDU connectivity",
            "Complete device-to-function correlation",
            "Research and record vendor EOL/EOS milestones",
            "Flag already-EOL and near-EOL devices",
            "Reconcile discovery-tool output against physical capture",
            "Surface undocumented devices",
            "Produce updated Visio-style rack layouts",
            "Produce remediation / budget-planning summary",
        ],
    },
    {
        "key": "phase4-delivery",
        "name": "Phase 4 — Automation Roadmap & Delivery",
        "phase": "phase4",
        "items": [
            "Develop automation-lab recommendations package",
            "Conduct findings review with the client",
            "Incorporate one round of consolidated feedback",
            "Deliver final RBI workbook",
            "Deliver rack layouts",
            "Deliver lifecycle / remediation summary and roadmap",
            "Obtain formal acceptance",
        ],
    },
    {
        "key": "onsite-capture",
        "name": "Onsite data-capture (per rack)",
        "phase": "phase2",
        "items": [
            "Photograph rack front (if photography allowed)",
            "Photograph rack rear (if photography allowed)",
            "Record rack name / row / position",
            "Record every device name, vendor, model",
            "Record RU start/end",
            "Record serials / asset tags",
            "Map PDU A ports",
            "Map PDU B ports",
            "Note fan orientation vs aisle",
            "Trace visible copper/fiber breakout",
            "Flag restricted / no-touch devices",
        ],
    },
    {
        "key": "pm-walkthrough",
        "name": "Routine DC walkthrough",
        "phase": "ops",
        "items": [
            "Visual inspect hot/cold aisle containment",
            "Check for alarm lights on PDUs / UPS / CRAC",
            "Listen for abnormal fan or pump noise",
            "Verify no blocked perforated tiles or rear exhaust",
            "Check for unsecured / unlabeled cabling",
            "Confirm cage / room doors secure",
            "Note empty RU and spare power capacity",
            "Log findings and open incidents as needed",
        ],
    },
    {
        "key": "physical-security",
        "name": "Physical access & data protection",
        "phase": "ops",
        "items": [
            "Badge access list current",
            "Visitor / escort log complete",
            "Cameras and door contacts normal (if in scope)",
            "Controlled-area photography rules posted",
            "Media leaving the floor follows data-handling rules",
            "Unused network ports disabled or documented",
        ],
    },
]


def seed_templates(db: Session) -> None:
    existing = {t.key for t in db.query(ChecklistTemplate).all()}
    for tmpl in TEMPLATES:
        if tmpl["key"] in existing:
            continue
        db.add(
            ChecklistTemplate(
                key=tmpl["key"],
                name=tmpl["name"],
                phase=tmpl["phase"],
                items_json=json.dumps(tmpl["items"]),
            )
        )
    db.commit()


def bootstrap_admin(db: Session) -> None:
    if db.query(User).count() > 0:
        return
    settings = get_settings()
    db.add(
        User(
            username=settings.bootstrap_admin_user,
            email=settings.bootstrap_admin_email,
            full_name="Bootstrap Admin",
            hashed_password=hash_password(settings.bootstrap_admin_password),
            role="admin",
            is_active=True,
        )
    )
    db.commit()
