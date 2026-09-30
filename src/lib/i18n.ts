/**
 * UI strings.
 *
 * Separate from module content: the safety curriculum in `src/modules/*.json`
 * is authored and reviewed as content, while these are the chrome around it —
 * buttons, verdicts, gate labels. Both ship in English and Hindi.
 *
 * `sat` is a reserved, unfilled slot (docs/01-gap-analysis.md §7.1). It is not
 * machine-translated, because a mistranslated extinguisher class is worse than
 * an English one. The type keeps the slot so filling it is a data change.
 */

import type { Localised, Locale } from "./types";

export type UiKey =
  | "app.name"
  | "app.tagline"
  | "nav.dashboard"
  | "nav.admin"
  | "nav.certificate"
  | "nav.signOut"
  | "nav.settings"
  | "common.continue"
  | "common.start"
  | "common.retry"
  | "common.close"
  | "common.loading"
  | "common.offline"
  | "common.online"
  | "common.signIn"
  | "common.createAccount"
  | "common.back"
  | "common.critical"
  | "landing.hero.title"
  | "landing.hero.subtitle"
  | "landing.cta.primary"
  | "landing.cta.secondary"
  | "landing.stat.certificates"
  | "landing.stat.trainees"
  | "landing.stat.critical"
  | "landing.feature.gate.title"
  | "landing.feature.gate.body"
  | "landing.feature.recheck.title"
  | "landing.feature.recheck.body"
  | "landing.feature.heatmap.title"
  | "landing.feature.heatmap.body"
  | "landing.feature.offline.title"
  | "landing.feature.offline.body"
  | "landing.feature.nohelmet.title"
  | "landing.feature.nohelmet.body"
  | "landing.status.title"
  | "landing.status.body"
  | "landing.step.train.body"
  | "landing.feature.bilingual.title"
  | "landing.feature.bilingual.body"
  | "auth.signIn.title"
  | "auth.signIn.subtitle"
  | "auth.register.title"
  | "auth.register.subtitle"
  | "auth.name"
  | "auth.email"
  | "auth.password"
  | "auth.haveAccount"
  | "auth.needAccount"
  | "auth.adminNotice"
  | "auth.google.continue"
  | "auth.google.divider"
  | "auth.google.failed"
  | "dashboard.greeting"
  | "dashboard.modules"
  | "dashboard.yourStanding"
  | "dashboard.notStarted"
  | "dashboard.startModule"
  | "dashboard.continueModule"
  | "dashboard.retake"
  | "dashboard.minutes"
  | "dashboard.steps"
  | "dashboard.certificate"
  | "dashboard.noCertificate"
  | "result.trainingComplete"
  | "result.gateTitle"
  | "result.certificateIssued"
  | "result.certificateBlocked"
  | "result.recheckRequired"
  | "result.takeRecheck"
  | "result.backToDashboard"
  | "recheck.title"
  | "recheck.subtitle"
  | "recheck.sampleNotice"
  | "recheck.submit"
  | "recheck.passed"
  | "recheck.failed"
  | "recheck.waiting"
  | "recheck.eligible"
  | "cert.title"
  | "cert.holder"
  | "cert.issued"
  | "cert.expires"
  | "cert.score"
  | "cert.verifyCta"
  | "verify.title"
  | "verify.notFound"
  | "verify.valid"
  | "verify.expired"
  | "verify.revoked"
  | "verify.tampered"
  | "admin.title"
  | "admin.subtitle"
  | "admin.heatmap"
  | "admin.roster"
  | "admin.misconceptions"
  | "admin.firstTryMiss"
  | "admin.failRate"
  | "admin.noData"
  | "training.hint"
  | "training.hintsLeft"
  | "training.noHints"
  | "training.step"
  | "training.modeMarker"
  | "training.modeReticle"
  | "training.modeGuided"
  | "training.cameraUnavailable"
  | "training.tapTarget"
  | "training.tapInOrder"
  | "training.chooseOne"
  | "training.pendingReview.title"
  | "training.narration.on"
  | "training.narration.off"
  | "training.narration.toggle"
  | "training.narration.noVoice"
  | "training.narration.unsupported"
  | "training.narration.blocked"
  | "training.pendingReview.body"
  | "training.pendingReview.hold"
  | "training.queueSaved"
  | "training.syncing"
  | "training.pass"
  | "training.fail";

