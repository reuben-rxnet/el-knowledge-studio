/* EL Knowledge Studio prototype — fictional demo data. No real people or systems. */
const DAY = 86400000;
const NOW = Date.now();
const ago = (d) => new Date(NOW - d * DAY);
const ahead = (d) => new Date(NOW + d * DAY);

const ROLE_PERMS = {
  consumer: ["project.view"],
  creator: ["project.view", "project.create", "project.edit", "recording.create", "guide.edit", "review.comment"],
  reviewer: ["project.view", "review.comment", "review.approve"],
  approver: ["project.view", "review.comment", "review.approve", "analytics.view"],
  translator: ["project.view", "translation.edit", "review.comment"],
  publisher: ["project.view", "publish.execute", "review.comment", "analytics.view"],
  wsadmin: ["project.view", "project.create", "project.edit", "recording.create", "guide.edit", "review.comment", "review.approve", "publish.execute", "analytics.view", "template.manage", "workspace.manage", "audit.view"],
  entadmin: ["*"],
};

const PERSONAS = [
  { id: "u1", name: "Amara Mensah", ini: "AM", role: "creator", label: "Creator", title: "Retail Excellence Lead, Milan" },
  { id: "u2", name: "Pierre Laurent", ini: "PL", role: "reviewer", label: "Reviewer (SME)", title: "Store Operations Manager, Paris" },
  { id: "u3", name: "Chiara Bellini", ini: "CB", role: "approver", label: "Approver", title: "Head of Retail Standards, Europe" },
  { id: "u4", name: "Kenji Watanabe", ini: "KW", role: "translator", label: "Translator", title: "Localization Specialist, Tokyo" },
  { id: "u5", name: "Sofia Ramírez", ini: "SR", role: "publisher", label: "Publisher", title: "Knowledge Publishing, Madrid" },
  { id: "u6", name: "Daniel Okafor", ini: "DO", role: "wsadmin", label: "Workspace admin", title: "Workspace Administrator" },
  { id: "u7", name: "Inês Duarte", ini: "ID", role: "entadmin", label: "Enterprise admin", title: "Platform Owner, Global" },
  { id: "u8", name: "Leo Fischer", ini: "LF", role: "consumer", label: "Consumer", title: "Store Associate, Munich" },
];

const WORKSPACES = ["Retail Operations · Europe", "Global Finance", "Manufacturing · Dongguan", "Supply Chain · Americas", "People & Culture · Global"];

const STATUS = {
  draft: ["Draft", "neutral"], processing: ["Processing", "info"], ai: ["AI generated", "ai"], creator: ["Creator review", "info"],
  sme: ["SME review", "warn"], compliance: ["Compliance review", "warn"], approval: ["Approval pending", "warn"],
  approved: ["Approved", "ok"], published: ["Published", "ok"], changes: ["Changes requested", "err"], expired: ["Expired", "err"], archived: ["Archived", "neutral"],
};

const LANGS = { en: "English", fr: "French", it: "Italian", es: "Spanish", de: "German", pt: "Portuguese", zh: "Simplified Chinese", ja: "Japanese", hi: "Hindi", ar: "Arabic" };

const DESTS = [
  { key: "sharepoint", label: "SharePoint", target: "EL Knowledge · Retail Process Library" },
  { key: "stream", label: "Microsoft Stream", target: "Knowledge Studio channel" },
  { key: "teams", label: "Microsoft Teams", target: "Retail Europe · Store Standards" },
  { key: "leonardo", label: "Leonardo", target: "Learning catalogue" },
  { key: "knowzy", label: "Knowzy", target: "Store knowledge base" },
  { key: "portal", label: "Internal knowledge portal", target: "Knowledge Hub" },
  { key: "public", label: "Controlled public portal", target: "Disabled by enterprise policy", disabled: true },
];

