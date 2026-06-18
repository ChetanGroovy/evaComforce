#!/usr/bin/env bash
# =============================================================================
# verify-api.sh — Persistent API regression harness for comforceEva
# Target: http://localhost:7900/api (Fastify)
#
# Usage: bash verify-api.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:7900
#
# Exit 0  → all assertions passed
# Exit 1  → one or more assertions failed
#
# CLEANUP GUARANTEE: All created studies are deleted; all mutated studies are
# reverted before exit, even on failure (trap handles this).
# =============================================================================

set -euo pipefail

BASE="${1:-http://localhost:7900}"
API="$BASE/api"

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
FAILURES=()

pass() { echo -e "${GREEN}PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}FAIL${NC} $1 | $2"; FAILURES+=("$1 | $2"); ((FAIL++)); }

# ── Cleanup / revert tracking ──────────────────────────────────────────────────
CREATED_STUDIES=()
REVERTS=()          # "studyId:field:originalValue" — handle via API update

cleanup() {
  echo ""
  echo "──────────────── CLEANUP ─────────────────"
  # Delete any studies created during the test
  for sid in "${CREATED_STUDIES[@]:-}"; do
    local dir
    # Determine STUDIES_DIR by calling the API and comparing listing
    local studies_root
    studies_root="$(dirname "$(find /home/groovy/Desktop/projects/comforceEva/studies -maxdepth 1 -type d | head -2 | tail -1)")"
    local study_dir="$studies_root/$sid"
    case "$sid" in API-AUDIT*|VERIFY-*|*-TEST-*|SHAPE-TEST*) : ;; *) echo "  REFUSING to delete non-test study: $sid"; continue ;; esac
    if [ -n "$sid" ] && [ -d "$study_dir" ]; then
      rm -rf "$study_dir"
      echo "  deleted: $study_dir"
    else
      echo "  already gone: $sid"
    fi
  done
  # Revert any patched real studies
  for item in "${REVERTS[@]:-}"; do
    local sid field orig_val
    sid="$(echo "$item" | cut -d: -f1)"
    field="$(echo "$item" | cut -d: -f2)"
    orig_val="$(echo "$item" | cut -d: -f3-)"
    curl -s -X POST "$API/studies/$sid/update" \
      -H 'Content-Type: application/json' \
      -d "{\"study\":{\"$field\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$orig_val")}}" \
      > /dev/null
    echo "  reverted: $sid.$field → $orig_val"
  done
  echo ""
}

# Trigger cleanup on any exit
trap cleanup EXIT

# ── Utility functions ──────────────────────────────────────────────────────────
http_get() {
  # Returns: "BODY\nHTTP:CODE"
  curl -s -w "\nHTTP:%{http_code}" "$1"
}

http_post() {
  local url="$1" body="$2"
  curl -s -w "\nHTTP:%{http_code}" -X POST "$url" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

get_code() { echo "$1" | grep -o 'HTTP:[0-9]*' | cut -d: -f2; }
get_body() { echo "$1" | sed 's/HTTP:[0-9]*$//' | sed 's/[[:space:]]*$//'; }

jq_field() {
  # jq_field BODY ".field"
  echo "$1" | python3 -c "
import sys, json
body = sys.stdin.read().strip()
try:
    d = json.loads(body)
    parts = sys.argv[1].lstrip('.').split('.')
    for p in parts:
        if p.isdigit(): d = d[int(p)]
        else: d = d[p]
    print(d)
except Exception as e:
    print('__ERR__', e)
" "$2"
}

assert_status() {
  local label="$1" resp="$2" expected="$3"
  local actual
  actual="$(get_code "$resp")"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $expected)"
  else
    fail "$label" "expected HTTP $expected, got HTTP $actual"
  fi
}

assert_field_exists() {
  local label="$1" resp="$2" field="$3"
  local body actual
  body="$(get_body "$resp")"
  actual="$(jq_field "$body" "$field")"
  if [[ "$actual" == "__ERR__"* ]]; then
    fail "$label ($field exists)" "field missing or error: $actual"
  else
    pass "$label ($field exists)"
  fi
}