type Strings = Record<UiKey, Localised>;

export const UI: Strings = {
  "app.name": { en: "KAVACH", hi: "कवच" },
  "app.tagline": {
    en: "Safety training that remembers",
    hi: "सुरक्षा प्रशिक्षण जो याद रखता है",
  },

  "nav.dashboard": { en: "Training", hi: "प्रशिक्षण" },
  "nav.admin": { en: "Safety dashboard", hi: "सुरक्षा डैशबोर्ड" },
  "nav.certificate": { en: "Certificate", hi: "प्रमाणपत्र" },
  "nav.signOut": { en: "Sign out", hi: "साइन आउट" },
  "nav.settings": { en: "Settings", hi: "सेटिंग्स" },

  "common.continue": { en: "Continue", hi: "आगे बढ़ो" },
  "common.start": { en: "Start", hi: "शुरू करो" },
  "common.retry": { en: "Try again", hi: "फिर कोशिश करो" },
  "common.close": { en: "Close", hi: "बंद करो" },
  "common.loading": { en: "Loading…", hi: "लोड हो रहा है…" },
  "common.offline": { en: "Offline", hi: "ऑफ़लाइन" },
  "common.online": { en: "Online", hi: "ऑनलाइन" },
  "common.signIn": { en: "Sign in", hi: "साइन इन" },
  "common.createAccount": { en: "Create account", hi: "खाता बनाएँ" },
  "common.back": { en: "Back", hi: "वापस" },
  "common.critical": { en: "Critical", hi: "गंभीर" },

  "landing.hero.title": {
    en: "A certificate that proves you still remember it.",
    hi: "एक प्रमाणपत्र जो साबित करता है कि आपको अभी भी याद है।",
  },
  "landing.hero.subtitle": {
    en: "Headset-free AR safety training for mines and plants. Nobody in the industry certifies retention. KAVACH does — and every certificate carries a QR an inspector can scan on a floor with no signal.",
    hi: "खदानों और कारखानों के लिए बिना हेडसेट वाली AR सुरक्षा प्रशिक्षण। उद्योग में कोई प्रतिधारण प्रमाणित नहीं करता। कवच करता है — और हर प्रमाणपत्र पर QR है जिसे बिना नेटवर्क के भी स्कैन किया जा सकता है।",
  },
  "landing.cta.primary": { en: "Start certification", hi: "प्रमाणन शुरू करें" },
  /**
   * Pre-pilot disclosure.
   *
   * The hero promises a certificate. Today the platform will not issue one,
   * because one required module has a step the safety reviewer has not
   * approved, and a module that cannot be completed is a module that cannot be
   * certified. That is the gate working, not the product being broken — but a
   * trainee who starts a certification they cannot finish was told something
   * untrue by this page, so the page says so.
   */
  "landing.status.title": { en: "Pre-pilot build", hi: "पायलट-पूर्व संस्करण" },
  "landing.status.body": {
    en: "No certificate can be issued yet. Neither module has yet had the qualified safety review that both module specifications name as a release blocker, and one gas step has no approved procedure at all — so that module cannot be completed, and a module that cannot be completed cannot be certified. Fire and explosion is complete and matches its specification exactly. Nothing here is marked validated that is not.",
    hi: "अभी कोई प्रमाणपत्र जारी नहीं किया जा सकता। दोनों मॉड्यूल विनिर्देशों में बताई गई योग्य सुरक्षा समीक्षा अभी तक दोनों में पूरी नहीं हुई है, और गैस के एक चरण की कोई स्वीकृत प्रक्रिया है ही नहीं — इसलिए वह मॉड्यूल पूरा नहीं हो सकता, और जो मॉड्यूल पूरा नहीं हो सकता, उसका प्रमाणन नहीं हो सकता। अग्नि एवं विस्फोट पूरा है और अपने विनिर्देश से पूरी तरह मेल खाता है। यहाँ कुछ भी अप्रमाणित दावा नहीं किया गया है।",
  },
  "landing.step.train.body": {
    en: "Fire and explosion, then gas leak and confined space. Every step is graded, and a first-try miss on a critical step is recorded permanently. One gas step is still with the safety reviewer and is not yet trainable.",
    hi: "अग्नि एवं विस्फोट, फिर गैस रिसाव एवं बंद जगह। प्रत्येक चरण का मूल्यांकन होता है, और किसी गंभीर चरण पर पहली बार की गलती स्थायी रूप से दर्ज होती है। गैस का एक चरण अभी सुरक्षा समीक्षक के पास है और अभी प्रशिक्षण योग्य नहीं है।",
  },
  "landing.cta.secondary": { en: "Verify a certificate", hi: "प्रमाणपत्र जाँचें" },
  "landing.stat.certificates": { en: "certificates issued", hi: "प्रमाणपत्र जारी" },
  "landing.stat.trainees": { en: "trainees enrolled", hi: "प्रशिक्षणार्थी" },
  "landing.stat.critical": { en: "critical steps gated", hi: "गंभीर चरण नियंत्रित" },

  "landing.feature.gate.title": { en: "Eight criteria, not a score", hi: "आठ मानदंड, स्कोर नहीं" },
  "landing.feature.gate.body": {
    en: "Most platforms certify attendance. KAVACH certifies eight hard criteria — including zero first-attempt misses on the steps that kill people.",
    hi: "अधिकांश प्लेटफ़ॉर्म उपस्थिति प्रमाणित करते हैं। कवच आठ कठिन मानदंड प्रमाणित करता है — जिनमें जानलेवा चरणों पर पहली बार में गलती का शून्य भी शामिल है।",
  },
  "landing.feature.recheck.title": { en: "Cold retention re-check", hi: "शीत प्रतिधारण पुनःपरीक्षण" },
  "landing.feature.recheck.body": {
    en: "Ninety seconds after you finish, four steps are re-tested without hints or retries. A coached pass you cannot reproduce is not a pass.",
    hi: "समाप्त होने के नब्बे सेकंड बाद, चार चरण बिना संकेत या पुनःप्रयास के दोबारा जाँचे जाते हैं। जो पढ़ाकर सिखाया गया उत्तर दोबारा न दिया जा सके, वह उत्तर नहीं है।",
  },
  "landing.feature.heatmap.title": { en: "Step-level failure heatmap", hi: "चरण-स्तरीय विफलता हीटमैप" },
  "landing.feature.heatmap.body": {
    en: "Every wrong answer is tagged with the real-world misconception behind it, so a safety manager sees which belief to correct — not just a completion rate.",
    hi: "हर गलत उत्तर उस वास्तविक भ्रामकता से टैग होता है जिसके पीछे है, ताकि सुरक्षा प्रबंधक देखे कि कौन-सी समझ सुधारनी है — केवल पूर्णता दर नहीं।",
  },
  "landing.feature.offline.title": { en: "Works with the network off", hi: "नेटवर्क बंद होने पर भी चलता है" },
  "landing.feature.offline.body": {
    en: "Attempt telemetry is written on-device first and synced later, idempotently. A trainee in a dead zone loses nothing.",
    hi: "प्रयास डेटा पहले डिवाइस पर लिखा जाता है और बाद में सिंक होता है। मृत क्षेत्र में प्रशिक्षणार्थी कुछ नहीं खोता।",
  },
  "landing.feature.nohelmet.title": { en: "No headset, no printed markers", hi: "न हेडसेट, न छपे मार्कर" },
  "landing.feature.nohelmet.body": {
    en: "Aim-and-tap reticle on the phone camera, with a fully guided fallback. Nothing to print, nothing to calibrate, nothing to trip over.",
    hi: "फ़ोन कैमरा पर निशाना और टैप, पूरी तरह निर्देशित विकल्प के साथ। न छपाई, न सेटअप, न चलने की चोट।",
  },
  "landing.feature.bilingual.title": { en: "English and Hindi", hi: "अंग्रेज़ी और हिंदी" },
  "landing.feature.bilingual.body": {
    en: "Written in both languages by people who know the work, not machine-translated. Santali is a reserved slot, deliberately left unfilled.",
    hi: "दोनों भाषाओं में लिखा गया, मशीन अनुवाद नहीं। संताली एक आरक्षित स्थान है, जानबूझकर खाली छोड़ा गया है।",
  },

  "auth.signIn.title": { en: "Sign in", hi: "साइन इन करें" },
  "auth.signIn.subtitle": {
    en: "Pick up where you left off. Your progress is on this device.",
    hi: "जहाँ छोड़ा था वहीं से शुरू करें। आपकी प्रगति इसी डिवाइस पर है।",
  },
  "auth.register.title": { en: "Create your account", hi: "खाता बनाएँ" },
  "auth.register.subtitle": {
    en: "You will need a certificate before you can be rostered on.",
    hi: "ड्यूटी पर जुड़ने से पहले आपको प्रमाणपत्र चाहिए होगा।",
  },
  "auth.google.continue": { en: "Continue with Google", hi: "Google के साथ जारी रखें" },
  "auth.google.divider": { en: "or", hi: "या" },
  "auth.google.failed": {
    en: "Google sign-in could not be completed. You can still use email and password.",
    hi: "Google से साइन इन पूरा नहीं हुआ। आप ईमेल और पासवर्ड का उपयोग कर सकते हैं।",
  },
  "auth.name": { en: "Full name", hi: "पूरा नाम" },
  "auth.email": { en: "Email", hi: "ईमेल" },
  "auth.password": { en: "Password", hi: "पासवर्ड" },
  "auth.haveAccount": { en: "Already have an account?", hi: "पहले से खाता है?" },
  "auth.needAccount": { en: "No account yet?", hi: "खाता नहीं है?" },
  "auth.adminNotice": {
    en: "The first account created becomes the safety administrator for this site.",
    hi: "बनाया गया पहला खाता इस साइट का सुरक्षा प्रशासक बनेगा।",
  },

  "dashboard.greeting": { en: "Ready when you are", hi: "जब आप तैयार हों" },
  "dashboard.modules": { en: "Assigned modules", hi: "सौंपे गए मॉड्यूल" },
  "dashboard.yourStanding": { en: "Your standing", hi: "आपकी स्थिति" },
  "dashboard.notStarted": { en: "Not started", hi: "शुरू नहीं हुआ" },
  "dashboard.startModule": { en: "Start module", hi: "मॉड्यूल शुरू करें" },
  "dashboard.continueModule": { en: "Retake module", hi: "फिर से करें" },
  "dashboard.retake": { en: "Retake", hi: "दोबारा" },
  "dashboard.minutes": { en: "min", hi: "मिनट" },
  "dashboard.steps": { en: "steps", hi: "चरण" },
  "dashboard.certificate": { en: "Certificate", hi: "प्रमाणपत्र" },
  "dashboard.noCertificate": {
    en: "No certificate yet. Complete both modules and pass the cold re-check.",
    hi: "अभी प्रमाणपत्र नहीं। दोनों मॉड्यूल पूरे करें और शीत पुनःपरीक्षण पास करें।",
  },

  "result.trainingComplete": { en: "Module complete", hi: "मॉड्यूल पूरा" },
  "result.gateTitle": { en: "Certification gate", hi: "प्रमाणन द्वार" },
  "result.certificateIssued": { en: "Certificate issued", hi: "प्रमाणपत्र जारी" },
  "result.certificateBlocked": { en: "Certificate withheld", hi: "प्रमाणपत्र रोका गया" },
  "result.recheckRequired": {
    en: "Not a failure — just not yet. The cold re-check is what makes this certificate mean something.",
    hi: "यह विफलता नहीं है — अभी बस पूरा नहीं है। शीत पुनःपरीक्षण ही इस प्रमाणपत्र को अर्थपूर्ण बनाता है।",
  },
  "result.takeRecheck": { en: "Take the cold re-check", hi: "शीत पुनःपरीक्षण दें" },
  "result.backToDashboard": { en: "Back to training", hi: "प्रशिक्षण पर वापस" },

  "recheck.title": { en: "Cold retention re-check", hi: "शीत प्रतिधारण पुनःपरीक्षण" },
  "recheck.subtitle": {
    en: "Four steps, no hints, one attempt each. Answer from memory, not from the screen you just used.",
    hi: "चार चरण, कोई संकेत नहीं, हर चक्र में एक प्रयास। याद से उत्तर दें, उसी स्क्रीन से नहीं जिसका आपने अभी उपयोग किया।",
  },
  "recheck.sampleNotice": {
    en: "Which steps you will be asked is decided on the server and is not shown in advance.",
    hi: "किन चरणों से पूछा जाएगा यह सर्वर तय करता है और पहले नहीं दिखाया जाता।",
  },
  "recheck.submit": { en: "Submit re-check", hi: "पुनःपरीक्षण जमा करें" },
  "recheck.passed": { en: "Retained", hi: "प्रतिधारित" },
  "recheck.failed": { en: "Not retained", hi: "प्रतिधारित नहीं" },
  "recheck.waiting": { en: "Not eligible yet", hi: "अभी पात्र नहीं" },
  "recheck.eligible": { en: "Eligible now", hi: "अब पात्र" },

  "cert.title": { en: "Certificate of safety competency", hi: "सुरक्षा दक्षता प्रमाणपत्र" },
  "cert.holder": { en: "Issued to", hi: "जारीकर्ता" },
  "cert.issued": { en: "Issued", hi: "जारी" },
  "cert.expires": { en: "Valid until", hi: "वैध तिथि" },
  "cert.score": { en: "Assessed score", hi: "मूल्यांकित स्कोर" },
  "cert.verifyCta": { en: "Verify this certificate", hi: "यह प्रमाणपत्र जाँचें" },

  "verify.title": { en: "Verify a KAVACH certificate", hi: "कवच प्रमाणपत्र जाँचें" },
  "verify.notFound": { en: "No certificate with that code", hi: "इस कोड का कोई प्रमाणपत्र नहीं" },
  "verify.valid": { en: "Valid", hi: "वैध" },
  "verify.expired": { en: "Expired", hi: "समाप्त" },
  "verify.revoked": { en: "Revoked", hi: "निरस्त" },
  "verify.tampered": { en: "Signature does not match", hi: "हस्ताक्षर मेल नहीं खाता" },

  "admin.title": { en: "Safety dashboard", hi: "सुरक्षा डैशबोर्ड" },
  "admin.subtitle": {
    en: "Where your people are getting it wrong, by step and by belief.",
    hi: "आपके लोग कहाँ और कैसे गलती कर रहे हैं — चरण और समझ के अनुसार।",
  },
  "admin.heatmap": { en: "Step failure heatmap", hi: "चरण विफलता हीटमैप" },
  "admin.roster": { en: "Trainee roster", hi: "प्रशिक्षणार्थी सूची" },
  "admin.misconceptions": { en: "Most common wrong belief", hi: "सबसे आम गलत समझ" },
  "admin.firstTryMiss": { en: "First-try miss", hi: "पहली बार में चूक" },
  "admin.failRate": { en: "Fail rate", hi: "विफलता दर" },
  "admin.noData": {
    en: "No attempts recorded yet. Run a module and this fills in.",
    hi: "अभी कोई प्रयास दर्ज नहीं। कोई मॉड्यूल चलाएँ, यह भर जाएगा।",
  },

  "training.hint": { en: "Hint", hi: "संकेत" },
  "training.hintsLeft": { en: "hints left", hi: "संकेत बचे" },
  "training.noHints": { en: "No hints left", hi: "कोई संकेत नहीं बचा" },
  "training.step": { en: "Step", hi: "चरण" },
  "training.modeMarker": { en: "Marker (AR)", hi: "मार्कर (AR)" },
  "training.modeReticle": { en: "Reticle (camera)", hi: "रिटाइकल (कैमरा)" },
  "training.modeGuided": { en: "Guided", hi: "निर्देशित" },
  "training.cameraUnavailable": {
    en: "No camera available — switched to guided mode.",
    hi: "कैमरा उपलब्ध नहीं — निर्देशित मोड पर स्विच कर दिया गया।",
  },
  "training.tapTarget": { en: "Tap what the instruction asks for", hi: "जो निर्देश कहे उसे टैप करो" },
  "training.tapInOrder": { en: "Tap these in order", hi: "इन्हें क्रम में टैप करो" },
  "training.chooseOne": { en: "Choose one", hi: "एक चुनो" },
  /**
   * Narration.
   *
   * The failure strings are not decoration. A trainee in a mine who cannot read
   * Hindi relies on the audio, and a device that silently produced none would
   * leave them listening to a step they were never told. So the control says
   * what happened, in the trainee's language, whenever the answer was not
   * "spoken".
   */
  "training.narration.on": { en: "Read instructions aloud", hi: "निर्देश जोर से पढ़ें" },
  "training.narration.off": { en: "Narration off", hi: "निर्देश नहीं पढ़े जाएंगे" },
  "training.narration.toggle": { en: "Toggle spoken instructions", hi: "बोले जाने वाले निर्देश" },
  "training.narration.noVoice": {
    en: "This device has no Hindi voice installed, so instructions are not being read aloud. The text below is the instruction.",
    hi: "इस डिवाइस पर हिंदी आवाज़ नहीं है, इसलिए निर्देश जोर से नहीं पढ़े जा रहे। नीचे लिखा पाठ ही निर्देश है।",
  },
  "training.narration.unsupported": {
    en: "This browser cannot read instructions aloud. The text below is the instruction.",
    hi: "यह ब्राउज़र निर्देश जोर से नहीं पढ़ सकता। नीचे लिखा पाठ ही निर्देश है।",
  },
  "training.narration.blocked": {
    en: "Tap anywhere to let the phone read instructions aloud.",
    hi: "निर्देश जोर से पढ़ने के लिए कहीं भी एक बार दबाएँ।",
  },
  "training.pendingReview.title": {
    en: "Awaiting qualified safety review",
    hi: "योग्य सुरक्षा समीक्षा लंबित",
  },
  "training.pendingReview.body": {
    en: "This step is in the module because the specification requires it, but no approved procedure exists for it yet, so it cannot be answered. Training stops here, and no certificate can be issued for this module until the safety reviewer supplies it. Nothing on this screen has been assessed.",
    hi: "यह चरण इसलिए मौजूद है क्योंकि विनिर्देश इसे आवश्यक बताता है, पर इसके लिए अभी कोई स्वीकृत प्रक्रिया नहीं है, इसलिए इसका उत्तर नहीं दिया जा सकता। प्रशिक्षण यहीं रुकता है, और सुरक्षा समीक्षक द्वारा प्रक्रिया दिए जाने तक इस मॉड्यूल का कोई प्रमाणपत्र जारी नहीं हो सकता। इस स्क्रीन की कुछ भी मूल्यांकित नहीं किया गया है।",
  },
  "training.pendingReview.hold": {
    en: "Training cannot continue past this step",
    hi: "प्रशिक्षण इस चरण से आगे नहीं बढ़ सकता",
  },
  "training.queueSaved": {
    en: "Saved on this device. Will sync when back online.",
    hi: "इस डिवाइस पर सहेजा गया। ऑनलाइन होने पर सिंक होगा।",
  },
  "training.syncing": { en: "Syncing", hi: "सिंक हो रहा है" },
  "training.pass": { en: "Correct", hi: "सही" },
  "training.fail": { en: "Not correct", hi: "गलत" },
};

/** Look up a UI string, falling back to English for the unfilled `sat` slot. */
export function ui(key: UiKey, locale: Locale): string {
  const entry = UI[key];
  if (locale === "sat") return entry.sat ?? entry.en;
  return entry[locale] || entry.en;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  sat: "Santali",
};

/** Locales with content in the repo. Drives the language switcher. */
export const SELECTABLE_LOCALES: Locale[] = ["en", "hi"];
