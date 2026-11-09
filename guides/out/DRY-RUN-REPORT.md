# Guide ingestion dry run

Source root: `C:/Users/arnold/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an-2/outputs`
Text version: `takeout-2026-11-07/text-v1`

## Counts

- Inventory records: 201
- Approved documents (deduplicated text): 102
- Approved sources (all provenance rows): 125
- Chunks: 9201
- Chunks with a verified printed page: 258
- Excluded: 76 (assessment 59, ambiguous 10, generated 7)
- Failures: 0

## Storage estimate (not measured)

- Chunk text: 8.43 MiB
- Estimated total table footprint: 31.20 MiB
- Estimate only, 3.7x chunk text — the ratio measured in production after the 2026-11-08 ingest (guide_chunks 32 MB for 8.63 MiB of text). Re-measure with pg_total_relation_size after any large ingest.

## Page maps

- BCOMSCM Business Management 2.pdf: continuous_footer — 20 printed footers for "BACHELOR OF COMMERCE IN SUPPLY CHAIN MANAGEMENT" p.4–p.148
- B-RED 400 CLG_copy.pdf: continuous_footer — 13 printed footers for "BED (FOUNDATION PHASE TEACHING) / BED (INTERMEDIATE PHASE TEACHING)" p.1–p.13
- BCOMSCM Project Management (1)_260721_100944 (1).pdf: continuous_footer — 52 printed footers for "REGENT BUSINESS SCHOOL" p.1–p.52
- F-PFS 211 CLG.pdf: partial_footer — 6 printed footers for "DIPLOMA IN GRADE R TEACHING" p.1–p.6

## Partial or flagged documents