/* Steps: [chapter, title, instruction, sec, warning?, tip?] */
const P = [
  { id: "p1", title: "Retail Store Opening Checklist", fn: "Retail Operations", region: "Europe", country: "Italy", lang: "en", targets: ["fr", "it", "de", "es"], cls: "Internal",
    status: "sme", owner: "Amara Mensah", sme: "Pierre Laurent", approver: "Chiara Bellini", version: 3, approvedV: 2, publishedV: 2, updated: 0.2, review: 140, views: 4820, dur: 312, hue: 205,
    system: "Store Portal (POS Back Office)", audience: "Store managers and opening associates",
    summary: "The daily opening routine for EssilorLuxottica optical stores: security, systems, displays, and the first-customer readiness check.",
    steps: [
      ["Arrival and security", "Disarm the alarm and record the opening time", "Enter through the staff door, disarm the alarm with your personal code, and confirm the opening time on the Store Portal home screen.", 8, "Never share alarm codes. If the alarm will not disarm, call the security desk before entering the sales floor.", null],
      ["Arrival and security", "Walk the sales floor safety check", "Check that emergency exits are clear, the eye-test room equipment is switched off, and there are no visible hazards on the floor.", 42, null, "Use the printed floor map at the back office for the first two weeks."],
      ["Systems", "Open the POS day in Store Portal", "Select Day Operations, then Open Day. Confirm the opening cash float matches the closing count from the previous evening.", 88, "If the float differs by more than €20, stop and raise a Cash Variance ticket before trading.", null],
      ["Systems", "Sync appointment calendar", "Open Appointments and select Sync. Confirm eye-exam bookings for the day match the optometrist schedule.", 141, null, "Bookings made after 21:00 can take up to 15 minutes to appear."],
      ["Displays", "Prepare frame displays", "Unlock display cases, remove anti-theft covers, and replace any frames sold the previous day using the Replenishment list.", 186, null, null],
      ["Displays", "Check promotional signage", "Confirm in-store signage matches the current campaign in the Visual Merchandising calendar.", 228, null, "Expired promotions must be removed before opening."],
      ["Ready to trade", "Complete the opening confirmation", "In Store Portal, select Opening Checklist and confirm all items. The store status changes to Open and the regional dashboard updates.", 272, null, null],
    ] },
  { id: "p2", title: "Monthly Finance Closing Procedure", fn: "Finance", region: "Global", country: "France", lang: "en", targets: ["fr", "it"], cls: "Confidential",
    status: "approval", owner: "Marc Delacroix", sme: "Hélène Moreau", approver: "Chiara Bellini", version: 5, approvedV: 4, publishedV: 4, updated: 1, review: 12, views: 1240, dur: 540, hue: 220,
    system: "SAP S/4HANA", audience: "Entity controllers and accountants",
    summary: "Month-end close sequence for entity controllers: accruals, intercompany reconciliation, and the controller sign-off.",
    steps: [
      ["Preparation", "Confirm the closing calendar", "Open the Group Close Calendar and confirm the entity deadline for this period.", 10, null, null],
      ["Accruals", "Post recurring accruals", "In SAP, run transaction FBS1 for recurring accruals and attach the supporting schedule.", 95, "Accruals above the materiality threshold require controller approval before posting.", null],
      ["Intercompany", "Reconcile intercompany balances", "Run the intercompany matching report and resolve differences above €5,000 with the counterpart entity.", 220, null, "Start with the three largest counterpart entities."],
      ["Sign-off", "Complete the controller checklist", "Complete the close checklist and submit it for the controller's sign-off.", 470, null, null],
    ] },
  { id: "p3", title: "New Employee Onboarding Journey", fn: "Human Resources", region: "Global", country: "Global", lang: "en", targets: ["fr", "it", "es", "pt", "zh", "ja"], cls: "Internal",
    status: "published", owner: "Grace Liu", sme: "Tomás Herrera", approver: "Chiara Bellini", version: 2, approvedV: 2, publishedV: 2, updated: 9, review: 18, views: 12310, dur: 420, hue: 190,
    system: "Workday", audience: "All new joiners",
    summary: "What happens in the first 30 days: accounts, equipment, mandatory training, and meeting your onboarding buddy.",
    steps: [
      ["Day one", "Activate your accounts", "Use the activation email to set up your Microsoft account and register multi-factor authentication.", 20, "Never share your one-time codes with anyone, including IT support.", null],
      ["Day one", "Complete your Workday profile", "Open Workday, select Onboarding Tasks, and complete personal and bank details.", 110, null, null],
      ["First week", "Finish mandatory training", "Complete Code of Ethics and Data Protection modules in Leonardo within your first five working days.", 230, null, "Each module takes about 20 minutes."],
      ["First month", "Plan your 30-day check-in", "Book a 30-day check-in with your manager using the template in Workday.", 360, null, null],
    ] },
  { id: "p4", title: "Manufacturing Quality Inspection", fn: "Manufacturing", region: "Asia Pacific", country: "China", lang: "zh", targets: ["en"], cls: "Confidential",
    status: "changes", owner: "Wei Zhang", sme: "Li Na", approver: "Rafael Costa", version: 4, approvedV: 3, publishedV: 3, updated: 3, review: -6, views: 2210, dur: 380, hue: 175,
    system: "MES Quality Module", audience: "Line inspectors, lens finishing",
    summary: "Final visual and dimensional inspection for finished lenses before packing, including defect coding and line hold rules.",
    steps: [
      ["Setup", "Calibrate the inspection station", "Run the daily calibration with the reference lens and record the result in the MES Quality Module.", 15, "Do not inspect lenses if calibration fails. Place the station on hold.", null],
      ["Inspection", "Inspect the lens surface", "Under the inspection lamp, check for scratches, coating defects and inclusions.", 120, null, null],
      ["Inspection", "Record defects with codes", "Select the defect code and position in MES. Three identical defects in one hour triggers a line hold.", 210, "A line hold must be confirmed by the shift supervisor.", null],
    ] },
  { id: "p5", title: "Product Demonstration and Sales Enablement", fn: "Sales & Marketing", region: "North America", country: "United States", lang: "en", targets: ["es", "fr"], cls: "Internal",
    status: "ai", owner: "Jordan Blake", sme: "Priya Nair", approver: "Chiara Bellini", version: 1, approvedV: null, publishedV: null, updated: 0.05, review: 180, views: 0, dur: 600, hue: 260,
    system: "Clienteling App", audience: "Sales associates and optical advisors",
    summary: "How to demonstrate smart eyewear features to customers and record the follow-up in the clienteling app.",
    steps: [
      ["Demonstration", "Pair the demo device", "Open the companion app on the store demo phone and pair the demonstration frame.", 30, null, null],
      ["Demonstration", "Show the key features", "Walk the customer through audio, capture and notification features using the demo script.", 140, "Do not capture images of customers without their explicit permission.", null],
      ["Follow-up", "Log the interaction", "In the clienteling app, log the demonstration and schedule a follow-up if requested.", 470, null, null],
    ] },
  { id: "p6", title: "Supply Chain Shipment Exception Process", fn: "Supply Chain", region: "Latin America", country: "Brazil", lang: "pt", targets: ["en", "es"], cls: "Internal",
    status: "published", owner: "Beatriz Souza", sme: "Carlos Mendes", approver: "Rafael Costa", version: 3, approvedV: 3, publishedV: 3, updated: 22, review: 21, views: 3380, dur: 290, hue: 160,
    system: "Transport Management System", audience: "Logistics coordinators",
    summary: "Handling delayed, damaged or incomplete inbound shipments: logging, carrier claims and customer communication.",
    steps: [
      ["Detection", "Log the exception", "In the Transport Management System, open the shipment and select Report Exception.", 18, null, null],
      ["Resolution", "Open a carrier claim", "For damaged goods, attach photos and open a claim within 48 hours of delivery.", 120, "Claims opened after 48 hours are usually rejected by carriers.", null],
      ["Communication", "Notify affected stores", "Send the template notification to stores with orders on the affected shipment.", 230, null, null],
    ] },
  { id: "p7", title: "IT Application Access Request", fn: "IT & Digital", region: "Global", country: "Global", lang: "en", targets: ["fr", "it", "de", "es", "pt", "zh", "ja", "hi", "ar"], cls: "Internal",
    status: "published", owner: "Ravi Iyer", sme: "Nadia Haddad", approver: "Chiara Bellini", version: 6, approvedV: 6, publishedV: 6, updated: 40, review: -12, views: 9870, dur: 210, hue: 215,
    system: "ServiceNow", audience: "All employees",
    summary: "How to request access to a business application in ServiceNow, and what to do when access is delayed.",
    steps: [
      ["Request", "Open the access catalogue", "In ServiceNow, open Request Something and choose Application Access.", 12, null, null],
      ["Request", "Select the application and role", "Search for the application, choose the role your manager approved, and add a business justification.", 64, "Request only the access you need for your current role.", null],
      ["Tracking", "Track approval", "Open My Requests to see approver status. Most requests complete within two working days.", 150, null, "You can add a comment to nudge the approver."],
    ] },
  { id: "p8", title: "Customer Service Return Workflow", fn: "Customer Service", region: "Europe", country: "Germany", lang: "de", targets: ["en", "fr"], cls: "Internal",
    status: "approved", owner: "Anna Weber", sme: "Pierre Laurent", approver: "Chiara Bellini", version: 2, approvedV: 2, publishedV: 1, updated: 2, review: 170, views: 1650, dur: 330, hue: 230,
    system: "Store Portal (Returns)", audience: "Store associates and contact-centre agents",
    summary: "Processing frame and lens returns, from eligibility checks to refunds, with exceptions for prescription lenses.",
    steps: [
      ["Eligibility", "Check return eligibility", "Look up the order in Store Portal Returns and confirm the purchase date and product condition.", 20, "Prescription lenses can only be returned for manufacturing defects.", null],
      ["Processing", "Create the return order", "Select Create Return, choose the reason code, and print the return label.", 110, null, null],
      ["Refund", "Issue the refund", "Refund to the original payment method. Store credit is offered only when requested by the customer.", 220, null, null],
    ] },
];

