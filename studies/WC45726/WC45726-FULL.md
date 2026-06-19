# WC45726 (RO7795068 / CT-388)_Obesity or Overweight with Type 2 Diabetes — Full Configuration

> Source: Extracted by Claude from Protocol WC45726 V1 (RO7795068/CT-388, IRB-approved 15-JAN-2026) + Main ICF (IRB-approved 30-JAN-2026). Re-built from UI upload 2026-06-19. · captured 2026-06-19
> Study ID: ``
> **CONTAINS PII/PHI** (patient names + phone numbers). Handle per HIPAA.

---

## 1. Study Overview

| Field | Value |
|---|---|
| Study name | WC45726 (RO7795068 / CT-388)_Obesity or Overweight with Type 2 Diabetes |
| Internal # | WC45726 |
| Sponsor | F. Hoffmann-La Roche Ltd |
| Indication | Obesity (BMI ≥30) or overweight (BMI ≥27 and <30) with Type 2 Diabetes; adults ≥18 |
| Investigational drug | RO7795068 (CT-388), GLP-1/GIP receptor agonist, subcutaneous injection once weekly (8/16/24 mg, up-titrated) vs placebo |
| Flow status | draft (generated from protocol) |
| Flow updated | 2026-06-19 |

**How a study is configured (observed model):**
1. Create study → set name, sponsor, PI, site, priority.
2. Upload **Study Documents** (Protocol, ICF).
3. System **extracts inclusion/exclusion criteria** from the Protocol PDF (per-page source refs) — see §4.
4. Build the **Knowledge Bank** (general info, trial design, compensation, blinding) — §3.
5. Generate **screening questions** from criteria — §5.
6. Assemble the **Agent Flow** graph (Start → Questions → outcomes) — §6.
7. Assign **Recruiters** and (optionally) link **CTMS**.

## 2. Study Documents

| Document | Type | Uploaded | Doc ID | Extraction |
|---|---|---|---|---|
| Protocol_-_WC45726_-_GLP-1GIP_receptor_agonist_(CT-388)_-_V1_-_IRB_Approved_15-JAN-2026_(1)_protocol.pdf | Protocol | 2026-06-19 | — | complete (by Claude) |
| Main_ICF_-_WC45276_(CT-388-106)_IRB_Approved_30-JAN-2026_(Received_02-FEB-2026)_(1).pdf | ICF | 2026-06-19 | — | complete (by Claude) |

- Documents are the **source of truth**: the Protocol is parsed into eligibility criteria (§4), which seed the screening questions (§5).

## 3. Knowledge Bank

Free-text reference the call agent uses to answer patient questions.

### General Study Information

We are enrolling in a Phase 3 clinical research study for adults (18 and older) who have type 2 diabetes and are living with obesity or overweight. The study tests an investigational medicine, RO7795068 (CT-388), given as a once-weekly injection under the skin, compared with placebo, to see how well it helps with weight and blood sugar and how safe it is. Participants must have type 2 diabetes (on diet/exercise or oral diabetes medicine) and a BMI of 27 or higher, and have tried at least once to lose weight with diet/exercise. The study is sponsored by Roche. NOTE: the study drug is a once-weekly injection under the skin — not a pill. [Specific site location and phone are not in the documents — supply from the site.]

### Trial Design

Phase III, randomized, double-blind, placebo-controlled, parallel-group study with 4 arms (RO7795068 8 mg, 16 mg, or 24 mg, or volume-matched placebo), ~400 participants per arm (~1600 total), multi-site/multi-region. The study drug is a once-weekly subcutaneous injection (Ypsomate autoinjector), starting at 4 mg and up-titrated by 4 mg every 4 weeks to the target dose. Total participation is about 79 weeks (treatment ~72 weeks), with both in-clinic and remote visits. An optional MRI substudy assesses body composition. Independent Data Monitoring and Clinical Endpoint Committees oversee the study.

### Compensation / Reimbursement