- Business Environment and Ethics - Mod Guide.pdf (substantial): contents reference p.216 but the export averages 681 characters per page (possible truncation)
- Computational Intelligence.pdf (partial): text ends mid-sentence; contents reference p.383 but the export averages 513 characters per page (possible truncation)
- Generic-Information Systems.pdf (partial): text ends mid-sentence; contents reference p.192 but the export averages 343 characters per page (possible truncation)
- PGDRM - Corporate Governance Ethics and Risk.pdf (substantial): contents reference p.272 but the export averages 746 characters per page (possible truncation)
- BPA HONS - Planning and Policy Analysis in the Public Sector (1).pdf (partial): text ends mid-sentence
- E-PFS 120 Curriculum and Learning Guide.pdf (partial): text ends mid-sentence
- E-EDS 122 2026_1 (1).pdf (partial): text ends mid-sentence
- PGDPM - Project Applied Technology (2).pdf (partial): text ends mid-sentence; contents reference p.237 but the export averages 334 characters per page (possible truncation)
- B-DPT 410 2026_1.pdf (partial): text ends mid-sentence
- Strategic Management Practices - Mod Guide.pdf (substantial): contents reference p.181 but the export averages 410 characters per page (possible truncation)
- HCSCM - Introduction to Purchasing Management( Guideline).pdf (substantial): contents reference p.237 but the export averages 645 characters per page (possible truncation)
- Multi Agent Systems.pdf (substantial): contents reference p.151 but the export averages 702 characters per page (possible truncation)
- BCOMSCM Business Management 2.pdf (substantial): bibliography survives through printed p.148; page map covers only footers detected in text
- PGDRM - Risk Management Framework and Measuring.pdf (substantial): contents reference p.218 but the export averages 703 characters per page (possible truncation)
- ADPA - Government Planning and Strategy (1).pdf (partial): text ends mid-sentence
- Generic - Microeconomic Essentials (2).pdf (substantial): contents reference p.136 but the export averages 660 characters per page (possible truncation)
- BHEME - Assessment Trends in Mathematics Education.pdf (substantial): contents reference p.193 but the export averages 434 characters per page (possible truncation)
- Programming.pdf (substantial): contents reference p.298 but the export averages 481 characters per page (possible truncation)
- Generic - Strategic Management.pdf (substantial): contents reference p.223 but the export averages 455 characters per page (possible truncation)
- BPA HONS - Theory and Science of Public Administration (1).pdf (partial): text ends mid-sentence
- Module Guide - Risk Modelling.pdf (partial): contents reference p.200 but the export averages 712 characters per page (possible truncation); contents list References p.198 and Bibliography p.200, both absent from the export
- PDMGT Economics 2025 final-1_260720_123301.pdf (partial): text ends mid-sentence
- Module guide - Project Applied Technology.pdf (partial): text ends mid-sentence; contents reference p.237 but the export averages 322 characters per page (possible truncation)
- BCOM DM - Social Media Marketing (1).pdf (partial): text ends mid-sentence; contents reference p.259 but the export averages 330 characters per page (possible truncation)
- PGDPM - Project Financial Management.pdf (partial): text ends mid-sentence; contents reference p.272 but the export averages 250 characters per page (possible truncation)
- Generic-Organisational Diversity.pdf (partial): text ends mid-sentence; contents reference p.73 but the export averages 695 characters per page (possible truncation)
- Advanced Project Management study guide_261011_181245.pdf (substantial): contents reference p.413 but the export averages 323 characters per page (possible truncation)
- MG - Human Resource Development.pdf (partial): text ends mid-sentence; contents reference p.142 but the export averages 538 characters per page (possible truncation)
- BCOMSCM Business Communication 101 (4) Module Guide closing 17 May 2026.pdf (substantial): contents reference p.192 but the export averages 708 characters per page (possible truncation)
- Module Guide - Project Quality Management.pdf (substantial): contents reference p.205 but the export averages 347 characters per page (possible truncation)
- Project Management - Mod Guide.pdf (substantial): contents reference p.127 but the export averages 449 characters per page (possible truncation)
- BPA - Policy and Public Service Delivery (2).pdf (partial): text ends mid-sentence
- Module Guide -  Operations Management for Sustainability.pdf (partial): text ends mid-sentence; contents reference p.159 but the export averages 709 characters per page (possible truncation)
- Generic - Business Communication (20 Credits).pdf (substantial): contents reference p.391 but the export averages 229 characters per page (possible truncation)
- ECO262 2026 02 SG.pdf (partial): text ends mid-sentence
- MG - Accounting and Financial Management.pdf (partial): text ends mid-sentence
- F-HLZ 313 CLG.pdf (partial): text ends mid-sentence
- Generic - Advanced Project Management.pdf (substantial): contents reference p.413 but the export averages 323 characters per page (possible truncation)
- HCEM - Marketing and Communication in Events Management.pdf (substantial): contents reference p.193 but the export averages 785 characters per page (possible truncation)
- PGDPM - Project Resource and Procurement Management.pdf (substantial): contents reference p.268 but the export averages 387 characters per page (possible truncation)
- BCOM ACC - Taxation for Corporate Activities (1).pdf (partial): text ends mid-sentence; contents reference p.186 but the export averages 667 characters per page (possible truncation)
- BCOM SCM - Modern Perspectives of Purchasing Management.pdf (substantial): contents reference p.158 but the export averages 716 characters per page (possible truncation)
- HCEM - Applied Events Management.pdf (partial): text ends mid-sentence; contents reference p.117 but the export averages 493 characters per page (possible truncation)
- module guide - Information Management.pdf (partial): text ends mid-sentence; contents reference p.155 but the export averages 683 characters per page (possible truncation)
- HCPM - Project Risk Management.pdf (partial): text ends mid-sentence; contents reference p.202 but the export averages 547 characters per page (possible truncation)
- Generic - Strategic Management-2.pdf (substantial): contents reference p.223 but the export averages 454 characters per page (possible truncation)
- HCPM - Public Finance.pdf (partial): text ends mid-sentence; contents promise material past the end of the export (Units to Ethics p.170, Bibliography p.193)
- E-ASS 120 Curriculum Learning Guide.pdf (partial): text ends mid-sentence
- BCOM PM - Project Information Management guide.pdf (partial): text ends mid-sentence; contents reference p.166 but the export averages 425 characters per page (possible truncation)
- HCIT - Introduction to Programming.pdf (substantial): contents reference p.391 but the export averages 190 characters per page (possible truncation)
- STUDY GUIDE - Financial Statement Analysis and Reporting Standards.pdf (partial): text ends mid-sentence; contents reference p.104 but the export averages 652 characters per page (possible truncation)
- Generic - Strategic Supply Chain Management.pdf (partial): text ends mid-sentence; contents reference p.262 but the export averages 494 characters per page (possible truncation)
- Generic - Marketing Management.pdf (substantial): contents reference p.511 but the export averages 153 characters per page (possible truncation)
- CLG F-HLT 313 (1).pdf (partial): text ends mid-sentence
- PGDRM - Introduction to Risk Management (1).pdf (substantial): contents reference p.241 but the export averages 563 characters per page (possible truncation)