/* Build scenes and script from steps. */
P.forEach((p) => {
  p.steps = p.steps.map((s, i) => ({ id: p.id + "s" + (i + 1), chapter: s[0], title: s[1], instruction: s[2], sec: s[3], warning: s[4], tip: s[5], origin: "ai", mx: 30 + ((i * 17) % 45), my: 30 + ((i * 23) % 40), alt: "Screenshot of " + p.system + ": " + s[1].toLowerCase() }));
  p.scenes = p.steps.map((s, i, a) => ({ id: p.id + "c" + (i + 1), title: s.title, start: s.sec, end: a[i + 1] ? a[i + 1].sec : p.dur, zoom: i % 2 === 0, redact: i === 2 }));
  p.script = p.steps.map((s, i) => ({ id: p.id + "t" + (i + 1), start: s.sec, original: "So um, here we " + s.title.toLowerCase() + ", you basically just " + s.instruction.charAt(0).toLowerCase() + s.instruction.slice(1, 60) + "…", text: s.instruction, origin: "ai", locked: false, flag: i === 2 ? p.system : null }));
});

const COMMENTS = [
  { id: "cm1", pid: "p1", author: "Pierre Laurent", ini: "PL", body: "Step 3: the variance threshold in French stores is €10, not €20. Can we make this region-aware?", anchor: "Step 3", ver: 3, when: 0.15, resolved: false },
  { id: "cm2", pid: "p1", author: "Amara Mensah", ini: "AM", body: "Good catch. I'll add a regional note and keep €20 as the default for Italy.", anchor: "Step 3", ver: 3, when: 0.1, resolved: false },
  { id: "cm3", pid: "p4", author: "Li Na", ini: "LN", body: "The defect-code list in Scene 3 shows an old MES screen. Please re-record with the current release.", anchor: "Scene 3 · 03:30", ver: 4, when: 2.5, resolved: false },
];

