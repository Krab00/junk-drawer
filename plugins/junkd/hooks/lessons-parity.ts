// One store's text and the lessons both parsers must read out of it: hooks/lessons.ts (lessons.test.tsx) and
// bin/orch-state's awk (tests/lessons.sh, `lesson list --json`). The data below the `export default` line is plain JSON, which
// tests/lessons.sh reads with jq: keep it JSON (double quotes, no comments, no trailing commas).
export default
{
 "scope": "repo",
 "store": "# Lessons\r\n\r\n## L1 (2026-10-20) scope: repo · stack: shell · to: smoke · from: T7\r\nWhat failed.\r\nWhy it did.\r\n\r\nThird paragraph after a blank line.\r\n\r\n## T8 (2026-10-18)\r\nOld diary.\r\n## L3 (2026-10-19) scope: repo · stack: node, python · from: T9\nTab\tseparated  and double  spaces.\n## L4 (2026-10-21) scope: repo · stack:  · to: repo · from: T1\nResting.\n## L5 (2026-10-22)\nBare.\n## L6 (2026-10-23) scope: repo · stack: go,rust · to: test·handed · from: T2\nHas a: colon and to: inside.\n##L8 is no heading.\nA lone\rcarriage return.\nEnd of\r## L10 (2026-10-25) scope: repo\n## L7 (20261020) scope: repo\nNot a lesson, its date is no date.\n## L9 (2026-10-24) scope: repo · stack: any · to: global · from: T3\n   \n  Indented last line.  \n",
 "lessons": [
  {
   "ref": "repo:L1",
   "id": "L1",
   "scope": "repo",
   "date": "2026-10-20",
   "stack": [
    "shell"
   ],
   "to": "smoke",
   "from": "T7",
   "pending": true,
   "text": "What failed. Why it did. Third paragraph after a blank line."
  },
  {
   "ref": "repo:L3",
   "id": "L3",
   "scope": "repo",
   "date": "2026-10-19",
   "stack": [
    "node",
    "python"
   ],
   "to": "",
   "from": "T9",
   "pending": true,
   "text": "Tab separated and double spaces."
  },
  {
   "ref": "repo:L4",
   "id": "L4",
   "scope": "repo",
   "date": "2026-10-21",
   "stack": [
    "any"
   ],
   "to": "repo",
   "from": "T1",
   "pending": false,
   "text": "Resting."
  },
  {
   "ref": "repo:L5",
   "id": "L5",
   "scope": "repo",
   "date": "2026-10-22",
   "stack": [
    "any"
   ],
   "to": "",
   "from": "",
   "pending": true,
   "text": "Bare."
  },
  {
   "ref": "repo:L6",
   "id": "L6",
   "scope": "repo",
   "date": "2026-10-23",
   "stack": [
    "go",
    "rust"
   ],
   "to": "test·handed",
   "from": "T2",
   "pending": true,
   "text": "Has a: colon and to: inside. ##L8 is no heading. A lone carriage return. End of ## L10 (2026-10-25) scope: repo"
  },
  {
   "ref": "repo:L9",
   "id": "L9",
   "scope": "repo",
   "date": "2026-10-24",
   "stack": [
    "any"
   ],
   "to": "global",
   "from": "T3",
   "pending": true,
   "text": "Indented last line."
  }
 ]
}