Participants are paid after each completed visit: $188 per in-clinic visit and $94 per remote visit, per the study schedule. The total depends on how many visits you complete over the ~79-week study. Payment is made following each completed visit. Your recruiter/site will confirm details.

### Blinding

Double-blind — site personnel and participants are blinded to treatment assignment; the Sponsor and its agents are also blinded, except individuals who require treatment-assignment access for their job roles per Sponsor SOPs.

## 4. Eligibility Criteria (extracted from Protocol)

`Pages` cites the source page in the Protocol. `Verify` = how the criterion is confirmed (self_report / exam / lab / imaging / records / derived); `Phone?` = phone-screenable (a hard, self-reportable knockout). **Screening questions (§5) may only be generated from `Phone? = ✅` criteria** — everything else is confirmed at the on-site screening visit.

**Phone-screenable knockouts (9):** INC-2, INC-5, INC-6, INC-8, EXC-1, EXC-11, EXC-16, EXC-21, EXC-37

### Inclusion (9)

| # | Pages | Verify | Knockout | Phone? | Criterion |
|---|---|---|---|---|---|
| 1 | 46 | records | none |  | Signed Informed Consent Form. |
| 2 | 46 | self_report | hard | ✅ | Age ≥18 years at the time of signing the Informed Consent Form. |
| 3 | 46 | records | none |  | Ability and willingness to comply with all aspects of the protocol (procedures, visits, questionnaires, assessments) for the study duration. |
| 4 | 46 | self_report | soft |  | Ability and willingness to self-administer the study drug (or receive an injection from a trained individual if visually impaired or with physical limitations). |
| 5 | 46 | self_report | hard | ✅ | BMI ≥27.0 kg/m². |
| 6 | 46 | self_report | hard | ✅ | Diagnosis of T2DM (WHO or local standards) with HbA1c ≥6.5% to ≤10% at screening, on stable oral therapy ≥3 months if applicable. May be diet/exercise alone or any oral AHM EXCEPT DPP-4 inhibitors or GLP-1 RA-based therapy. |
| 7 | 46 | self_report | soft |  | Ability and willingness to perform finger-stick blood glucose monitoring, including weekly fasting glucose measurements. |
| 8 | 46 | self_report | hard | ✅ | History of ≥1 self-reported unsuccessful diet/exercise effort to lose body weight. |
| 9 | 46 | self_report | none |  | Agreement to adhere to the contraception requirements (Section 5.4). |

### Exclusion (40)