assert_field_eq() {
  local label="$1" resp="$2" field="$3" expected="$4"
  local body actual
  body="$(get_body "$resp")"
  actual="$(jq_field "$body" "$field")"
  if [ "$actual" = "$expected" ]; then
    pass "$label ($field=$expected)"
  else
    fail "$label ($field)" "expected '$expected', got '$actual'"
  fi
}

assert_field_nonempty() {
  local label="$1" resp="$2" field="$3"
  local body actual
  body="$(get_body "$resp")"
  actual="$(jq_field "$body" "$field")"
  if [[ -z "$actual" || "$actual" == "None" || "$actual" == "null" || "$actual" == "__ERR__"* ]]; then
    fail "$label ($field non-empty)" "got: '$actual'"
  else
    pass "$label ($field non-empty)"
  fi
}

assert_array_len() {
  local label="$1" resp="$2" field="$3" expected_len="$4"
  local body
  body="$(get_body "$resp")"
  local actual_len
  actual_len="$(echo "$body" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    parts = sys.argv[1].lstrip('.').split('.')
    for p in parts:
        if p.isdigit(): d = d[int(p)]
        else: d = d[p]
    print(len(d))
except Exception as e:
    print('__ERR__', e)
" "$field")"
  if [ "$actual_len" = "$expected_len" ]; then
    pass "$label (${field} length=$expected_len)"
  else
    fail "$label (${field} length)" "expected $expected_len, got $actual_len"
  fi
}

screen_session() {
  # Start a screening session and return the sessionId
  local study_id="$1" name="${2:-}"
  local body='{"studyId":"'"$study_id"'"'
  [ -n "$name" ] && body="$body,\"name\":\"$name\""
  body="$body}"
  local resp
  resp="$(http_post "$API/screen/start" "$body")"
  local code body_text
  code="$(get_code "$resp")"
  body_text="$(get_body "$resp")"
  if [ "$code" != "200" ]; then
    echo "__ERR__"
    return 1
  fi
  echo "$body_text" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])"
}

screen_consent() {
  local sid="$1"
  curl -s -X POST "$API/screen/answer" \
    -H 'Content-Type: application/json' \
    -d "{\"sessionId\":\"$sid\",\"text\":\"yes\"}" > /dev/null
}

screen_answer() {
  local sid="$1" text="$2"
  curl -s -X POST "$API/screen/answer" \
    -H 'Content-Type: application/json' \
    -d "{\"sessionId\":\"$sid\",\"text\":\"$text\"}"
}

echo "═══════════════════════════════════════════════════════════════════"
echo "   comforceEva API Regression Harness"
echo "   Target: $API"
echo "   $(date)"
echo "═══════════════════════════════════════════════════════════════════"

# =============================================================================
# CHECK 1 — GET /api/studies → 6 studies, each with required fields
# =============================================================================
echo ""
echo "── 1. GET /api/studies ──────────────────────────────────────────"

STUDIES_RESP="$(http_get "$API/studies")"
assert_status "1.1 GET /api/studies status" "$STUDIES_RESP" "200"
assert_array_len "1.2 studies count" "$STUDIES_RESP" "." "6"

# Check all 6 studies have required fields
STUDY_IDS=("77242113PSA3002" "AZD1163-D9640C00003" "C4771002" "MK-7240" "VP-VQW-765-3201" "WC45726")
STUDIES_BODY="$(get_body "$STUDIES_RESP")"
for i in 0 1 2 3 4 5; do
  for field in id name sponsor indication questionCount status; do
    val="$(echo "$STUDIES_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d[$i].get('$field', '__MISSING__')
if v == '__MISSING__' or v is None: print('__ERR__')
else: print(v)
")"
    if [[ "$val" == "__ERR__"* ]]; then
      fail "1.3 study[$i].$field exists" "missing"
    fi
  done
done
pass "1.3 all 6 studies have {id,name,sponsor,indication,questionCount,status}"

# =============================================================================
# CHECK 2 — GET /api/studies/:id for all 6
# =============================================================================
echo ""
echo "── 2. GET /api/studies/:id (all 6) ─────────────────────────────"

for sid in "${STUDY_IDS[@]}"; do
  RESP="$(http_get "$API/studies/$sid")"
  assert_status "2.$sid status" "$RESP" "200"
  BODY="$(get_body "$RESP")"

  # Check questions[] exists
  HAS_Q="$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(isinstance(d.get('questions'), list))
