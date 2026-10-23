// Fictional demo content. No real employees, customers or systems data.
export const WORKSPACES = [
  { slug: "retail-europe", name: "Retail Operations · Europe", region: "Europe", description: "Store standards and customer operations for European optical retail." },
  { slug: "global-corporate", name: "Global Corporate Functions", region: "Global", description: "Finance, HR and IT processes shared across the group." },
  { slug: "operations", name: "Operations & Supply Chain", region: "Global", description: "Manufacturing quality and logistics procedures." },
];

export const USERS = [
  { key: "amara", email: "amara.mensah@demo.el-knowledge.test", displayName: "Amara Mensah", initials: "AM", jobTitle: "Retail Excellence Lead, Milan", location: "Milan", memberships: { "retail-europe": "creator", "global-corporate": "consumer" } },
  { key: "pierre", email: "pierre.laurent@demo.el-knowledge.test", displayName: "Pierre Laurent", initials: "PL", jobTitle: "Store Operations Manager, Paris", location: "Paris", memberships: { "retail-europe": "reviewer,sme", operations: "sme" } },
  { key: "chiara", email: "chiara.bellini@demo.el-knowledge.test", displayName: "Chiara Bellini", initials: "CB", jobTitle: "Head of Retail Standards, Europe", location: "Milan", memberships: { "retail-europe": "approver", "global-corporate": "approver" } },
  { key: "kenji", email: "kenji.watanabe@demo.el-knowledge.test", displayName: "Kenji Watanabe", initials: "KW", jobTitle: "Localization Specialist, Tokyo", location: "Tokyo", memberships: { "retail-europe": "translator", "global-corporate": "translator" } },
  { key: "sofia", email: "sofia.ramirez@demo.el-knowledge.test", displayName: "Sofía Ramírez", initials: "SR", jobTitle: "Knowledge Publishing, Madrid", location: "Madrid", memberships: { "retail-europe": "publisher", "global-corporate": "publisher" } },
  { key: "daniel", email: "daniel.okafor@demo.el-knowledge.test", displayName: "Daniel Okafor", initials: "DO", jobTitle: "Workspace Administrator", location: "London", memberships: { "retail-europe": "workspace-admin" } },
  { key: "ines", email: "ines.duarte@demo.el-knowledge.test", displayName: "Inês Duarte", initials: "ID", jobTitle: "Platform Owner, Global", location: "Lisbon", enterprise: true, memberships: { "retail-europe": "workspace-admin", "global-corporate": "workspace-admin", operations: "workspace-admin" } },
  { key: "leo", email: "leo.fischer@demo.el-knowledge.test", displayName: "Leo Fischer", initials: "LF", jobTitle: "Store Associate, Munich", location: "Munich", memberships: { "retail-europe": "consumer" } },
  // Content owners without demo personas
  { key: "marc", email: "marc.delacroix@demo.el-knowledge.test", displayName: "Marc Delacroix", initials: "MD", jobTitle: "Entity Controller, Paris", location: "Paris", memberships: { "global-corporate": "creator" } },
  { key: "grace", email: "grace.liu@demo.el-knowledge.test", displayName: "Grace Liu", initials: "GL", jobTitle: "People Experience Lead", location: "Shanghai", memberships: { "global-corporate": "creator" } },
  { key: "wei", email: "wei.zhang@demo.el-knowledge.test", displayName: "Wei Zhang", initials: "WZ", jobTitle: "Quality Engineer, Dongguan", location: "Dongguan", memberships: { operations: "creator" } },
  { key: "jordan", email: "jordan.blake@demo.el-knowledge.test", displayName: "Jordan Blake", initials: "JB", jobTitle: "Sales Enablement Manager", location: "Dallas", memberships: { "retail-europe": "creator" } },
  { key: "beatriz", email: "beatriz.souza@demo.el-knowledge.test", displayName: "Beatriz Souza", initials: "BS", jobTitle: "Logistics Coordinator, São Paulo", location: "São Paulo", memberships: { operations: "creator" } },
  { key: "ravi", email: "ravi.iyer@demo.el-knowledge.test", displayName: "Ravi Iyer", initials: "RI", jobTitle: "IT Service Owner", location: "Chennai", memberships: { "global-corporate": "creator" } },
  { key: "anna", email: "anna.weber@demo.el-knowledge.test", displayName: "Anna Weber", initials: "AW", jobTitle: "Customer Service Lead, Munich", location: "Munich", memberships: { "retail-europe": "creator" } },
] as const;

