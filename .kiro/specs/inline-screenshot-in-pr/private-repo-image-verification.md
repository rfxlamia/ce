# Private_Render_Check record

Status: DEFERRED

This file records the one-time Private_Render_Check of Requirement 15. The check is DEFERRED to a tracked follow-up issue. It does not block merging the implementing pull request or closing issue #47, and no result is recorded or assumed until it is performed. When the maintainer performs it:

1. In a private test repository, publish one PNG with `publish: branch`.
2. Post a PR_Comment that holds an Image_URL of the form of Requirement 6 criterion 1.
3. Open the comment in a browser as (a) a user with read access and (b) a user without access, or logged out.

Then replace every `PENDING` value below with the observed result and change the status line to `Status: COMPLETED`. Also replace the README "Private repositories" paragraph with the recorded result.

Do not write a token, a cookie, or the name of a private repository in this file. Redact the owner and repository names in the URL as `<OWNER>` and `<REPO>`.
`action/verification-file.test.ts` checks this.

## Result

- Date: PENDING
- Repository visibility: PENDING
- Exact URL form tested: PENDING
- Viewer (a), with read access, saw: PENDING
- Viewer (b), without access or logged out, saw: PENDING
- Image rendered inline for viewer (a): PENDING
- Image rendered inline for viewer (b): PENDING

## URL form for reference

`https://github.com/<OWNER>/<REPO>/raw/<sha>/pr-<n>/<run-id>/<file>.png`