")"
  [ "$HAS_Q" = "True" ] && pass "2.$sid has questions[]" || fail "2.$sid has questions[]" "missing"

  # Check criteriaCount
  HAS_CC="$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cc = d.get('criteriaCount', {})
print('inclusion' in cc and 'exclusion' in cc)
")"
  [ "$HAS_CC" = "True" ] && pass "2.$sid has criteriaCount{inclusion,exclusion}" || fail "2.$sid criteriaCount" "missing or incomplete"

  # Check overview has exactly 8 keys
  OV_KEYS="$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(len(d.get('overview', {})))
")"
  [ "$OV_KEYS" = "8" ] && pass "2.$sid overview has 8 keys" || fail "2.$sid overview keys" "expected 8, got $OV_KEYS"

  # Check knowledgeBank exists
  HAS_KB="$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('knowledgeBank' in d)
")"
  [ "$HAS_KB" = "True" ] && pass "2.$sid has knowledgeBank" || fail "2.$sid knowledgeBank" "missing"
done

# C4771002 specific: 8 questions, status=ready
C4_RESP="$(http_get "$API/studies/C4771002")"
assert_array_len "2.C4771002 questionCount=8" "$C4_RESP" ".questions" "8"
assert_field_eq "2.C4771002 status=ready" "$C4_RESP" ".status" "ready"

# =============================================================================
# CHECK 3 — Regression: 4 bug fixes
# =============================================================================
echo ""
echo "── 3. REGRESSION — Bug Fixes ───────────────────────────────────"

# 3a: POST /api/screen/start with body {} → 400
RESP="$(http_post "$API/screen/start" '{}')"
assert_status "3a.1 screen/start {} → 400" "$RESP" "400"

# 3a: POST /api/screen/start with {"studyId":null} → 400
RESP="$(http_post "$API/screen/start" '{"studyId":null}')"
assert_status "3a.2 screen/start {studyId:null} → 400" "$RESP" "400"

# 3b: GET /api/report/NONEXISTENT → 404
RESP="$(http_get "$API/report/NONEXISTENT")"
assert_status "3b GET /api/report/NONEXISTENT → 404" "$RESP" "404"
# Also verify it's JSON not HTML
BODY="$(get_body "$RESP")"
IS_JSON="$(echo "$BODY" | python3 -c "
import sys, json
try:
    json.loads(sys.stdin.read())
    print('true')
except:
    print('false')
")"
[ "$IS_JSON" = "true" ] && pass "3b /api/report/NONEXISTENT is JSON" || fail "3b /api/report/NONEXISTENT is JSON" "not valid JSON"

# 3c: POST /api/screen/finish (unknown API route) → 404 JSON (not 200 HTML)
RESP="$(http_post "$API/screen/finish" '{}')"
assert_status "3c POST /api/screen/finish → 404" "$RESP" "404"
BODY="$(get_body "$RESP")"
IS_JSON="$(echo "$BODY" | python3 -c "
import sys, json
try:
    json.loads(sys.stdin.read())
    print('true')
except:
    print('false')
")"
[ "$IS_JSON" = "true" ] && pass "3c /api/screen/finish returns JSON (not HTML)" || fail "3c /api/screen/finish returns JSON" "not valid JSON"

# 3d: GET /api/studies/<120-char-string> → 404
LONG_ID="$(python3 -c "print('a'*120)")"
RESP="$(http_get "$API/studies/$LONG_ID")"
assert_status "3d GET /api/studies/<120-char> → 404" "$RESP" "404"
BODY="$(get_body "$RESP")"
IS_JSON="$(echo "$BODY" | python3 -c "
import sys, json
try:
    json.loads(sys.stdin.read())
    print('true')
except:
    print('false')
")"
[ "$IS_JSON" = "true" ] && pass "3d /api/studies/<120-char> returns JSON (not HTML)" || fail "3d /api/studies/<120-char> returns JSON" "not valid JSON"

# =============================================================================
# CHECK 4 — REGRESSION: DNQ carries closing field
# =============================================================================
echo ""
echo "── 4. REGRESSION: DNQ closing field ────────────────────────────"