## Duplicate texts

- S0489, S0823 → one document "Business Environment and Ethics - Mod Guide.pdf"
- S0670, S0706 → one document "BPA HONS - Leadership in the Public Sector (2).pdf"
- S0630, S0778 → one document "HCPM - Public Administration (1).pdf"
- S0332, S0854 → one document "PGDPM - Project Applied Technology (2).pdf"
- S0146, S0757 → one document "F-LSK 312 2026_1.pdf"
- S0042, S0187 → one document "PMB100_PMBD152 2026 02 SG (1).pdf"
- S0321, S0533, S0771 → one document "F-MAT 312 AUG 2022.pdf"
- S0115, S0179 → one document "F-HLZ 313 CLG.pdf"
- S0145, S0567 → one document "PDMGT Economics 2025 final-1_260720_123301.pdf"
- S0138, S0197, S0815 → one document "F-PFS 324 2026_1.pdf"
- S0761, S0780 → one document "HCSCM - Logistics and Material Handling.pdf"
- S0515, S0716 → one document "MG - Human Resource Development.pdf"
- S0527, S0651 → one document "B-RED 400 CLG_copy.pdf"
- S0485, S0777 → one document "Module Guide -  Operations Management for Sustainability.pdf"
- S0130, S0149, S0584, S0851 → one document "B-EDS 315 2026_1.pdf(1)"
- S0323, S0748 → one document "F-FLE 322 2026_1 (2).pdf"
- S0754, S0857 → one document "HCPM - Project Risk Management.pdf"
- S0141, S0832 → one document "CLG F-HLT 313.pdf"
- S0503, S0833 → one document "PGDRM - Introduction to Risk Management (1).pdf"

## Excluded