const REVIEWS = [
  { id: "r1", pid: "p1", stage: "SME review", assignee: "u2", ver: 3, due: 2, status: "open" },
  { id: "r2", pid: "p2", stage: "Approval", assignee: "u3", ver: 5, due: 1, status: "open" },
  { id: "r3", pid: "p4", stage: "SME review", assignee: "u2", ver: 4, due: -2, status: "changes" },
  { id: "r4", pid: "p8", stage: "Compliance review", assignee: "u3", ver: 2, due: -5, status: "approved" },
];

const TRANSLATIONS = [
  { pid: "p1", lang: "fr", status: "Regional review", reviewer: "Camille Roux", pct: 92, video: "Rendering", guide: "In review", captions: "Done", voice: "Done", appr: "Pending" },
  { pid: "p1", lang: "it", status: "Approved", reviewer: "Luca Romano", pct: 100, video: "Done", guide: "Done", captions: "Done", voice: "Done", appr: "Approved" },
  { pid: "p1", lang: "de", status: "Terminology check", reviewer: "Jonas Becker", pct: 64, video: "Not started", guide: "In progress", captions: "Done", voice: "Not started", appr: "Not started" },
  { pid: "p1", lang: "es", status: "Machine translated", reviewer: "Lucía Navarro", pct: 38, video: "Not started", guide: "Machine draft", captions: "Machine draft", voice: "Not started", appr: "Not started" },
  { pid: "p7", lang: "ar", status: "Approved", reviewer: "Omar Khalil", pct: 100, video: "Done", guide: "Done", captions: "Done", voice: "Done", appr: "Approved" },
  { pid: "p7", lang: "ja", status: "Regional review", reviewer: "Kenji Watanabe", pct: 88, video: "Done", guide: "In review", captions: "Done", voice: "Done", appr: "Pending" },
];