SID="$(screen_session "C4771002")"
if [ "$SID" = "__ERR__" ]; then
  fail "4 C4771002 session start" "could not start session"
else
  screen_consent "$SID"
  RESP="$(screen_answer "$SID" "60")"
  # assert terminal=DNQ
  BODY="$(get_body "$RESP")"
  TERMINAL="$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
  [ "$TERMINAL" = "DNQ" ] && pass "4 DNQ terminal on age=60" || fail "4 DNQ terminal on age=60" "got '$TERMINAL'"
  # assert closing is non-empty
  CLOSING="$(echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);c=d.get('closing','');print(c if c else '')")"
  if [ -n "$CLOSING" ] && [ "$CLOSING" != "None" ] && [ "$CLOSING" != "null" ]; then
    pass "4 DNQ response has non-empty closing field"
  else
    fail "4 DNQ closing field non-empty" "got: '$CLOSING'"
  fi
fi

# =============================================================================
# CHECK 5 — Verdict matrix
# =============================================================================
echo ""
echo "── 5. Verdict matrix ────────────────────────────────────────────"

# WC45726 QUALIFIED — all passing answers (Male path, no pregnancy question)
SID="$(screen_session "WC45726")"
screen_consent "$SID"
screen_answer "$SID" "35" > /dev/null           # q1_age (>=18)
screen_answer "$SID" "Male" > /dev/null          # sex_at_birth
screen_answer "$SID" "yes" > /dev/null           # q2_bmi
screen_answer "$SID" "yes" > /dev/null           # q3_t2d
screen_answer "$SID" "yes" > /dev/null           # q4_weightloss
screen_answer "$SID" "no" > /dev/null            # q6_t1dm
screen_answer "$SID" "no" > /dev/null            # q7_transplant
screen_answer "$SID" "no" > /dev/null            # q8_gastric
R="$(screen_answer "$SID" "no")"                 # q9_mtc → QUALIFIED (pregnancy deferred for Male)
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "QUALIFIED" ] && pass "5.1 WC45726 QUALIFIED path" || fail "5.1 WC45726 QUALIFIED path" "got '$TERMINAL'"

# WC45726 DNQ on age (<18)
SID="$(screen_session "WC45726")"
screen_consent "$SID"
R="$(screen_answer "$SID" "15")"
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "DNQ" ] && pass "5.2 WC45726 DNQ age=15" || fail "5.2 WC45726 DNQ age=15" "got '$TERMINAL'"
REASON="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('reason',''))")"
[ -n "$REASON" ] && pass "5.2 WC45726 DNQ age=15 has reason" || fail "5.2 WC45726 DNQ age=15 reason" "empty"

# WC45726 DNQ on bmi=no
SID="$(screen_session "WC45726")"
screen_consent "$SID"
screen_answer "$SID" "35" > /dev/null
screen_answer "$SID" "Female" > /dev/null
R="$(screen_answer "$SID" "no")"
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "DNQ" ] && pass "5.3 WC45726 DNQ bmi=no" || fail "5.3 WC45726 DNQ bmi=no" "got '$TERMINAL'"

# C4771002 QUALIFIED path
SID="$(screen_session "C4771002")"
screen_consent "$SID"
screen_answer "$SID" "70" > /dev/null       # q1_age ≥65
screen_answer "$SID" "yes" > /dev/null      # q2_cdi_risk
screen_answer "$SID" "no" > /dev/null       # q3_prior_cdi
screen_answer "$SID" "no" > /dev/null       # q4_bowel_surgery
screen_answer "$SID" "no" > /dev/null       # q5_diarrhea
screen_answer "$SID" "no" > /dev/null       # q6_immune
screen_answer "$SID" "no" > /dev/null       # q7_serious_illness
R="$(screen_answer "$SID" "no")"            # q8_vaccine_allergy → QUALIFIED
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "QUALIFIED" ] && pass "5.4 C4771002 QUALIFIED path" || fail "5.4 C4771002 QUALIFIED path" "got '$TERMINAL'"
CLOSING="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('closing',''))")"
[ -n "$CLOSING" ] && pass "5.4 C4771002 QUALIFIED has closing" || fail "5.4 C4771002 QUALIFIED closing" "empty"