type Step = [chapter: string, title: string, instruction: string, sec: number, warning?: string, tip?: string];

export interface SeedProject {
  key: string; ws: string; owner: string; title: string; fn: string; category: string; region: string; country: string; lang: string; targets: string[];
  cls: string; status: string; sme: string; approver: string; version: number; approvedV: number | null; publishedV: number | null;
  updatedDaysAgo: number; nextReviewDays: number; views: number; dur: number; hue: number; system: string; audience: string; summary: string;
  destinations: string[]; template: string; steps: Step[];
}

export const PROJECTS: SeedProject[] = [
  { key: "store-opening", ws: "retail-europe", owner: "amara", title: "Retail Store Opening Checklist", fn: "Retail Operations", category: "Store operations", region: "Europe", country: "Italy", lang: "en", targets: ["fr", "it", "de", "es"], cls: "Internal",
    status: "sme-review", sme: "Pierre Laurent", approver: "Chiara Bellini", version: 3, approvedV: 2, publishedV: 2, updatedDaysAgo: 0.2, nextReviewDays: 140, views: 4820, dur: 312, hue: 205,
    system: "Store Portal", audience: "Store managers and opening associates", destinations: ["sharepoint", "teams"], template: "retail",
    summary: "The daily opening routine for optical stores: security, systems, displays and the first-customer readiness check.",
    steps: [
      ["Arrival and security", "Disarm the alarm and record the opening time", "Enter through the staff door, disarm the alarm with your personal code, and confirm the opening time on the Store Portal home screen.", 8, "Never share alarm codes. If the alarm will not disarm, call the security desk before entering the sales floor."],
      ["Arrival and security", "Walk the sales floor safety check", "Check that emergency exits are clear, eye-test room equipment is switched off, and there are no visible hazards on the floor.", 42, undefined, "Use the printed floor map in the back office for your first two weeks."],
      ["Systems", "Open the POS day in Store Portal", "Select Day Operations, then Open Day. Confirm the opening cash float matches the closing count from the previous evening.", 88, "If the float differs by more than €20, stop and raise a Cash Variance ticket before trading."],
      ["Systems", "Sync the appointment calendar", "Open Appointments and select Sync. Confirm eye-exam bookings for the day match the optometrist schedule.", 141, undefined, "Bookings made after 21:00 can take up to 15 minutes to appear."],
      ["Displays", "Prepare frame displays", "Unlock display cases, remove anti-theft covers, and replace frames sold the previous day using the Replenishment list.", 186],
      ["Displays", "Check promotional signage", "Confirm in-store signage matches the current campaign in the Visual Merchandising calendar.", 228, undefined, "Expired promotions must be removed before opening."],
      ["Ready to trade", "Complete the opening confirmation", "In Store Portal, select Opening Checklist and confirm all items. The store status changes to Open and the regional dashboard updates.", 272],
    ] },
  { key: "finance-close", ws: "global-corporate", owner: "marc", title: "Monthly Finance Closing Procedure", fn: "Finance", category: "Record to report", region: "Global", country: "France", lang: "en", targets: ["fr", "it"], cls: "Confidential",
    status: "approval-pending", sme: "Hélène Moreau", approver: "Chiara Bellini", version: 5, approvedV: 4, publishedV: 4, updatedDaysAgo: 1, nextReviewDays: 12, views: 1240, dur: 540, hue: 220,
    system: "SAP S/4HANA", audience: "Entity controllers and accountants", destinations: ["sharepoint"], template: "finance",
    summary: "Month-end close sequence for entity controllers: accruals, intercompany reconciliation and the controller sign-off.",
    steps: [
      ["Preparation", "Confirm the closing calendar", "Open the Group Close Calendar and confirm the entity deadline for this period.", 10],
      ["Accruals", "Post recurring accruals", "In SAP S/4HANA, run the recurring accrual posting and attach the supporting schedule.", 95, "Accruals above the materiality threshold require controller approval before posting."],
      ["Intercompany", "Reconcile intercompany balances", "Run the intercompany matching report and resolve differences above €5,000 with the counterpart entity.", 220, undefined, "Start with the three largest counterpart entities."],
      ["Sign-off", "Complete the controller checklist", "Complete the close checklist and submit it for the controller's sign-off.", 470],
    ] },
  { key: "onboarding", ws: "global-corporate", owner: "grace", title: "New Employee Onboarding Journey", fn: "Human Resources", category: "Onboarding", region: "Global", country: "Global", lang: "en", targets: ["fr", "it", "es", "pt", "zh", "ja"], cls: "Internal",
    status: "published", sme: "Tomás Herrera", approver: "Chiara Bellini", version: 2, approvedV: 2, publishedV: 2, updatedDaysAgo: 9, nextReviewDays: 18, views: 12310, dur: 420, hue: 190,
    system: "Workday", audience: "All new joiners", destinations: ["sharepoint", "leonardo"], template: "hr",
    summary: "What happens in the first 30 days: accounts, equipment, mandatory training and meeting your onboarding buddy.",
    steps: [
      ["Day one", "Activate your accounts", "Use the activation e-mail to set up your Microsoft account and register multi-factor authentication.", 20, "Never share one-time codes with anyone, including IT support."],
      ["Day one", "Complete your Workday profile", "Open Workday, select Onboarding Tasks, and complete your personal and bank details.", 110],
      ["First week", "Finish mandatory training", "Complete the Code of Ethics and Data Protection modules in Leonardo within your first five working days.", 230, undefined, "Each module takes about 20 minutes."],
      ["First month", "Plan your 30-day check-in", "Book a 30-day check-in with your manager using the template in Workday.", 360],
    ] },
  { key: "quality-inspection", ws: "operations", owner: "wei", title: "Manufacturing Quality Inspection", fn: "Manufacturing", category: "Lens finishing", region: "Asia Pacific", country: "China", lang: "zh", targets: ["en"], cls: "Confidential",
    status: "changes-requested", sme: "Li Na", approver: "Rafael Costa", version: 4, approvedV: 3, publishedV: 3, updatedDaysAgo: 3, nextReviewDays: -6, views: 2210, dur: 380, hue: 175,
    system: "MES Quality Module", audience: "Line inspectors, lens finishing", destinations: ["sharepoint"], template: "manufacturing",
    summary: "Final visual and dimensional inspection of finished lenses before packing, including defect coding and line-hold rules.",
    steps: [
      ["Setup", "Calibrate the inspection station", "Run the daily calibration with the reference lens and record the result in the MES Quality Module.", 15, "Do not inspect lenses if calibration fails. Put the station on hold."],
      ["Inspection", "Inspect the lens surface", "Under the inspection lamp, check for scratches, coating defects and inclusions.", 120],
      ["Inspection", "Record defects with codes", "Select the defect code and position in MES. Three identical defects within one hour trigger a line hold.", 210, "A line hold must be confirmed by the shift supervisor."],
    ] },
  { key: "smart-eyewear-demo", ws: "retail-europe", owner: "jordan", title: "Product Demonstration and Sales Enablement", fn: "Sales & Marketing", category: "Clienteling", region: "North America", country: "United States", lang: "en", targets: ["es", "fr"], cls: "Internal",
    status: "ai-generated", sme: "Priya Nair", approver: "Chiara Bellini", version: 1, approvedV: null, publishedV: null, updatedDaysAgo: 0.05, nextReviewDays: 180, views: 0, dur: 600, hue: 260,
    system: "Clienteling App", audience: "Sales associates and optical advisors", destinations: ["leonardo"], template: "product",
    summary: "How to demonstrate smart eyewear features to customers and record the follow-up in the clienteling app.",
    steps: [
      ["Demonstration", "Pair the demo device", "Open the companion app on the store demo phone and pair the demonstration frame.", 30],
      ["Demonstration", "Show the key features", "Walk the customer through audio, capture and notification features using the demo script.", 140, "Do not capture images of customers without their explicit permission."],
      ["Follow-up", "Log the interaction", "In the Clienteling App, log the demonstration and schedule a follow-up if the customer asks for one.", 470],
    ] },
  { key: "shipment-exception", ws: "operations", owner: "beatriz", title: "Supply Chain Shipment Exception Process", fn: "Supply Chain", category: "Inbound logistics", region: "Latin America", country: "Brazil", lang: "pt", targets: ["en", "es"], cls: "Internal",
    status: "published", sme: "Carlos Mendes", approver: "Rafael Costa", version: 3, approvedV: 3, publishedV: 3, updatedDaysAgo: 22, nextReviewDays: 21, views: 3380, dur: 290, hue: 160,
    system: "Transport Management System", audience: "Logistics coordinators", destinations: ["sharepoint"], template: "global",
    summary: "Handling delayed, damaged or incomplete inbound shipments: logging, carrier claims and store communication.",
    steps: [
      ["Detection", "Log the exception", "In the Transport Management System, open the shipment and select Report Exception.", 18],
      ["Resolution", "Open a carrier claim", "For damaged goods, attach photos and open a claim within 48 hours of delivery.", 120, "Claims opened after 48 hours are usually rejected by carriers."],
      ["Communication", "Notify affected stores", "Send the template notification to stores with orders on the affected shipment.", 230],
    ] },
  { key: "access-request", ws: "global-corporate", owner: "ravi", title: "IT Application Access Request", fn: "IT & Digital", category: "Identity and access", region: "Global", country: "Global", lang: "en", targets: ["fr", "it", "de", "es", "pt", "zh", "ja", "hi", "ar"], cls: "Internal",
    status: "published", sme: "Nadia Haddad", approver: "Chiara Bellini", version: 6, approvedV: 6, publishedV: 6, updatedDaysAgo: 40, nextReviewDays: -12, views: 9870, dur: 210, hue: 215,
    system: "ServiceNow", audience: "All employees", destinations: ["knowzy", "sharepoint"], template: "it",
    summary: "How to request access to a business application in ServiceNow, and what to do when access is delayed.",
    steps: [
      ["Request", "Open the access catalogue", "In ServiceNow, open Request Something and choose Application Access.", 12],
      ["Request", "Select the application and role", "Search for the application, choose the role your manager approved, and add a business justification.", 64, "Request only the access you need for your current role."],
      ["Tracking", "Track the approval", "Open My Requests to see the approver status. Most requests complete within two working days.", 150, undefined, "You can add a comment to remind the approver."],
    ] },
  { key: "returns", ws: "retail-europe", owner: "anna", title: "Customer Service Return Workflow", fn: "Customer Service", category: "Returns", region: "Europe", country: "Germany", lang: "de", targets: ["en", "fr"], cls: "Internal",
    status: "approved", sme: "Pierre Laurent", approver: "Chiara Bellini", version: 2, approvedV: 2, publishedV: 1, updatedDaysAgo: 2, nextReviewDays: 170, views: 1650, dur: 330, hue: 230,
    system: "Store Portal", audience: "Store associates and contact-centre agents", destinations: ["sharepoint", "teams"], template: "retail",
    summary: "Processing frame and lens returns, from eligibility checks to refunds, with exceptions for prescription lenses.",
    steps: [
      ["Eligibility", "Check return eligibility", "Look up the order in Store Portal Returns and confirm the purchase date and product condition.", 20, "Prescription lenses can only be returned for manufacturing defects."],
      ["Processing", "Create the return order", "Select Create Return, choose the reason code, and print the return label.", 110],
      ["Refund", "Issue the refund", "Refund to the original payment method. Offer store credit only when the customer asks for it.", 220],
    ] },
];

export const TEMPLATES = [
  ["global", "Global process guide", "Global", "video,guide,article", "Creator → SME → Approver", "sharepoint"],
  ["manufacturing", "Manufacturing work instruction", "Manufacturing", "video,sop,quiz", "SME → Quality → Approver", "sharepoint"],
  ["retail", "Retail store procedure", "Retail Operations", "video,qrg,faq", "SME → Approver", "teams"],
  ["hr", "HR employee process", "Human Resources", "guide,article,faq", "HR SME → Compliance → Approver", "sharepoint"],
  ["finance", "Finance control procedure", "Finance", "sop,article", "Controller → Compliance → Approver", "sharepoint"],
  ["it", "IT application tutorial", "IT & Digital", "video,guide,subtitles", "SME → Approver", "knowzy"],
  ["learning", "Learning module", "Learning & Development", "video,training,quiz", "SME → L&D → Approver", "leonardo"],
  ["product", "Product demonstration", "Sales & Marketing", "video,article", "Brand → Approver", "leonardo"],
  ["compliance", "Compliance communication", "Compliance", "video,article", "Compliance → Legal → Approver", "sharepoint"],
  ["change", "Change-management guide", "Global", "video,guide,faq", "Change lead → Approver", "teams"],
] as const;