| # | Pages | Verify | Knockout | Phone? | Criterion |
|---|---|---|---|---|---|
| 1 | 46 | self_report | hard | ✅ | History of Type 1 Diabetes Mellitus, any lifetime history of ketoacidosis, or hyperosmolar state/coma within 12 months prior to screening. |
| 2 | 46 | self_report | soft |  | One or more episodes of severe hypoglycemia and/or hypoglycemia unawareness within the 6 months prior to screening. |
| 3 | 47 | lab | hard |  | At least 2 confirmed fasting blood glucose values >270 mg/dL on 2 non-consecutive days during screening. |
| 4 | 47 | exam | soft |  | History/presence of proliferative diabetic retinopathy, diabetic macular edema, or non-proliferative retinopathy needing recent/planned retinal treatment (dilated fundoscopic exam required at screening). |
| 5 | 47 | records | soft |  | Current or prior treatment within 6 months with any injectable therapy for T2DM (short-term insulin <14 days for certain situations allowed). |
| 6 | 47 | self_report | soft |  | Self-reported change in body weight >5 kg within 3 months prior to screening. |
| 7 | 47 | self_report | soft |  | Obesity induced by other endocrine disorders (e.g., Cushing's) or diagnosed monogenetic/syndromic obesity (e.g., MC4R deficiency, Prader-Willi). |
| 8 | 47 | self_report | soft |  | Prior or planned surgical treatment for obesity (liposuction/abdominoplasty >1 year prior allowed). |
| 9 | 47 | self_report | soft |  | Prior or planned endoscopic/device-based obesity therapy, or device removal within 6 months (e.g., LAP-BAND, intragastric balloon). |
| 10 | 47 | self_report | soft |  | Any planned major medical procedure or surgery during the study. |
| 11 | 47 | self_report | hard | ✅ | Have had a transplanted organ or are awaiting an organ transplant (corneal transplants allowed). |
| 12 | 47 | self_report | soft |  | History of significant active/unstable major depressive disorder or other severe psychiatric disorder (stable MDD/GAD ≥1 year may be allowed per investigator). |
| 13 | 48 | self_report | soft |  | Any lifetime history of suicide attempt. |
| 14 | 48 | exam | hard |  | PHQ-9 score ≥15 at screening or Day 1 prior to randomization. |
| 15 | 48 | exam | hard |  | C-SSRS positive for active suicidal ideation (Q4/Q5) or recent suicidal behavior within the past month at screening or Day 1. |
| 16 | 48 | self_report | hard | ✅ | Known clinically significant gastric emptying abnormality (e.g., severe gastroparesis or gastric outlet obstruction). |
| 17 | 48 | self_report | soft |  | Active or untreated malignancy, or remission from a clinically significant malignancy for <5 years (except basal/squamous skin cancer, in-situ cervical or prostate cancer). |
| 18 | 48 | self_report | soft |  | Active systemic or localized infection requiring medical treatment at/prior to randomization that could interfere with study conduct. |
| 19 | 48 | self_report | soft |  | History of acute or chronic pancreatitis or clinically significant gallbladder disease (cholecystectomy ≥3 months prior may be allowed). |
| 20 | 48 | self_report | soft |  | History of hematologic conditions that may interfere with HbA1c measurement (e.g., hemolytic anemias, sickle cell disease, hemoglobinopathies). |
| 21 | 48 | self_report | hard | ✅ | Known personal or family history (first-degree relative) of MEN type 2, thyroid C-cell hyperplasia, or medullary thyroid carcinoma (MTC). |
| 22 | 48 | lab | hard |  | Clinically significant liver disease (except MASLD), or ALT/AST/GGT >5×ULN, ALP >3×ULN, or total bilirubin >2×ULN (except Gilbert's) at screening. |
| 23 | 49 | exam | soft |  | Significant uncontrolled endocrine abnormality (e.g., hypothyroidism, thyrotoxicosis, adrenal crisis) per investigator (stable treated hypothyroidism allowed). |
| 24 | 49 | lab | hard |  | Screening labs: amylase/lipase >2×ULN with symptoms, calcitonin ≥50 ng/L, GFR <30 mL/min/1.73m², or fasting triglycerides ≥500 mg/dL. |
| 25 | 49 | exam | soft |  | History of ventricular dysrhythmias or risk factors (structural heart disease, significant electrolyte abnormalities, family history of sudden death or long QT). |
| 26 | 49 | exam | soft |  | Poorly controlled hypertension (mean systolic ≥160 mmHg or diastolic ≥100 mmHg) at screening. |
| 27 | 49 | self_report | soft |  | Cardiovascular conditions within 3 months: acute MI, stroke/TIA, unstable angina, or hospitalization for heart failure. |
| 28 | 49 | self_report | soft |  | NYHA Functional Classification IV heart failure. |
| 29 | 49 | self_report | soft |  | History or current diagnosis of drug or alcohol use disorder that may preclude protocol compliance or affect appetite/weight, per investigator. |
| 30 | 49 | records | hard |  | Treatment with any approved or investigational GLP-1 RA-based therapy (GLP-1 mono, GLP-1/GIP dual, or GLP-1/GIP/Gluc triple agonist) within 6 months prior to randomization. |
| 31 | 49 | self_report | soft |  | Treatment with other investigational therapy within 3 months or <5 elimination half-lives prior to randomization (whichever is longer). |
| 32 | 49 | records | soft |  | Within 3 months: any medication/supplement/OTC that promotes weight loss or glucose metabolism (other than permitted AHM); any medication that may cause significant weight gain; or chronic (>14 days) GI-motility-reducing medications. |
| 33 | 49 | records | soft |  | Started implantable or injectable contraceptives (e.g., Depo-Provera, Nexplanon) within 12 months prior to screening (hormonal IUDs allowed if in place ≥6 weeks). |
| 34 | 49 | records | soft |  | Current, prior (within 3 months), or anticipated chronic (≥14 days) systemic glucocorticoid therapy. |
| 35 | 49 | self_report | soft |  | Known allergy to any component of the study drug formulation, or any condition that is a contraindication to GLP-1 RAs or GLP-1/GIP RAs. |
| 36 | 49 | self_report | soft |  | Currently enrolled in another clinical study not scientifically/medically compatible with this study. |
| 37 | 49 | self_report | hard | ✅ | Pregnant or breastfeeding, or intending to become pregnant during the study or the contraception window (negative pregnancy tests required). |
| 38 | 49 | derived | none |  | Any disorder, medical condition, or abnormal lab not covered above that, per investigator, might jeopardize safety, compliance, or data interpretability. |
| 39 | 50 | self_report | soft |  | MRI substudy only: any contraindication to MRI (non-removable ferromagnetic implants, pacemakers, aneurysm clips, body size exceeding scanner, significant claustrophobia). |
| 40 | 50 | self_report | soft |  | MRI substudy only: history of excessive alcohol intake (>21 units/week males; >14 units/week females). |

## 5. Screening Questions (10) — created from criteria

Each question maps to one or more eligibility criteria (`criteria_ids` → §4). `knockout_power` + qualify/disqualify conditions drive routing.

### Q1. How old are you?
- **variable**: `q1_age` · **type**: number · **category**: demographics
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "age < 18"
- **from criteria**: ["INC-2"]

### Q2. What is your sex assigned at birth? _(routing)_
- **variable**: `sex_at_birth` · **type**: choice · **category**: demographics
- **choices**: Female / Male
- **qualifying**: no · **knockout_power**: none · **in_flow**: yes

### Q3. Has a doctor told you that your BMI is 27 or higher, or that you are overweight or have obesity?
- **variable**: `q2_bmi` · **type**: yes_no · **category**: demographics
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == no"
- **from criteria**: ["INC-5"]

### Q4. Have you been diagnosed with type 2 diabetes?
- **variable**: `q3_t2d` · **type**: yes_no · **category**: conditions
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == no"
- **from criteria**: ["INC-6"]

### Q5. Have you previously made at least one unsuccessful attempt to lose weight through lifestyle changes (such as diet or exercise)?
- **variable**: `q4_weightloss` · **type**: yes_no · **category**: lifestyle
- **qualifying**: no · **knockout_power**: medium · **in_flow**: yes
- **disqualify if**: "answer == no"
- **from criteria**: ["INC-8"]

### Q7. Have you ever been diagnosed with type 1 diabetes, or had diabetic ketoacidosis?
- **variable**: `q6_t1dm` · **type**: yes_no · **category**: conditions
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == yes"
- **from criteria**: ["EXC-1"]

### Q8. Have you had an organ transplant, or are you waiting for one? (A cornea/eye transplant is OK — say no.)
- **variable**: `q7_transplant` · **type**: yes_no · **category**: conditions
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == yes"
- **from criteria**: ["EXC-11"]

### Q9. Have you ever been told you have severe stomach-emptying problems, like gastroparesis or a blocked stomach?
- **variable**: `q8_gastric` · **type**: yes_no · **category**: conditions
- **qualifying**: no · **knockout_power**: medium · **in_flow**: yes
- **disqualify if**: "answer == yes"
- **from criteria**: ["EXC-16"]

### Q10. Do you, or any close blood relative (parent, sibling, or child), have a history of medullary thyroid cancer or Multiple Endocrine Neoplasia (MEN) type 2?
- **variable**: `q9_mtc` · **type**: yes_no · **category**: conditions
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == yes"
- **from criteria**: ["EXC-21"]

### Q11. Are you currently pregnant, breastfeeding, or planning to become pregnant during the study?
- **variable**: `q10_pregnancy` · **type**: yes_no · **category**: demographics
- **shown only if**: `sex_at_birth == "Female"` (depends_on ["sex_at_birth"])
- **qualifying**: no · **knockout_power**: high · **in_flow**: yes
- **disqualify if**: "answer == yes"
- **from criteria**: ["EXC-37"]


## 6. Agent Flow (screening logic graph)

**Nodes (23):**

| id | type | label |
|---|---|---|
| root | root | Are you interested in this study? |
| q1_age | question | How old are you? |
| q2_bmi | question | BMI 27+ / overweight or obese? |
| q3_t2d | question | Diagnosed with type 2 diabetes? |
| q4_wl | question | Tried diet/exercise to lose weight without success? |
| q5_glp1 | question | GLP-1 med (Ozempic/Wegovy/Mounjaro…) in last 6 months? |
| q6_t1dm | question | Type 1 diabetes / ketoacidosis history? |
| q7_transplant | question | Organ transplant (except corneal)? |
| q8_gastric | question | Severe stomach-emptying problems? |
| q9_mtc | question | Personal/family MTC or MEN2 history? |
| q10_preg | question | Pregnant/breastfeeding/planning pregnancy? |
| qualified | qualified | Qualified |
| dnq_age | dnq | DNQ - Under 18 |
| dnq_bmi | dnq | DNQ - BMI below 27 |
| dnq_no_t2d | dnq | DNQ - No type 2 diabetes diagnosis |
| dnq_no_wl | dnq | DNQ - No unsuccessful diet/exercise weight-loss attempt |
| dnq_glp1 | dnq | DNQ - Recent GLP-1 therapy |
| dnq_t1dm | dnq | DNQ - Type 1 diabetes / ketoacidosis |
| dnq_transplant | dnq | DNQ - Organ transplant |
| dnq_gastric | dnq | DNQ - Gastric emptying abnormality |
| dnq_mtc | dnq | DNQ - Personal/family history of MTC or MEN2 |
| dnq_pregnancy | dnq | DNQ - Pregnant/breastfeeding/planning pregnancy |
| q_sex | question | Sex assigned at birth? |

**Edges (23):**

- root → q1_age [Interested]
- q1_age → q_sex [18 or older]
- q1_age → dnq_age [Under 18]
- q2_bmi → q3_t2d [BMI 27+]
- q2_bmi → dnq_bmi [Below 27]
- q3_t2d → q4_wl [Has T2D]
- q3_t2d → dnq_no_t2d [No T2D]
- q4_wl → q5_glp1 [Tried weight loss]
- q4_wl → dnq_no_wl [Has not tried]
- q5_glp1 → dnq_glp1 [Recent GLP-1]
- q5_glp1 → q6_t1dm [No recent GLP-1]
- q6_t1dm → dnq_t1dm [T1DM/ketoacidosis]
- q6_t1dm → q7_transplant [None]
- q7_transplant → dnq_transplant [Transplant]
- q7_transplant → q8_gastric [None]
- q8_gastric → dnq_gastric [Gastric abnormality]
- q8_gastric → q9_mtc [None]
- q9_mtc → dnq_mtc [MTC/MEN2 history]
- q9_mtc → q10_preg [Female]
- q10_preg → dnq_pregnancy [Pregnant/planning]
- q10_preg → qualified [Not pregnant/planning]
- q_sex → q2_bmi [Recorded]
- q9_mtc → qualified [Male (skip)]

## 7. Patients / Recruitment Funnel

_No patient rows provided._

## 8. Recruiters

_No recruiters provided._