# C4771002 DNQ on age (<65)
SID="$(screen_session "C4771002")"
screen_consent "$SID"
R="$(screen_answer "$SID" "60")"
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "DNQ" ] && pass "5.5 C4771002 DNQ age=60" || fail "5.5 C4771002 DNQ age=60" "got '$TERMINAL'"

# C4771002 DNQ on cdi_risk=no
SID="$(screen_session "C4771002")"
screen_consent "$SID"
screen_answer "$SID" "70" > /dev/null
R="$(screen_answer "$SID" "no")"
TERMINAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('terminal',''))")"
[ "$TERMINAL" = "DNQ" ] && pass "5.6 C4771002 DNQ cdi_risk=no" || fail "5.6 C4771002 DNQ cdi_risk=no" "got '$TERMINAL'"

# =============================================================================
# CHECK 6 — Conversational invariant
# =============================================================================
echo ""
echo "── 6. Conversational invariant ──────────────────────────────────"

# Consent gate deflection
SID="$(screen_session "C4771002")"
R="$(screen_answer "$SID" "what is this study about?")"
BODY="$(get_body "$R")"
REDIR="$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('redirected',''))")"
DONE="$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('done',''))")"
[ "$REDIR" = "True" ] && pass "6.1 consent gate deflects question-like input (redirected=true)" || fail "6.1 consent gate deflection" "redirected=$REDIR"
[ "$DONE" = "False" ] && pass "6.1 consent gate deflection does NOT terminate session" || fail "6.1 consent deflection done=false" "done=$DONE"

# Screening phase deflection: cursor must not advance
SID="$(screen_session "C4771002")"
screen_consent "$SID"
R_BEFORE="$(screen_answer "$SID" "what happens next?")"  # deflect before first answer
REDIR="$(get_body "$R_BEFORE" | python3 -c "import sys,json;print(json.load(sys.stdin).get('redirected',''))")"
[ "$REDIR" = "True" ] && pass "6.2 screening phase deflects question-like (redirected=true)" || fail "6.2 screening deflection" "redirected=$REDIR"

# After deflection, answering "70" should advance to Q2, NOT Q3
R_AFTER="$(screen_answer "$SID" "70")"
BODY="$(get_body "$R_AFTER")"
DONE="$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('done',''))")"
PROMPT="$(echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('prompt','')[:30])")"
# After giving age (Q1), next prompt should be Q2 (cdi_risk), not skipped ahead
[ "$DONE" = "False" ] && pass "6.3 after deflection + valid answer, session continues (not done)" || fail "6.3 after deflection answer" "done=$DONE"
[[ "$PROMPT" == *"12 months"* ]] && pass "6.3 cursor advanced exactly 1 step after deflection (Q2 follows Q1)" || fail "6.3 cursor position after deflection" "prompt='$PROMPT'"

# ACK between turns
SID="$(screen_session "C4771002")"
screen_consent "$SID"
screen_answer "$SID" "70" > /dev/null
R="$(screen_answer "$SID" "yes")"  # Q2 answer → should see ACK
ACK_VAL="$(get_body "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ack',''))")"
[ "$ACK_VAL" = "Got it." ] && pass "6.4 ACK 'Got it.' present between turns" || fail "6.4 ACK between turns" "got '$ACK_VAL'"

# Stepwise terminal must equal screenPatient terminal (equivalence invariant — indirect test)
# We ran a full QUALIFIED path in check 5; here we verify the terminal from stepwise matches QUALIFIED
# (already verified in 5.4 above, but here we re-verify the closed session also has a proper closing)
# Already covered — no additional API endpoint for equivalence check needed.

# =============================================================================
# CHECK 7 — CRUD
# =============================================================================
echo ""
echo "── 7. CRUD operations ───────────────────────────────────────────"

# POST /api/studies → 201
CREATE_BODY='{"name":"Regression Harness Study","internalNumber":"VERIFY-HARNESS-TEMP","sponsor":"Test Harness","indication":"API testing"}'
RESP="$(http_post "$API/studies" "$CREATE_BODY")"
assert_status "7.1 POST /api/studies → 201" "$RESP" "201"
CREATED_ID="$(get_body "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")"
if [ -n "$CREATED_ID" ] && [ "$CREATED_ID" != "None" ]; then
  pass "7.1 created study id returned: $CREATED_ID"
  CREATED_STUDIES+=("$CREATED_ID")