const PUBLICATIONS = [
  { pid: "p3", ver: 2, dest: "sharepoint", lang: "en", when: 9, by: "Sofia Ramírez" },
  { pid: "p3", ver: 2, dest: "leonardo", lang: "en", when: 9, by: "Sofia Ramírez" },
  { pid: "p7", ver: 6, dest: "knowzy", lang: "en", when: 40, by: "Sofia Ramírez" },
  { pid: "p1", ver: 2, dest: "teams", lang: "en", when: 60, by: "Sofia Ramírez" },
];

const TEMPLATES = [
  ["Global process guide", "Global", "Video · Guide · Article", "Creator → SME → Approver"],
  ["Manufacturing work instruction", "Manufacturing", "Video · SOP · Quiz", "SME → Quality → Approver"],
  ["Retail store procedure", "Retail Operations", "Video · Quick-reference · FAQ", "SME → Approver"],
  ["HR employee process", "Human Resources", "Guide · Article · FAQ", "HR SME → Compliance"],
  ["Finance control procedure", "Finance", "SOP · Article", "Controller → Compliance → Approver"],
  ["IT application tutorial", "IT & Digital", "Video · Guide · Subtitles", "SME → Approver"],
  ["Learning module", "Learning & Development", "Video · Training summary · Quiz", "SME → L&D → Approver"],
  ["Product demonstration", "Sales & Marketing", "Video · Article", "Brand → Approver"],
  ["Compliance communication", "Compliance", "Video · Article · Acknowledgment", "Compliance → Legal → Approver"],
  ["Change-management guide", "Global", "Video · Guide · FAQ", "Change lead → Approver"],
];

const AUDIT = [
  [0.1, "Amara Mensah", "Comment added", "Retail Store Opening Checklist", 3, "success"],
  [0.15, "Pierre Laurent", "Comment added", "Retail Store Opening Checklist", 3, "success"],
  [0.2, "Amara Mensah", "Review submitted", "Retail Store Opening Checklist", 3, "success"],
  [0.3, "Amara Mensah", "Content edited", "Retail Store Opening Checklist", 3, "success"],
  [1, "Marc Delacroix", "Review submitted", "Monthly Finance Closing Procedure", 5, "success"],
  [2.5, "Li Na", "Approval rejected", "Manufacturing Quality Inspection", 4, "success"],
  [3, "Leo Fischer", "Download blocked", "Monthly Finance Closing Procedure", 5, "denied"],
  [9, "Sofia Ramírez", "Content published", "New Employee Onboarding Journey", 2, "success"],
  [9.2, "Chiara Bellini", "Approval granted", "New Employee Onboarding Journey", 2, "success"],
];

const NOTIFS = [
  { t: "Review assigned", b: "Retail Store Opening Checklist v3 is waiting for your SME review.", when: 0.2, go: ["project", "p1", "review"] },
  { t: "Changes requested", b: "Li Na requested changes to Manufacturing Quality Inspection, Scene 3.", when: 2.5, go: ["project", "p4", "review"] },
  { t: "Review date approaching", b: "IT Application Access Request is 12 days past its review date.", when: 4, go: ["project", "p7", "overview"] },
];

const SUGGESTED = ["How do I open the POS day?", "What if the cash float is wrong?", "How do I request application access?", "Carrier claim deadline", "Return a prescription lens"];
