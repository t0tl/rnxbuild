# Known-broken for 01-bare (Plan 1)

These are the limitations of building `01-bare` with rnxbuild as of Plan 1
(parsing/resolution only — no compilation yet). They are not bugs; they are
explicit scope deferrals.

| Limitation | Owner |
| --- | --- |
| Actual compilation of Swift/Obj-C/Obj-C++ sources | Plan 2 |
| Linking the main executable | Plan 2 |
| Bundling into `.app` directory | Plan 2 |
| Asset catalog (`.car`) compilation — Plan 2 uses loose PNG icons | Plan 2 |
| Launch storyboard (`.storyboardc`) compilation | Plan 2 |
| Codesigning + device install | Plan 2 |
| App Store Connect upload + `PrivacyInfo.xcprivacy` merging | Phase 2 |