- S0022 [assessment] MAND152 2026 02 ASGMT.pdf — assessment, question-paper or rubric wording
- S0055 [ambiguous] RESEARCH WORKSHOP (PROGRAMME) MET50A-5 (1) .docx — too little text to classify
- S0056 [assessment] MET50A (2026)-1 (1) (1).pptx — assessment, question-paper or rubric wording
- S0084 [assessment] MANAGEMENT ACCOUNTING TUTORIAL LETTER 2026 (2).docx — assessment, question-paper or rubric wording
- S0105 [assessment] F-HLZ 313 2026 A2 S2 QP.pdf — assessment, question-paper or rubric wording
- S0116 [assessment] F-FLE 322 S2 Assignment 2.pdf — assessment, question-paper or rubric wording
- S0117 [assessment] F-HLT 313 QUESTION PAPER.pdf — assessment, question-paper or rubric wording
- S0122 [assessment] F-MAT 312 Assignment 2 PDF.pdf — assessment, question-paper or rubric wording
- S0123 [assessment] F-PFS 324 2026 S1 A2 UPLOAD.pdf — assessment, question-paper or rubric wording
- S0125 [assessment] B-EDS 315 2026 S2 A2 QP (1).pdf — assessment, question-paper or rubric wording
- S0132 [assessment] F-MAT 323 Assignment 2 Semester 2 2026.pdf — assessment, question-paper or rubric wording
- S0135 [assessment] F-LSK 312 2026 S2 A2 PDF.pdf — assessment, question-paper or rubric wording
- S0155 [assessment] F-HLZ 222 2026 A2 S2 QP (1).pdf — assessment, question-paper or rubric wording
- S0159 [assessment] F-LSK 323 2026 S2 A2 PDF.pdf — assessment, question-paper or rubric wording
- S0163 [ambiguous] Curricular Positioning and Behavioral Science Integration: An Evaluative Analysis of the Fundamentals of Organisational Behaviour Module within MANCOSA's Commerce Portfolio — no reliable guide or assessment marker
- S0183 [assessment] CSTUDY_Jul26_BPRM_FOB6_Final_20260415145638 (1).pdf — assessment, question-paper or rubric wording
- S0188 [assessment] B-EDS 213 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0195 [assessment] PEC262 2026 02 ASGMT (1).pdf — assessment, question-paper or rubric wording
- S0263 [generated] Study notes Introduction to Risk Management at Management College of Southern Africa (MANCOSA) - Stuvia SA — resale exam pack or copied answers
- S0269 [assessment] MET50A (2026)-1 (1).pptx — assessment, question-paper or rubric wording
- S0330 [generated] P UNIVERSITY OF PRETORIA UP PROGRAMME IN BLASTING ENGINEERING - Stuvia — resale exam pack or copied answers
- S0359 [ambiguous] FACULTY OF SCIENCE, AGRICULTURE AND ENGINEERING 2025 POSTGRADUATE PROSPECTUS — no reliable guide or assessment marker
- S0367 [ambiguous] What Is PMBOK in Project Management? Complete Beginner's Guide - iCertGlobal — no reliable guide or assessment marker
- S0388 [ambiguous] WhatsApp Video 2026-08-31 at 21.05.47.mp4 — no reliable guide or assessment marker
- S0420 [assessment] z Assignment RIPL01-5 S2 10 2026 HCFP (4) (1).pdf — assessment, question-paper or rubric wording
- S0440 [ambiguous] PMBOK 7th vs 8th Edition — here's what actually changed : r/pmp - Reddit — no reliable guide or assessment marker
- S0465 [assessment] Business Environment and Ethics (Business Management 3C - Case Study.pdf — assessment, question-paper or rubric wording
- S0483 [assessment] 290725212516_ACC  FIN MAN TUTORIAL LETTER 2026.pdf — assessment, question-paper or rubric wording
- S0496 [assessment] E-KUW 120 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0504 [assessment] E-PFS 120 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0507 [assessment] ACC  FIN MAN TUTORIAL 2026 Rubric (1).pdf — assessment, question-paper or rubric wording
- S0511 [assessment] F-MAT 312 Assignment 1 Semester 2 2026.pdf — assessment, question-paper or rubric wording
- S0512 [assessment] B-RED 400 B ASSIGNMENT.pdf — assessment, question-paper or rubric wording
- S0519 [assessment] E-MAT 120 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0520 [assessment] E-ASS 120 a1.pdf — assessment, question-paper or rubric wording
- S0528 [ambiguous] References — bibliography fragment, not a guide
- S0529 [assessment] B-EDS 315 2026 S2 A2 QP.pdf — assessment, question-paper or rubric wording
- S0544 [assessment] ITL152 2026 02 ASGMT.pdf — assessment, question-paper or rubric wording
- S0545 [assessment] R-PFS 211 2026 S2 A1 QP_FINAL.pdf — assessment, question-paper or rubric wording
- S0549 [ambiguous] 900477317-BBA-ENPS02-7-Entrepreneurship-Topic-1-6-09-03-2021-21a.pdf — no reliable guide or assessment marker
- S0574 [assessment] B-DPT 410 S2A1 QP.pdf — assessment, question-paper or rubric wording
- S0585 [assessment] z Study Plan ENPS02-7 Semester 2 2026 (1).pdf — assessment, question-paper or rubric wording
- S0600 [assessment] E-CRE 120 a1.pdf — assessment, question-paper or rubric wording
- S0603 [assessment] R-MAT 211 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0604 [generated] Human Resource Management IV (HRM400) - Comprehensive Exam Study Notes + Flashcards | STADIO University - Stuvia — resale exam pack or copied answers
- S0621 [ambiguous] 2. The module guide is not a primary source of re… — too little text to classify
- S0627 [assessment] B-RED 400 B ASSIGNMENT.pdf — assessment, question-paper or rubric wording
- S0637 [generated] MNG3702 EXAM PACK 2026 - Stuvia — resale exam pack or copied answers
- S0639 [assessment] Question One consists of three (3) questions. Read Unit 1, The... | Filo — assessment, question-paper or rubric wording
- S0640 [assessment] Question Three consists of four (4) questions. Read Unit 1. The Study of .. - Filo — assessment, question-paper or rubric wording
- S0643 [assessment] Question Two consists of four (4) questions. • Read Unit 1, The Study of.. - Filo — assessment, question-paper or rubric wording
- S0647 [assessment] B-EDS 111 2026 S2 A1 QP (1).pdf — assessment, question-paper or rubric wording
- S0655 [assessment] F-LLL 110 S2 A1 2026 QP.pdf — assessment, question-paper or rubric wording
- S0656 [generated] AUI4862 EXAM PACK 2024 - Stuvia — resale exam pack or copied answers
- S0680 [generated] AUI4862 EXAM PACK 2026 - DISTINCTION GUARANTEED — resale exam pack or copied answers
- S0681 [assessment] R-HLZ 211 2026 S2 A1 QUESTIONS.pdf — assessment, question-paper or rubric wording
- S0696 [assessment] B-CLI 110 2026 S2 A1 UPLOAD COMUTAR LITERACY.pdf — assessment, question-paper or rubric wording
- S0703 [assessment] Assessment PDF.pdf — assessment, question-paper or rubric wording
- S0711 [assessment] F-MAT 323 Assignment 1 Semester 2 2026.pdf — assessment, question-paper or rubric wording
- S0715 [assessment] F-HLT 313 S2 A1 QUESTION PAPER.pdf — assessment, question-paper or rubric wording
- S0720 [ambiguous] PROJ_Jan26_HCEM_MCEM5_Final_20260519124156.pdf — no reliable guide or assessment marker
- S0722 [assessment] Question Two consists of three (3) questions. - Filo — assessment, question-paper or rubric wording
- S0723 [assessment] F-PFS 324 assignment.pdf — assessment, question-paper or rubric wording
- S0725 [assessment] F-FLE 322 S026 S2 Assignment 1.pdf — assessment, question-paper or rubric wording
- S0740 [assessment] F-HLZ 313 2026 S2 1A QP.pdf — assessment, question-paper or rubric wording
- S0741 [assessment] E-EDS 122 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0745 [assessment] Read the case study provided and answer the follo… — assessment, question-paper or rubric wording
- S0749 [assessment] F-MAT 312 Assignment 1 Semester 2 2026.pdf — assessment, question-paper or rubric wording
- S0782 [assessment] Leadership Transformation at Phoenix Financial Services — assessment, question-paper or rubric wording
- S0786 [assessment] B-FMA 110 2026 S2 A1 QP FUNDAMENTAL MATHERMATICS.pdf — assessment, question-paper or rubric wording
- S0811 [assessment] B-EDS 315 2026 S2 A1 QP.pdf — assessment, question-paper or rubric wording
- S0826 [assessment] QUESTION TWO Question Two consists of three (3) questions. 30 Read Unit 3 & 4 in your B-EDS 111 Curriculum and Learning Guide (CLG) before answering questions 2.1-2.3. • Select NEXT to begin this section. 2.1 Carefully read the following scenario before completing the task. Scenario: [12] As a first-year education student at SANTS, you have been invited, along with a few other students, by the Life Orientation teacher at the local high school to conduct career information sessions with Grade 12 learners. The teacher has organised the learners into small groups based on their interests. In preparation for this session, you created a brief presentation for your assigned group. Following your presentation, you provided the learners with an opportunity to peruse your study materials and pose any questions they might have. (Wilson, 2026) Respond to the following six (6) questions posed by the Grade 12 learners. Your answers must draw directly on the theoretical frameworks and empirical evidence from the CLG. Note to Student: • Please provide your response directly in the table provided in the answer block. Failure to do so will result in penalty. • The use of Al-generated - Filo — assessment, question-paper or rubric wording
- S0830 [assessment] Question One consists of three (3) questions. Read Unit 3 in your B-EDS 1.. - Filo — assessment, question-paper or rubric wording
- S0831 [assessment] STEP-BY-STEP APPROACH OR GUIDE FOR STUDENTS — assessment, question-paper or rubric wording
- S0835 [generated] AUI4862 Assignment 2 (100% COMPLETE ANSWERS) 2025 - Stuvia — resale exam pack or copied answers
- S0840 [assessment] F-LSK 312 2026 S2 A1 PDF.pdf — assessment, question-paper or rubric wording

## Failures

- None