else
  fail "7.1 created study id" "got '$CREATED_ID'"
fi

# Duplicate → 409
RESP="$(http_post "$API/studies" "$CREATE_BODY")"
assert_status "7.2 POST /api/studies duplicate → 409" "$RESP" "409"

# POST /api/studies/:id/update → 200 + persists
# Record original sponsor of a study for revert
ORIG_SPONSOR="$(get_body "$(http_get "$API/studies/WC45726")" | python3 -c "import sys,json;print(json.load(sys.stdin).get('sponsor',''))")"
REVERTS+=("WC45726:sponsor:$ORIG_SPONSOR")

UPDATE_RESP="$(http_post "$API/studies/WC45726/update" '{"study":{"sponsor":"HARNESS-MODIFIED-SPONSOR"}}')"
assert_status "7.3 POST /api/studies/WC45726/update → 200" "$UPDATE_RESP" "200"

# Verify it persisted (re-read)
PERSISTED="$(get_body "$(http_get "$API/studies/WC45726")" | python3 -c "import sys,json;print(json.load(sys.stdin).get('sponsor',''))")"
[ "$PERSISTED" = "HARNESS-MODIFIED-SPONSOR" ] && pass "7.3 update persists on re-read" || fail "7.3 update persists" "got '$PERSISTED'"

# Update NONEXISTENT → 404
RESP="$(http_post "$API/studies/DOES-NOT-EXIST-99999/update" '{"study":{"name":"x"}}')"
assert_status "7.4 POST /api/studies/NONEXISTENT/update → 404" "$RESP" "404"

# =============================================================================
# CHECK 8 — Robustness
# =============================================================================
echo ""
echo "── 8. Robustness ────────────────────────────────────────────────"

# Malformed JSON → 400
RESP="$(curl -s -w "\nHTTP:%{http_code}" -X POST "$API/screen/start" \
  -H 'Content-Type: application/json' \
  -d '{invalid json here}')"
CODE="$(get_code "$RESP")"
[ "$CODE" = "400" ] && pass "8.1 malformed JSON → 400" || fail "8.1 malformed JSON" "got HTTP $CODE"

# Missing sessionId on /screen/answer → 404
RESP="$(http_post "$API/screen/answer" '{"text":"hello"}')"
assert_status "8.2 /screen/answer missing sessionId → 404" "$RESP" "404"

# Form-encoded (no Content-Type) → 415
RESP="$(curl -s -w "\nHTTP:%{http_code}" -X POST "$API/screen/start" \
  -d 'studyId=WC45726')"
CODE="$(get_code "$RESP")"
[ "$CODE" = "415" ] && pass "8.3 form-encoded without Content-Type → 415" || fail "8.3 form-encoded no Content-Type" "got HTTP $CODE"

# None should 500
# (All tested above — any 5xx above would already have been caught as failures)
RESP_1="$(curl -s -w "\nHTTP:%{http_code}" -X POST "$API/screen/start" \
  -H 'Content-Type: application/json' -d '{bad}')"
RESP_2="$(http_post "$API/screen/answer" '{"text":"hello"}')"
RESP_3="$(curl -s -w "\nHTTP:%{http_code}" -X POST "$API/screen/start" -d 'studyId=x')"
for r in "$RESP_1" "$RESP_2" "$RESP_3"; do
  code="$(get_code "$r")"
  if [ "${code:0:1}" = "5" ]; then
    fail "8.4 robustness no-500 check" "got HTTP $code for one of the robustness probes"
  fi
done
pass "8.4 none of the robustness probes returned 5xx"

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}API VERIFICATION: PASS${NC} ($PASS/$TOTAL checks passed)"
else
  echo -e "${RED}API VERIFICATION: FAIL${NC} ($FAIL/$TOTAL checks failed)"
  echo ""
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}✗${NC} $f"
  done
fi
echo "═══════════════════════════════════════════════════════════════════"

# Cleanup is handled by the trap
# If we reach here, explicitly signal success/failure to the trap before it runs
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
